"""
Versioned bridge API (/api/v1).

Deliberately NARROW: health, environment, package validation, prepare, run,
cancel, state, report, history. There is no arm, takeoff, land, goto or
raw-MAVLink endpoint anywhere in this service — the bridge only replays one
already-validated trajectory into a local simulator.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import BRIDGE_ALGORITHM_VERSION, BRIDGE_API_VERSION, BRIDGE_VERSION
from ..adapters import SIMULATION_ADAPTER_REGISTRY, mavsdk_available
from ..models.errors import BridgeError
from ..models.package import SimulationPackage
from ..models.run import SimulationRunReport
from ..services.runner import SimulationRunner
from ..services.validation import validate_package

router = APIRouter(prefix=f"/api/{BRIDGE_API_VERSION}", tags=["simulation"])


def get_runner(request: Request) -> SimulationRunner:
    runner = getattr(request.app.state, "runner", None)
    if runner is None:  # pragma: no cover - wiring guard
        raise BridgeError("BRIDGE_CONFIG_INVALID", "Bridge runner is not initialised")
    return runner


class PackageBody(BaseModel):
    package: SimulationPackage = Field(alias="package")


class PrepareBody(BaseModel):
    package: SimulationPackage | None = None
    environmentMode: str = "MOCK"


class RunBody(BaseModel):
    runId: str
    mode: str = "SHOW_TRAJECTORY"


class CancelBody(BaseModel):
    runId: str


@router.get("/health")
async def health(runner: SimulationRunner = Depends(get_runner)) -> dict:
    px4 = mavsdk_available()
    return {
        "status": "ok",
        "bridgeVersion": BRIDGE_VERSION,
        "bridgeApiVersion": BRIDGE_API_VERSION,
        "bridgeAlgorithmVersion": BRIDGE_ALGORITHM_VERSION,
        "simulationOnly": True,
        "px4Available": px4,
        "px4Detail": (
            "MAVSDK present — PX4 SITL runs available"
            if px4
            else "MAVSDK not installed — mock mode only"
        ),
        "adapters": [
            {"id": a.id, "implemented": a.implemented, "kind": a.kind, "version": a.version}
            for a in SIMULATION_ADAPTER_REGISTRY
        ],
        "state": runner.machine.state,
    }


@router.get("/environment")
async def environment(runner: SimulationRunner = Depends(get_runner)) -> dict:
    return runner.environment().model_dump()


@router.post("/package/validate")
async def validate(body: PackageBody, runner: SimulationRunner = Depends(get_runner)) -> dict:
    return validate_package(body.package, max_samples=runner.settings.max_trajectory_samples)


@router.post("/simulation/prepare")
async def prepare(body: PrepareBody, runner: SimulationRunner = Depends(get_runner)) -> dict:
    record = await runner.prepare(body.package, body.environmentMode)
    return {
        "runId": record.run_id,
        "state": runner.machine.state,
        "environment": runner.environment(record.environment_mode).model_dump(),
        "payloadHash": record.payload_hash or "",
        "setpointRate": runner.settings.setpoint_rate_hz,
        "telemetryRate": runner.settings.telemetry_rate_hz,
    }


@router.post("/simulation/run")
async def run(body: RunBody, runner: SimulationRunner = Depends(get_runner)) -> dict:
    record = await runner.start(body.runId, body.mode)
    return runner.snapshot(record.run_id)


@router.post("/simulation/cancel")
async def cancel(body: CancelBody, runner: SimulationRunner = Depends(get_runner)) -> dict:
    record = await runner.cancel(body.runId)
    return runner.snapshot(record.run_id)


@router.get("/simulation/history")
async def history(runner: SimulationRunner = Depends(get_runner)) -> dict:
    return {"runs": runner.history_entries()}


@router.get("/simulation/{run_id}")
async def run_state(run_id: str, runner: SimulationRunner = Depends(get_runner)) -> dict:
    return runner.snapshot(run_id)


@router.get("/simulation/{run_id}/report", response_model=SimulationRunReport)
async def run_report(run_id: str, runner: SimulationRunner = Depends(get_runner)) -> SimulationRunReport:
    return runner.report(run_id)
