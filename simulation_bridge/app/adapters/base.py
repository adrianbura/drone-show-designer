"""
Adapter boundary.

Nothing above this layer may see MAVSDK/MAVLink objects. The runner only knows
this interface, so a mock, PX4 SITL, and (later) other simulators are
interchangeable.
"""

from __future__ import annotations

import abc

from ..models.run import SimulationReference, TelemetrySample

Vec3 = tuple[float, float, float]


class SimulationVehicleAdapter(abc.ABC):
    """One simulated vehicle. Sprint 5 executes exactly one at a time."""

    id: str = "abstract"
    kind: str = "simulation"
    version: str = "0.0.0"
    implemented: bool = False
    environment_mode: str = "MOCK"

    @abc.abstractmethod
    async def connect(self, endpoint: str, timeout_s: float) -> dict:
        """Connect and discover exactly one simulated system. Returns metadata."""

    @abc.abstractmethod
    async def disconnect(self) -> None: ...

    @abc.abstractmethod
    async def health(self) -> dict:
        """Structured status: reachable / vehicle discovered / details."""

    @abc.abstractmethod
    async def prepare_simulation(self, initial_position_studio: Vec3) -> None:
        """Hold the initial simulated target before the trajectory starts."""

    @abc.abstractmethod
    async def start_trajectory(self) -> None: ...

    @abc.abstractmethod
    async def send_reference(self, reference: SimulationReference) -> None:
        """Push one time-varying local position setpoint (studio frame in)."""

    @abc.abstractmethod
    async def telemetry(self) -> TelemetrySample:
        """Latest captured vehicle state. Unavailable fields must be None."""

    @abc.abstractmethod
    async def stop_simulation(self) -> None: ...

    @abc.abstractmethod
    async def get_run_status(self) -> dict: ...
