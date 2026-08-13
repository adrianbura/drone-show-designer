"""
SimulationPackage — the documented input contract.

The bridge accepts ONLY this versioned package; it never receives raw studio UI
state. Everything is validated before a run can be prepared.
"""

from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SUPPORTED_PACKAGE_SCHEMA = "DroneShowStudioSimulationPackage"
SUPPORTED_PACKAGE_SCHEMA_VERSIONS = (1,)
KNOWN_COORDINATE_SYSTEMS = ("show-local",)

VALIDATION_STATES = (
    "VALIDATED",
    "VALIDATED_WITH_WARNINGS",
    "FAILED_VALIDATION",
    "STALE_VALIDATION",
    "UNVALIDATED",
)
RUNNABLE_VALIDATION_STATES = ("VALIDATED", "VALIDATED_WITH_WARNINGS")


class CoordinateSystem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    handedness: str = "right-handed"
    altitudeAxis: str = "y"


class OperationalTiming(BaseModel):
    model_config = ConfigDict(extra="allow")

    firstPlayableShowTime: float = 0.0
    showStartOperationalTime: float = 0.0
    includesPreShow: bool = False


class ValidationProvenance(BaseModel):
    model_config = ConfigDict(extra="allow")

    state: str
    fullShowStatus: str | None = None
    statement: str | None = None
    stale: bool = False
    exportReadiness: str | None = None
    errorCount: int = 0
    warningCount: int = 0
    engineVersion: str | None = None


class PackageSample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    t: float
    p: tuple[float, float, float]
    v: tuple[float, float, float] = (0.0, 0.0, 0.0)

    def finite(self) -> bool:
        return all(math.isfinite(x) for x in (self.t, *self.p, *self.v))


class PackageTrajectory(BaseModel):
    model_config = ConfigDict(extra="allow")

    droneId: str
    droneIndex: int = 0
    homePosition: tuple[float, float, float] = (0.0, 0.0, 0.0)
    sampleCount: int = 0
    startTime: float = 0.0
    endTime: float = 0.0
    duration: float = 0.0
    samples: list[PackageSample] = Field(default_factory=list)


class SimulationPackage(BaseModel):
    """Immutable during a run: the runner never mutates a loaded package."""

    model_config = ConfigDict(extra="allow", frozen=True)

    schema_: Literal["DroneShowStudioSimulationPackage"] = Field(alias="schema")
    schemaVersion: int
    generator: str = "Drone Show Studio"
    clientVersion: str = "unknown"
    showPackageId: str
    analysisRevision: str
    projectId: str = ""
    projectName: str = ""
    coordinateSystem: CoordinateSystem
    sampleRate: float
    showTimeZero: float = 0.0
    operationalTiming: OperationalTiming = Field(default_factory=OperationalTiming)
    algorithmVersions: dict[str, Any] = Field(default_factory=dict)
    validationProvenance: ValidationProvenance
    trajectory: PackageTrajectory
    payloadHash: str
