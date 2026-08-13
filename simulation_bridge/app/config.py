"""
Bridge configuration and the SIMULATION-ONLY network guard.

The bridge is a local developer tool. It binds to loopback, accepts only local
simulation endpoints, and has no code path to a physical aircraft. The guard is
enforced at configuration time AND again before every connection attempt; there
is no UI override in Sprint 5.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from ipaddress import ip_address
from urllib.parse import urlparse

from .models.errors import BridgeError

#: Hard switch. Sprint 5 has no non-simulation mode at all.
SIMULATION_ONLY = True

#: Only these hosts may ever be contacted or bound.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", ""})

#: Local simulation ports we allow to be configured (PX4 SITL defaults).
ALLOWED_SIMULATION_PORTS = frozenset({14540, 14541, 14550, 14580, 14030, 8787})

ALLOWED_TRANSPORTS = frozenset({"udp", "udpin", "udpout", "tcp", "tcpin", "tcpout"})


def _is_local_host(host: str) -> bool:
    host = (host or "").strip().strip("[]").lower()
    if host in LOCAL_HOSTS:
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def assert_local_endpoint(endpoint: str) -> tuple[str, str, int]:
    """
    Validate a MAVSDK-style endpoint such as ``udpin://127.0.0.1:14540``.

    Returns ``(transport, host, port)`` or raises ``NON_LOCAL_ENDPOINT_REJECTED``.
    Remote/public IPs and arbitrary hostnames are always rejected.
    """
    if not SIMULATION_ONLY:  # pragma: no cover - constant in Sprint 5
        raise BridgeError("BRIDGE_CONFIG_INVALID", "SIMULATION_ONLY must remain enabled")
    if not endpoint or "://" not in endpoint:
        raise BridgeError("BRIDGE_CONFIG_INVALID", f"Malformed simulation endpoint {endpoint!r}")
    parsed = urlparse(endpoint)
    transport = (parsed.scheme or "").lower()
    if transport not in ALLOWED_TRANSPORTS:
        raise BridgeError(
            "BRIDGE_CONFIG_INVALID", f"Unsupported simulation transport {transport!r}"
        )
    host = parsed.hostname or ""
    if not _is_local_host(host):
        raise BridgeError(
            "NON_LOCAL_ENDPOINT_REJECTED",
            "Only local simulation endpoints are permitted",
            f"rejected host {host!r} in {endpoint!r}",
        )
    port = parsed.port
    if port is None:
        raise BridgeError("BRIDGE_CONFIG_INVALID", f"Simulation endpoint needs a port: {endpoint!r}")
    if port not in ALLOWED_SIMULATION_PORTS:
        raise BridgeError(
            "NON_LOCAL_ENDPOINT_REJECTED",
            "Port is not a configured local simulation port",
            f"port {port} not in {sorted(ALLOWED_SIMULATION_PORTS)}",
        )
    return transport, host or "127.0.0.1", port


def _env(name: str, default: str) -> str:
    return os.environ.get(f"DSS_BRIDGE_{name}", default)


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        raise BridgeError("BRIDGE_CONFIG_INVALID", f"DSS_BRIDGE_{name} must be numeric")


@dataclass(frozen=True)
class Settings:
    """Safe local defaults; every value overridable via ``DSS_BRIDGE_*`` env vars."""

    host: str = field(default_factory=lambda: _env("HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(_env("PORT", "8787")))
    px4_endpoint: str = field(default_factory=lambda: _env("PX4_ENDPOINT", "udpin://127.0.0.1:14540"))
    connection_timeout_s: float = field(default_factory=lambda: _env_float("CONNECT_TIMEOUT", 10.0))
    setpoint_rate_hz: float = field(default_factory=lambda: _env_float("SETPOINT_RATE", 25.0))
    telemetry_rate_hz: float = field(default_factory=lambda: _env_float("TELEMETRY_RATE", 25.0))
    end_hold_s: float = field(default_factory=lambda: _env_float("END_HOLD", 2.0))
    start_hold_s: float = field(default_factory=lambda: _env_float("START_HOLD", 1.0))
    warning_tracking_error_m: float = field(default_factory=lambda: _env_float("WARN_ERROR", 1.0))
    failure_tracking_error_m: float = field(default_factory=lambda: _env_float("FAIL_ERROR", 5.0))
    allowed_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in _env(
                "ALLOWED_ORIGINS",
                "http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173",
            ).split(",")
            if o.strip()
        )
    )
    max_trajectory_samples: int = 600_000

    def validate(self) -> "Settings":
        if not _is_local_host(self.host):
            raise BridgeError(
                "BRIDGE_CONFIG_INVALID",
                "Bridge must bind to loopback in Sprint 5",
                f"host {self.host!r}",
            )
        assert_local_endpoint(self.px4_endpoint)
        for rate, name in ((self.setpoint_rate_hz, "SETPOINT_RATE"), (self.telemetry_rate_hz, "TELEMETRY_RATE")):
            if not (1.0 <= rate <= 200.0):
                raise BridgeError("BRIDGE_CONFIG_INVALID", f"DSS_BRIDGE_{name} out of range (1..200 Hz)")
        if self.failure_tracking_error_m <= self.warning_tracking_error_m:
            raise BridgeError(
                "BRIDGE_CONFIG_INVALID", "failure threshold must exceed the warning threshold"
            )
        if any(not _is_local_host(urlparse(o).hostname or "") for o in self.allowed_origins):
            raise BridgeError("BRIDGE_CONFIG_INVALID", "CORS origins must be local studio origins")
        return self


def get_settings() -> Settings:
    return Settings().validate()
