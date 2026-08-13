"""
Explicit simulation state machine. Invalid transitions fail cleanly with
``INVALID_STATE_TRANSITION`` instead of silently corrupting a run.
"""

from __future__ import annotations

from ..models.errors import BridgeError

STATES = (
    "IDLE",
    "PACKAGE_LOADED",
    "PX4_CONNECTING",
    "PX4_CONNECTED",
    "READY",
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
)

TRANSITIONS: dict[str, tuple[str, ...]] = {
    "IDLE": ("PACKAGE_LOADED", "PX4_CONNECTING", "FAILED"),
    "PACKAGE_LOADED": ("PX4_CONNECTING", "IDLE", "FAILED"),
    "PX4_CONNECTING": ("PX4_CONNECTED", "FAILED", "CANCELLED"),
    "PX4_CONNECTED": ("READY", "FAILED", "CANCELLED"),
    "READY": ("RUNNING", "IDLE", "PACKAGE_LOADED", "FAILED", "CANCELLED"),
    "RUNNING": ("COMPLETED", "FAILED", "CANCELLED"),
    "COMPLETED": ("IDLE", "PACKAGE_LOADED", "PX4_CONNECTING"),
    "FAILED": ("IDLE", "PACKAGE_LOADED", "PX4_CONNECTING"),
    "CANCELLED": ("IDLE", "PACKAGE_LOADED", "PX4_CONNECTING"),
}

TERMINAL_STATES = ("COMPLETED", "FAILED", "CANCELLED")


class SimulationStateMachine:
    def __init__(self, state: str = "IDLE") -> None:
        if state not in STATES:
            raise ValueError(f"unknown state {state!r}")
        self._state = state
        self._history: list[str] = [state]

    @property
    def state(self) -> str:
        return self._state

    @property
    def history(self) -> tuple[str, ...]:
        return tuple(self._history)

    def can(self, target: str) -> bool:
        return target in TRANSITIONS.get(self._state, ())

    def to(self, target: str) -> str:
        if target not in STATES:
            raise BridgeError("INVALID_STATE_TRANSITION", f"unknown state {target!r}")
        if not self.can(target):
            raise BridgeError(
                "INVALID_STATE_TRANSITION",
                f"cannot move from {self._state} to {target}",
            )
        self._state = target
        self._history.append(target)
        return target

    def is_terminal(self) -> bool:
        return self._state in TERMINAL_STATES
