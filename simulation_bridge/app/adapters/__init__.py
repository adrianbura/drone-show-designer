"""
SimulationAdapterRegistry.

Distinguishes internal export adapters (studio side), simulation adapters (this
service) and future fleet adapters. Sprint 5 implements MOCK and
PX4_SITL_MAVSDK; MDS and any real-fleet target are declared NOT implemented.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models.errors import BridgeError
from .base import SimulationVehicleAdapter
from .mds import MdsSimulationAdapter
from .mock import MockSimulationVehicleAdapter
from .px4 import PX4_ADAPTER_VERSION, Px4SitlMavsdkAdapter, mavsdk_available


@dataclass(frozen=True)
class AdapterDescriptor:
    id: str
    kind: str
    version: str
    implemented: bool
    notes: str


SIMULATION_ADAPTER_REGISTRY: tuple[AdapterDescriptor, ...] = (
    AdapterDescriptor("MOCK", "simulation", MockSimulationVehicleAdapter.version, True,
                      "In-process mock vehicle. Synthetic telemetry, labelled MOCK."),
    AdapterDescriptor("PX4_SITL_MAVSDK", "simulation", PX4_ADAPTER_VERSION, True,
                      "Local PX4 SITL over MAVSDK offboard local-NED setpoints."),
    AdapterDescriptor("MDS", "simulation", "0.0.0", False,
                      "Placeholder only — MDS execution is future work."),
    AdapterDescriptor("REAL_FLEET", "fleet", "0.0.0", False,
                      "Not implemented and out of scope: no physical-aircraft path exists."),
)


def create_adapter(environment_mode: str) -> SimulationVehicleAdapter:
    if environment_mode == "MOCK":
        return MockSimulationVehicleAdapter()
    if environment_mode == "PX4_SITL":
        if not mavsdk_available():
            raise BridgeError(
                "PX4_NOT_AVAILABLE",
                "MAVSDK is not installed — mock mode is available instead",
                "pip install '.[px4]' inside simulation_bridge/",
            )
        return Px4SitlMavsdkAdapter()
    if environment_mode == "MDS":
        return MdsSimulationAdapter()
    raise BridgeError("BRIDGE_CONFIG_INVALID", f"unknown environment mode {environment_mode!r}")


__all__ = [
    "AdapterDescriptor",
    "SIMULATION_ADAPTER_REGISTRY",
    "SimulationVehicleAdapter",
    "MockSimulationVehicleAdapter",
    "Px4SitlMavsdkAdapter",
    "MdsSimulationAdapter",
    "create_adapter",
    "mavsdk_available",
]
