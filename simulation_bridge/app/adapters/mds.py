"""
MdsSimulationAdapter — ARCHITECTURE PLACEHOLDER ONLY.

MDS execution is NOT part of Sprint 5. This class exists so the registry can
express "known future target, not implemented" without duplicating any MDS
behaviour. Every method raises.
"""

from __future__ import annotations

from ..models.errors import BridgeError
from ..models.run import SimulationReference, TelemetrySample
from .base import SimulationVehicleAdapter, Vec3


def _not_implemented() -> BridgeError:
    return BridgeError(
        "SIMULATION_NOT_READY",
        "MDS simulation execution is not implemented",
        "placeholder adapter — see docs/SIMULATION_BRIDGE.md (future work)",
    )


class MdsSimulationAdapter(SimulationVehicleAdapter):
    id = "MDS"
    kind = "simulation"
    version = "0.0.0"
    implemented = False
    environment_mode = "MOCK"

    async def connect(self, endpoint: str, timeout_s: float) -> dict:
        raise _not_implemented()

    async def disconnect(self) -> None:
        raise _not_implemented()

    async def health(self) -> dict:
        return {"reachable": False, "vehicleDiscovered": False, "detail": "not implemented"}

    async def prepare_simulation(self, initial_position_studio: Vec3) -> None:
        raise _not_implemented()

    async def start_trajectory(self) -> None:
        raise _not_implemented()

    async def send_reference(self, reference: SimulationReference) -> None:
        raise _not_implemented()

    async def telemetry(self) -> TelemetrySample:
        raise _not_implemented()

    async def stop_simulation(self) -> None:
        raise _not_implemented()

    async def get_run_status(self) -> dict:
        return {"running": False, "implemented": False}
