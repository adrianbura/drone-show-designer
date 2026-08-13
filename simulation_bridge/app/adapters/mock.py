"""
MockSimulationVehicleAdapter — the ONLY place synthetic telemetry may exist.

It models a simple first-order tracking lag so the whole pipeline (prepare, run,
telemetry, tracking metrics, report) can be exercised without PX4 installed.
Runs made with this adapter are labelled MOCK everywhere in the UI and report.
"""

from __future__ import annotations

from ..models.run import SimulationReference, TelemetrySample
from ..services.coordinates import ned_to_studio, studio_to_ned
from .base import SimulationVehicleAdapter, Vec3


class MockSimulationVehicleAdapter(SimulationVehicleAdapter):
    id = "MOCK"
    kind = "simulation"
    version = "0.1.0"
    implemented = True
    environment_mode = "MOCK"

    def __init__(self, *, lag: float = 0.25, bias: Vec3 = (0.02, -0.01, 0.015)) -> None:
        self._lag = max(0.0, min(1.0, lag))
        self._bias = bias
        self._connected = False
        self._state_ned: Vec3 = (0.0, 0.0, 0.0)
        self._prev_ned: Vec3 | None = None
        self._t_prev: float | None = None
        self._t: float = 0.0
        self._running = False

    async def connect(self, endpoint: str, timeout_s: float) -> dict:
        self._connected = True
        return {
            "adapter": self.id,
            "simulator": "in-process mock (no autopilot)",
            "endpoint": endpoint,
            "vehiclesDiscovered": 1,
        }

    async def disconnect(self) -> None:
        self._connected = False
        self._running = False

    async def health(self) -> dict:
        return {
            "reachable": True,
            "vehicleDiscovered": self._connected,
            "detail": "mock adapter — synthetic telemetry, not PX4",
        }

    async def prepare_simulation(self, initial_position_studio: Vec3) -> None:
        self._state_ned = studio_to_ned(initial_position_studio)
        self._prev_ned = self._state_ned
        self._t_prev = None
        self._t = 0.0

    async def start_trajectory(self) -> None:
        self._running = True

    async def send_reference(self, reference: SimulationReference) -> None:
        target = studio_to_ned(reference.position)
        a = self._lag
        self._prev_ned = self._state_ned
        self._t_prev = self._t
        self._t = reference.t_operational
        self._state_ned = tuple(  # type: ignore[assignment]
            self._state_ned[i] + (target[i] + self._bias[i] - self._state_ned[i]) * a
            for i in range(3)
        )

    async def telemetry(self) -> TelemetrySample:
        velocity: Vec3 | None = None
        if self._prev_ned is not None and self._t_prev is not None:
            dt = self._t - self._t_prev
            if dt > 0:
                v_ned = tuple((self._state_ned[i] - self._prev_ned[i]) / dt for i in range(3))
                velocity = ned_to_studio(v_ned)  # type: ignore[arg-type]
        return TelemetrySample(
            t_operational=self._t,
            position_studio=ned_to_studio(self._state_ned),
            velocity_studio=velocity,
            connected=self._connected,
            mode="MOCK_OFFBOARD" if self._running else "MOCK_HOLD",
            available=True,
        )

    async def stop_simulation(self) -> None:
        self._running = False

    async def get_run_status(self) -> dict:
        return {"running": self._running, "connected": self._connected, "mode": "MOCK"}
