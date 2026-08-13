"""
SimulationRunner — owns the simulation state machine, the execution clock and
the tracking record.

Key guarantees:
  * ONE run at a time (a second concurrent run is rejected).
  * The loaded package is IMMUTABLE for the duration of the run.
  * Elapsed timing uses ``time.monotonic()``; never wall-clock, never the browser.
  * Initial and final targets are always held (never undefined setpoints).
  * Cancellation stops cleanly, preserves partial telemetry and still produces a
    partial report.
  * A frontend disconnect does NOT abort a run — only explicit cancellation does.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import deque
from datetime import datetime, timezone

from .. import BRIDGE_ALGORITHM_VERSION, BRIDGE_API_VERSION, BRIDGE_VERSION
from ..adapters import SIMULATION_ADAPTER_REGISTRY, create_adapter
from ..adapters.base import SimulationVehicleAdapter
from ..config import Settings, assert_local_endpoint
from ..models.errors import BridgeError
from ..models.package import SimulationPackage
from ..models.run import (
    RunRecord,
    SimulationEnvironment,
    SimulationRunReport,
    TrackingPoint,
)
from .coordinates import COORDINATE_MAPPING, COORDINATE_MAPPING_VERSION
from .metrics import classify_run, compute_tracking_metrics, euclidean
from .sampler import SimulationTrajectorySampler
from .state_machine import SimulationStateMachine
from .test_trajectory import (
    TEST_TRAJECTORY_VERSION,
    build_test_trajectory_samples,
    coordinate_calibration_report,
)
from .validation import assert_package_acceptable, assert_runnable

log = logging.getLogger("dss.bridge.runner")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class SimulationRunner:
    def __init__(self, settings: Settings, *, time_scale: float = 1.0) -> None:
        self.settings = settings
        # time_scale > 1 compresses the simulation clock. Used by the automated
        # test suite only; the API never exposes it.
        self.time_scale = max(0.001, time_scale)
        self.machine = SimulationStateMachine()
        self.package: SimulationPackage | None = None
        self.adapter: SimulationVehicleAdapter | None = None
        self.environment_mode: str = "MOCK"
        self.record: RunRecord | None = None
        self.history: deque[RunRecord] = deque(maxlen=20)
        self._task: asyncio.Task | None = None
        self._cancel = asyncio.Event()
        self._reports: dict[str, SimulationRunReport] = {}

    # ------------------------------------------------------------ environment

    def environment(self, mode: str | None = None) -> SimulationEnvironment:
        mode = mode or self.environment_mode
        endpoint = self.settings.px4_endpoint
        transport, host, port = assert_local_endpoint(endpoint)
        return SimulationEnvironment(
            mode="PX4_SITL" if mode == "PX4_SITL" else "MOCK",
            vehicleCount=1,
            transport=transport,
            endpoint=f"{transport}://{host}:{port}",
            simulationOnly=True,
            simulatorMetadata={
                **(self.record.simulator_metadata if self.record else {}),
                "adapters": [a.id for a in SIMULATION_ADAPTER_REGISTRY if a.implemented],
                "coordinateMappingVersion": COORDINATE_MAPPING_VERSION,
            },
        )

    # --------------------------------------------------------------- prepare

    async def prepare(self, package: SimulationPackage | None, environment_mode: str) -> RunRecord:
        if self.is_running():
            raise BridgeError("SIMULATION_ALREADY_RUNNING", "A simulation run is already active")
        if environment_mode not in ("MOCK", "PX4_SITL"):
            raise BridgeError("BRIDGE_CONFIG_INVALID", f"unsupported mode {environment_mode!r}")
        if package is not None:
            assert_package_acceptable(package, max_samples=self.settings.max_trajectory_samples)

        self.package = package
        self.environment_mode = environment_mode
        if self.machine.state != "IDLE":
            self.machine = SimulationStateMachine()
        if package is not None:
            self.machine.to("PACKAGE_LOADED")

        await self._release_adapter()
        adapter = create_adapter(environment_mode)
        self.machine.to("PX4_CONNECTING")
        metadata = await adapter.connect(self.settings.px4_endpoint, self.settings.connection_timeout_s)
        self.machine.to("PX4_CONNECTED")
        self.adapter = adapter

        record = RunRecord(
            run_id=f"sim-{uuid.uuid4().hex[:12]}",
            mode="SHOW_TRAJECTORY" if package is not None else "TEST_TRAJECTORY",
            environment_mode="PX4_SITL" if environment_mode == "PX4_SITL" else "MOCK",
            show_package_id=package.showPackageId if package else None,
            analysis_revision=package.analysisRevision if package else None,
            payload_hash=package.payloadHash if package else None,
            drone_id=package.trajectory.droneId if package else None,
            started_at=_now_iso(),
            bridge_version=BRIDGE_VERSION,
            adapter_version=adapter.version,
            simulator_metadata=metadata,
            stage="Preparing",
        )
        self.record = record
        self.machine.to("READY")
        log.info(
            "prepared run=%s mode=%s package=%s drone=%s state=%s",
            record.run_id, environment_mode, record.show_package_id, record.drone_id, self.machine.state,
        )
        return record

    # ------------------------------------------------------------------- run

    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self, run_id: str, mode: str) -> RunRecord:
        if self.is_running():
            raise BridgeError("SIMULATION_ALREADY_RUNNING", "A simulation run is already active")
        record, adapter = self.record, self.adapter
        if record is None or adapter is None or self.machine.state != "READY":
            raise BridgeError("SIMULATION_NOT_READY", "Prepare a simulation before running it")
        if record.run_id != run_id:
            raise BridgeError("SIMULATION_NOT_READY", f"Unknown or superseded run id {run_id!r}")
        if mode not in ("TEST_TRAJECTORY", "SHOW_TRAJECTORY"):
            raise BridgeError("BRIDGE_CONFIG_INVALID", f"unknown run mode {mode!r}")

        if mode == "SHOW_TRAJECTORY":
            if self.package is None:
                raise BridgeError("PACKAGE_INVALID", "No simulation package is loaded")
            assert_runnable(self.package)
            samples = list(self.package.trajectory.samples)
            record.calibration = None
        else:
            samples = build_test_trajectory_samples()
            record.calibration = coordinate_calibration_report()

        record.mode = mode  # type: ignore[assignment]
        record.references = SimulationTrajectorySampler(samples).resample(self.settings.setpoint_rate_hz)
        record.telemetry.clear()
        record.tracking.clear()
        record.warnings.clear()
        record.errors.clear()
        record.status = "RUNNING"
        record.stage = "Connecting"
        self._cancel = asyncio.Event()
        self.machine.to("RUNNING")
        self._task = asyncio.create_task(self._execute(record, adapter))
        log.info("run=%s started mode=%s references=%d", record.run_id, mode, len(record.references))
        return record

    async def _execute(self, record: RunRecord, adapter: SimulationVehicleAdapter) -> None:
        setpoint_rate = self.settings.setpoint_rate_hz
        telemetry_every = max(1, round(setpoint_rate / max(1.0, self.settings.telemetry_rate_hz)))
        step = (1.0 / setpoint_rate) / self.time_scale
        try:
            record.stage = "Preparing"
            await adapter.prepare_simulation(record.references[0].position)
            # Hold the initial target before the trajectory starts.
            await asyncio.sleep(min(self.settings.start_hold_s, 5.0) / self.time_scale)
            await adapter.start_trajectory()
            record.stage = "Running"

            t0 = time.monotonic()
            for i, ref in enumerate(record.references):
                if self._cancel.is_set():
                    raise BridgeError("SIMULATION_CANCELLED", "Simulation cancelled by the operator")
                await adapter.send_reference(ref)
                if i % telemetry_every == 0 or i == len(record.references) - 1:
                    await self._capture(record, ref)
                record.elapsed_s = (time.monotonic() - t0) * self.time_scale
                target = t0 + (ref.t_operational / self.time_scale) + step
                delay = target - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)

            # Hold the final target for a bounded period; never leave the
            # simulated vehicle without a setpoint.
            record.stage = "Completing"
            final = record.references[-1]
            hold_ticks = max(0, int(self.settings.end_hold_s * setpoint_rate))
            for _ in range(hold_ticks):
                if self._cancel.is_set():
                    break
                await adapter.send_reference(final)
                await asyncio.sleep(step)
            await self._capture(record, final)

            record.stage = "Analyzing"
            await adapter.stop_simulation()
            self._finish(record, "COMPLETED")
        except BridgeError as exc:
            await self._safe_stop(adapter)
            if exc.code == "SIMULATION_CANCELLED":
                record.warnings.append("run cancelled — partial telemetry retained")
                self._finish(record, "CANCELLED")
            else:
                record.errors.append(f"{exc.code}: {exc.message}")
                self._finish(record, "FAILED")
        except asyncio.CancelledError:
            await self._safe_stop(adapter)
            record.warnings.append("run cancelled — partial telemetry retained")
            self._finish(record, "CANCELLED")
            raise
        except Exception as exc:  # pragma: no cover - defensive
            await self._safe_stop(adapter)
            record.errors.append(f"SIMULATION_EXECUTION_FAILED: {exc}")
            self._finish(record, "FAILED")

    async def _capture(self, record: RunRecord, ref) -> None:
        sample = await self.adapter.telemetry() if self.adapter else None
        if sample is None or not sample.available or sample.position_studio is None:
            if "TELEMETRY_UNAVAILABLE: position telemetry unavailable" not in record.warnings:
                record.warnings.append("TELEMETRY_UNAVAILABLE: position telemetry unavailable")
            return
        record.telemetry.append(sample)
        record.tracking.append(
            TrackingPoint(
                t=ref.t_show,
                planned=ref.position,
                actual=sample.position_studio,
                error=euclidean(ref.position, sample.position_studio),
                planned_velocity=ref.velocity,
                actual_velocity=sample.velocity_studio,
            )
        )

    async def _safe_stop(self, adapter: SimulationVehicleAdapter) -> None:
        try:
            await adapter.stop_simulation()
        except Exception:  # pragma: no cover - defensive
            pass

    def _finish(self, record: RunRecord, state: str) -> None:
        record.finished_at = _now_iso()
        record.duration_s = record.references[-1].t_operational if record.references else 0.0
        metrics = compute_tracking_metrics(record.tracking)
        status, extra = classify_run(
            metrics,
            warning_error_m=self.settings.warning_tracking_error_m,
            failure_error_m=self.settings.failure_tracking_error_m,
            had_errors=bool(record.errors),
        )
        if state == "CANCELLED":
            status = "CANCELLED"
        record.status = status
        record.warnings.extend(w for w in extra if w not in record.warnings)
        record.stage = "Done"
        self.machine.to(state)
        self._reports[record.run_id] = self._build_report(record, metrics)
        if record not in self.history:
            self.history.appendleft(record)
        log.info("run=%s finished state=%s status=%s samples=%d", record.run_id, state, status, len(record.tracking))

    # ---------------------------------------------------------------- cancel

    async def cancel(self, run_id: str) -> RunRecord:
        record = self.record
        if record is None or record.run_id != run_id:
            raise BridgeError("SIMULATION_NOT_READY", f"Unknown run id {run_id!r}")
        if not self.is_running():
            raise BridgeError("SIMULATION_NOT_READY", "No simulation run is active")
        self._cancel.set()
        task = self._task
        if task:
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=10.0)
            except (asyncio.TimeoutError, BridgeError):
                task.cancel()
        return record

    async def wait(self) -> None:
        """Await the active run (used by tests and the integration harness)."""
        if self._task:
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _release_adapter(self) -> None:
        if self.adapter is not None:
            try:
                await self.adapter.disconnect()
            except Exception:  # pragma: no cover - defensive
                pass
            self.adapter = None

    # ---------------------------------------------------------------- reports

    def snapshot(self, run_id: str | None = None) -> dict:
        record = self.record
        if run_id and (record is None or record.run_id != run_id):
            report = self._reports.get(run_id or "")
            if report is None:
                raise BridgeError("SIMULATION_NOT_READY", f"Unknown run id {run_id!r}")
            return {
                "runId": report.runId,
                "state": report.state,
                "status": report.status,
                "elapsedSeconds": report.durationSeconds,
                "progress": 1.0,
                "stage": "Done",
                "latest": report.trackingSeries[-1] if report.trackingSeries else None,
                "environmentMode": report.environment.mode,
                "droneId": report.selectedDroneId,
            }
        if record is None:
            return {
                "runId": "",
                "state": self.machine.state,
                "status": "RUNNING" if self.is_running() else "CANCELLED",
                "elapsedSeconds": 0.0,
                "progress": 0.0,
                "stage": "Idle",
                "latest": None,
                "environmentMode": "MOCK",
                "droneId": None,
            }
        total = record.references[-1].t_operational if record.references else 0.0
        latest = record.tracking[-1] if record.tracking else None
        return {
            "runId": record.run_id,
            "state": self.machine.state,
            "status": record.status,
            "elapsedSeconds": round(record.elapsed_s, 3),
            "progress": 0.0 if total <= 0 else min(1.0, round(record.elapsed_s / total, 4)),
            "stage": record.stage,
            "latest": _tracking_dict(latest) if latest else None,
            "environmentMode": record.environment_mode,
            "droneId": record.drone_id,
        }

    def report(self, run_id: str) -> SimulationRunReport:
        report = self._reports.get(run_id)
        if report is None:
            raise BridgeError("SIMULATION_NOT_READY", f"No report for run {run_id!r}")
        return report

    def history_entries(self) -> list[dict]:
        entries = []
        for record in self.history:
            report = self._reports.get(record.run_id)
            metrics = report.trackingMetrics if report else None
            entries.append(
                {
                    "runId": record.run_id,
                    "droneId": record.drone_id,
                    "timestamp": record.started_at,
                    "status": record.status,
                    "environmentMode": record.environment_mode,
                    "rmsPositionError": metrics.rmsPositionError if metrics else None,
                    "maxPositionError": metrics.maxPositionError if metrics else None,
                }
            )
        return entries

    def _build_report(self, record: RunRecord, metrics) -> SimulationRunReport:
        statement = (
            "PX4 SITL simulation result — simulation tracking diagnostics only. "
            "This is NOT a real-world flight safety statement."
            if record.environment_mode == "PX4_SITL"
            else "MOCK simulation result — synthetic vehicle, not PX4. "
            "Simulation tracking diagnostics only."
        )
        series = [_tracking_dict(p) for p in record.tracking]
        return SimulationRunReport(
            runId=record.run_id,
            state=self.machine.state,
            status=record.status,
            statement=statement,
            environment=self.environment(record.environment_mode),
            trajectorySource=record.mode,
            showPackageId=record.show_package_id,
            analysisRevision=record.analysis_revision,
            simulationPayloadHash=record.payload_hash,
            selectedDroneId=record.drone_id,
            startedAt=record.started_at,
            finishedAt=record.finished_at,
            durationSeconds=round(record.duration_s, 3),
            setpointRate=self.settings.setpoint_rate_hz,
            telemetryRate=self.settings.telemetry_rate_hz,
            coordinateMapping=COORDINATE_MAPPING,
            coordinateCalibration=record.calibration,
            trackingMetrics=metrics,
            trackingSeries=series,
            warnings=list(record.warnings),
            errors=list(record.errors),
            versions={
                "bridgeVersion": record.bridge_version,
                "bridgeApiVersion": BRIDGE_API_VERSION,
                "bridgeAlgorithmVersion": BRIDGE_ALGORITHM_VERSION,
                "adapterVersion": record.adapter_version,
                "coordinateMappingVersion": COORDINATE_MAPPING_VERSION,
                "samplerVersion": SimulationTrajectorySampler.version,
                "testTrajectoryVersion": TEST_TRAJECTORY_VERSION,
            },
        )


def _tracking_dict(p: TrackingPoint) -> dict:
    return {
        "t": round(p.t, 3),
        "planned": [round(v, 3) for v in p.planned],
        "actual": [round(v, 3) for v in p.actual],
        "error": round(p.error, 4),
    }
