"""Structured bridge errors. Every failure surfaced to the studio has a code."""

from __future__ import annotations

BRIDGE_ERROR_CODES = (
    "BRIDGE_CONFIG_INVALID",
    "NON_LOCAL_ENDPOINT_REJECTED",
    "PACKAGE_INVALID",
    "PACKAGE_STALE",
    "SHOW_VALIDATION_FAILED",
    "PX4_NOT_AVAILABLE",
    "PX4_CONNECTION_FAILED",
    "VEHICLE_NOT_DISCOVERED",
    "MULTIPLE_SYSTEMS_NOT_SUPPORTED",
    "TRAJECTORY_INVALID",
    "SIMULATION_NOT_READY",
    "SIMULATION_ALREADY_RUNNING",
    "SIMULATION_CANCELLED",
    "TELEMETRY_UNAVAILABLE",
    "SIMULATION_EXECUTION_FAILED",
    "INVALID_STATE_TRANSITION",
    "MULTI_VEHICLE_NOT_SUPPORTED",
)


class BridgeError(Exception):
    """A coded, user-presentable bridge failure."""

    def __init__(self, code: str, message: str, detail: str = "") -> None:
        if code not in BRIDGE_ERROR_CODES:
            raise ValueError(f"unknown bridge error code {code!r}")
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message, "detail": self.detail}

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"BridgeError({self.code}: {self.message})"
