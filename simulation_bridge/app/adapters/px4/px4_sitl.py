"""
Px4SitlMavsdkAdapter — real PX4 SITL transport over MAVSDK.

SIMULATION ONLY. The endpoint is re-checked against the local allowlist on every
connect, so this adapter cannot be pointed at a physical aircraft.

NEVER FABRICATES TELEMETRY: if a field is unavailable it is reported as None /
available=False. Arming and offboard entry happen internally for the simulated
vehicle only; they are not exposed as API endpoints.

MAVSDK is imported lazily so the bridge, its mock mode and the default test
suite work with no PX4 dependency installed.
"""

from __future__ import annotations

import asyncio
import importlib

from ...config import assert_local_endpoint
from ...models.errors import BridgeError
from ...models.run import SimulationReference, TelemetrySample
from ...services.coordinates import ned_to_studio, studio_to_ned, studio_yaw_to_ned
from ..base import SimulationVehicleAdapter, Vec3

PX4_ADAPTER_VERSION = "0.1.0"


def mavsdk_available() -> bool:
    try:
        importlib.import_module("mavsdk")
        return True
    except Exception:
        return False


class Px4SitlMavsdkAdapter(SimulationVehicleAdapter):
    id = "PX4_SITL_MAVSDK"
    kind = "simulation"
    version = PX4_ADAPTER_VERSION
    implemented = True
    environment_mode = "PX4_SITL"

    def __init__(self) -> None:
        self._system = None
        self._offboard_types = None
        self._telemetry_task: asyncio.Task | None = None
        self._latest: TelemetrySample | None = None
        self._endpoint = ""
        self._running = False
        self._t = 0.0

    # ------------------------------------------------------------- connection

    async def connect(self, endpoint: str, timeout_s: float) -> dict:
        assert_local_endpoint(endpoint)  # simulation-only guard, always re-checked
        self._endpoint = endpoint
        try:
            mavsdk = importlib.import_module("mavsdk")
            offboard = importlib.import_module("mavsdk.offboard")
        except Exception as exc:  # pragma: no cover - requires PX4 extra
            raise BridgeError(
                "PX4_NOT_AVAILABLE",
                "MAVSDK is not installed — install the 'px4' extra to use PX4 SITL",
                str(exc),
            )
        self._offboard_types = offboard
        system = mavsdk.System()
        try:
            await asyncio.wait_for(system.connect(system_address=endpoint), timeout=timeout_s)
        except asyncio.TimeoutError:
            raise BridgeError("PX4_CONNECTION_FAILED", f"Timed out connecting to {endpoint}")
        except Exception as exc:  # pragma: no cover - requires PX4
            raise BridgeError("PX4_CONNECTION_FAILED", f"Could not connect to {endpoint}", str(exc))

        discovered = 0
        try:
            async def _wait_for_system() -> int:
                nonlocal discovered
                async for state in system.core.connection_state():
                    if state.is_connected:
                        discovered += 1
                        return discovered
                return discovered

            await asyncio.wait_for(_wait_for_system(), timeout=timeout_s)
        except asyncio.TimeoutError:
            raise BridgeError(
                "VEHICLE_NOT_DISCOVERED",
                f"No simulated vehicle discovered on {endpoint} within {timeout_s:.0f} s",
            )

        if discovered == 0:
            raise BridgeError("VEHICLE_NOT_DISCOVERED", "No simulated vehicle discovered")
        if discovered > 1:
            raise BridgeError(
                "MULTIPLE_SYSTEMS_NOT_SUPPORTED",
                "More than one simulated system was discovered — Sprint 5 supports exactly one",
            )

        self._system = system
        self._telemetry_task = asyncio.create_task(self._telemetry_loop())
        return {
            "adapter": self.id,
            "adapterVersion": self.version,
            "endpoint": endpoint,
            "vehiclesDiscovered": discovered,
            "simulator": "PX4 SITL (external process)",
        }

    async def disconnect(self) -> None:
        if self._telemetry_task:
            self._telemetry_task.cancel()
            self._telemetry_task = None
        self._system = None
        self._latest = None
        self._running = False

    async def health(self) -> dict:
        if self._system is None:
            return {
                "reachable": False,
                "vehicleDiscovered": False,
                "detail": "not connected to PX4 SITL",
            }
        return {
            "reachable": True,
            "vehicleDiscovered": True,
            "detail": f"connected to {self._endpoint}",
        }

    # ---------------------------------------------------------------- run flow

    async def prepare_simulation(self, initial_position_studio: Vec3) -> None:
        system, offboard = self._require()
        n, e, d = studio_to_ned(initial_position_studio)
        setpoint = offboard.PositionNedYaw(n, e, d, studio_yaw_to_ned(0.0))
        try:
            await system.action.arm()  # simulated vehicle only
            await system.offboard.set_position_ned(setpoint)
            await system.offboard.start()
        except Exception as exc:  # pragma: no cover - requires PX4
            raise BridgeError("SIMULATION_NOT_READY", "Could not enter simulated offboard mode", str(exc))

    async def start_trajectory(self) -> None:
        self._running = True

    async def send_reference(self, reference: SimulationReference) -> None:
        system, offboard = self._require()
        n, e, d = studio_to_ned(reference.position)
        self._t = reference.t_operational
        try:
            await system.offboard.set_position_ned(
                offboard.PositionNedYaw(n, e, d, studio_yaw_to_ned(0.0))
            )
        except Exception as exc:  # pragma: no cover - requires PX4
            raise BridgeError("SIMULATION_EXECUTION_FAILED", "Setpoint rejected by PX4", str(exc))

    async def telemetry(self) -> TelemetrySample:
        if self._latest is None:
            # No fabrication: report the field as unavailable instead.
            return TelemetrySample(
                t_operational=self._t,
                position_studio=None,
                velocity_studio=None,
                connected=self._system is not None,
                mode=None,
                available=False,
            )
        return TelemetrySample(
            t_operational=self._t,
            position_studio=self._latest.position_studio,
            velocity_studio=self._latest.velocity_studio,
            connected=self._latest.connected,
            mode=self._latest.mode,
            available=self._latest.available,
        )

    async def stop_simulation(self) -> None:
        self._running = False
        system = self._system
        if system is None:
            return
        try:  # pragma: no cover - requires PX4
            await system.offboard.stop()
        except Exception:
            pass

    async def get_run_status(self) -> dict:
        return {
            "running": self._running,
            "connected": self._system is not None,
            "endpoint": self._endpoint,
        }

    # ---------------------------------------------------------------- internals

    def _require(self):
        if self._system is None or self._offboard_types is None:
            raise BridgeError("SIMULATION_NOT_READY", "PX4 SITL adapter is not connected")
        return self._system, self._offboard_types

    async def _telemetry_loop(self) -> None:  # pragma: no cover - requires PX4
        system = self._system
        if system is None:
            return
        try:
            async for pv in system.telemetry.position_velocity_ned():
                position = ned_to_studio(
                    (pv.position.north_m, pv.position.east_m, pv.position.down_m)
                )
                velocity = ned_to_studio(
                    (pv.velocity.north_m_s, pv.velocity.east_m_s, pv.velocity.down_m_s)
                )
                self._latest = TelemetrySample(
                    t_operational=self._t,
                    position_studio=position,
                    velocity_studio=velocity,
                    connected=True,
                    mode="OFFBOARD",
                    available=True,
                )
        except asyncio.CancelledError:
            return
        except Exception:
            self._latest = None
