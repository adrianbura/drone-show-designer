"""Run-time models: telemetry, tracking points, metrics and the run report."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field

SIMULATION_REPORT_SCHEMA = "DroneShowStudioSimulationReport"
SIMULATION_REPORT_SCHEMA_VERSION = "1.0"

RunMode = Literal["TEST_TRAJECTORY", "SHOW_TRAJECTORY"]
EnvironmentMode = Literal["PX4_SITL", "MOCK"]


@dataclass(frozen=True)
class SimulationReference:
    """One resampled setpoint: operational time + studio-frame reference."""

    t_operational: float
    t_show: float
    position: tuple[float, float, float]
    velocity: tuple[float, float, float]


@dataclass(frozen=True)
class TelemetrySample:
    """
    Captured vehicle state. Missing fields are reported as ``None`` — the PX4
    adapter never fabricates values.
    """

    t_operational: float
    position_studio: tuple[float, float, float] | None
    velocity_studio: tuple[float, float, float] | None
    connected: bool
    mode: str | None = None
    available: bool = True


@dataclass
class TrackingPoint:
    t: float
    planned: tuple[float, float, float]
    actual: tuple[float, float, float]
    error: float
    planned_velocity: tuple[float, float, float] | None = None
    actual_velocity: tuple[float, float, float] | None = None


class TrackingMetrics(BaseModel):
    sampleCount: int
    rmsPositionError: float
    meanPositionError: float
    maxPositionError: float
    p95PositionError: float
    finalPositionError: float
    rmsErrorX: float
    rmsErrorY: float
    rmsErrorZ: float
    rmsVelocityError: float | None = None
    maxVelocityError: float | None = None
    estimatedTrackingLagSeconds: float | None = None


class SimulationEnvironment(BaseModel):
    mode: EnvironmentMode
    vehicleCount: int = 1
    transport: str = "udpin"
    endpoint: str = ""
    simulationOnly: bool = True
    simulatorMetadata: dict[str, Any] = Field(default_factory=dict)


class SimulationRunReport(BaseModel):
    simulationReportSchema: str = SIMULATION_REPORT_SCHEMA
    simulationReportSchemaVersion: str = SIMULATION_REPORT_SCHEMA_VERSION
    runId: str
    state: str
    status: str
    statement: str
    environment: SimulationEnvironment
    trajectorySource: RunMode
    showPackageId: str | None
    analysisRevision: str | None
    simulationPayloadHash: str | None
    selectedDroneId: str | None
    startedAt: str
    finishedAt: str | None
    durationSeconds: float
    setpointRate: float
    telemetryRate: float
    coordinateMapping: dict[str, str]
    coordinateCalibration: dict[str, str] | None = None
    trackingMetrics: TrackingMetrics | None
    trackingSeries: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    versions: dict[str, str] = Field(default_factory=dict)


@dataclass
class RunRecord:
    """In-memory record for one simulation execution."""

    run_id: str
    mode: RunMode
    environment_mode: EnvironmentMode
    show_package_id: str | None
    analysis_revision: str | None
    payload_hash: str | None
    drone_id: str | None
    started_at: str
    bridge_version: str
    adapter_version: str
    references: list[SimulationReference] = field(default_factory=list)
    telemetry: list[TelemetrySample] = field(default_factory=list)
    tracking: list[TrackingPoint] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    simulator_metadata: dict[str, Any] = field(default_factory=dict)
    finished_at: str | None = None
    duration_s: float = 0.0
    elapsed_s: float = 0.0
    stage: str = "Idle"
    status: str = "RUNNING"
    calibration: dict[str, str] | None = None
