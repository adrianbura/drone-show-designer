/**
 * SIMULATION LAYER — types only (Sprint 5).
 *
 * This module describes the contract between Drone Show Studio (design +
 * validation) and the LOCAL simulation bridge service (PX4 SITL transport,
 * timing, telemetry, tracking analysis).
 *
 * HARD BOUNDARY: nothing here imports MAVSDK, MAVLink or PX4 code. The studio
 * core stays fully usable with no bridge and no PX4 installed. All PX4 specific
 * behaviour lives in the Python service under `simulation_bridge/`.
 *
 * SIMULATION ONLY: the bridge refuses non-local endpoints and exposes no
 * generic arm/takeoff/goto/land control. There is no physical-aircraft path.
 */
import type { Vector3Tuple } from "../show/types";

export const SIMULATION_PACKAGE_SCHEMA = "DroneShowStudioSimulationPackage" as const;
export const SIMULATION_PACKAGE_SCHEMA_VERSION = 1;
export const SIMULATION_REPORT_SCHEMA_NAME = "DroneShowStudioSimulationReport";
export const SIMULATION_REPORT_SCHEMA_VERSION = "1.0";
/** Version of the studio-side package builder / client. */
export const SIMULATION_CLIENT_VERSION = "0.1.0";
export const BRIDGE_API_VERSION = "v1";

/* --------------------------------------------------------------- validation */

/**
 * How the show's own validation state gates simulation execution. Derived from
 * the full-show validation report — never asserted by the simulation layer.
 */
export type PackageValidationState =
  | "VALIDATED"
  | "VALIDATED_WITH_WARNINGS"
  | "FAILED_VALIDATION"
  | "STALE_VALIDATION"
  | "UNVALIDATED";

/** Sprint 5 policy: only these two states may run a real show trajectory. */
export const RUNNABLE_VALIDATION_STATES: readonly PackageValidationState[] = [
  "VALIDATED",
  "VALIDATED_WITH_WARNINGS",
];

export function isRunnableValidationState(state: PackageValidationState): boolean {
  return RUNNABLE_VALIDATION_STATES.includes(state);
}

export interface SimulationValidationProvenance {
  readonly state: PackageValidationState;
  /** Full-show report status, when a report exists. */
  readonly fullShowStatus: string | null;
  readonly statement: string | null;
  readonly stale: boolean;
  readonly exportReadiness: string | null;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly engineVersion: string | null;
}

/* ------------------------------------------------------------------ package */

export interface SimulationSample {
  /** Show-relative time in seconds. Negative inside the pre-show region. */
  readonly t: number;
  readonly p: readonly [number, number, number];
  readonly v: readonly [number, number, number];
}

export interface SimulationDroneTrajectory {
  readonly droneId: string;
  readonly droneIndex: number;
  readonly homePosition: Vector3Tuple;
  readonly sampleCount: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
  readonly samples: readonly SimulationSample[];
}

export interface SimulationPackage {
  readonly schema: typeof SIMULATION_PACKAGE_SCHEMA;
  readonly schemaVersion: number;
  readonly generator: string;
  readonly clientVersion: string;
  readonly showPackageId: string;
  readonly analysisRevision: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly coordinateSystem: {
    readonly id: string;
    readonly axes: Readonly<Record<string, string>>;
    readonly handedness: string;
    readonly altitudeAxis: "y";
  };
  readonly sampleRate: number;
  /** Show time zero is always 0; positive is artistic show time. */
  readonly showTimeZero: 0;
  readonly operationalTiming: {
    readonly firstPlayableShowTime: number;
    readonly showStartOperationalTime: number;
    readonly includesPreShow: boolean;
  };
  readonly algorithmVersions: Readonly<Record<string, string>>;
  readonly validationProvenance: SimulationValidationProvenance;
  readonly trajectory: SimulationDroneTrajectory;
  /** Deterministic integrity digest — see hash.ts (mirrored in the bridge). */
  readonly payloadHash: string;
}

/* ------------------------------------------------------------------- bridge */

export type SimulationEnvironmentMode = "PX4_SITL" | "MOCK";

export interface SimulationEnvironment {
  readonly mode: SimulationEnvironmentMode;
  readonly vehicleCount: number;
  readonly transport: string;
  readonly endpoint: string;
  readonly simulationOnly: boolean;
  readonly simulatorMetadata: Readonly<Record<string, unknown>>;
}

export interface BridgeHealth {
  readonly status: "ok";
  readonly bridgeVersion: string;
  readonly bridgeApiVersion: string;
  readonly bridgeAlgorithmVersion: string;
  readonly simulationOnly: true;
  readonly px4Available: boolean;
  readonly px4Detail: string;
  readonly adapters: readonly {
    readonly id: string;
    readonly implemented: boolean;
    readonly kind: string;
    readonly version: string;
  }[];
}

export type SimulationState =
  | "IDLE"
  | "PACKAGE_LOADED"
  | "PX4_CONNECTING"
  | "PX4_CONNECTED"
  | "READY"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type SimulationRunStatus = "PASS" | "PASS_WITH_WARNINGS" | "FAIL" | "CANCELLED" | "RUNNING";

export type BridgeErrorCode =
  | "BRIDGE_CONFIG_INVALID"
  | "NON_LOCAL_ENDPOINT_REJECTED"
  | "PACKAGE_INVALID"
  | "PACKAGE_STALE"
  | "SHOW_VALIDATION_FAILED"
  | "PX4_NOT_AVAILABLE"
  | "PX4_CONNECTION_FAILED"
  | "VEHICLE_NOT_DISCOVERED"
  | "MULTIPLE_SYSTEMS_NOT_SUPPORTED"
  | "TRAJECTORY_INVALID"
  | "SIMULATION_NOT_READY"
  | "SIMULATION_ALREADY_RUNNING"
  | "SIMULATION_CANCELLED"
  | "TELEMETRY_UNAVAILABLE"
  | "SIMULATION_EXECUTION_FAILED"
  | "BRIDGE_UNREACHABLE";

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly detail: string;
  constructor(code: BridgeErrorCode, message: string, detail = "") {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.detail = detail;
  }
}

export interface PackageValidationResponse {
  readonly accepted: boolean;
  readonly payloadHash: string;
  readonly errors: readonly { readonly code: string; readonly message: string }[];
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
  readonly validationState: PackageValidationState;
  readonly runnable: boolean;
}

export interface PrepareResponse {
  readonly runId: string;
  readonly state: SimulationState;
  readonly environment: SimulationEnvironment;
  readonly payloadHash: string;
  readonly setpointRate: number;
  readonly telemetryRate: number;
}

export interface TrackingMetrics {
  readonly sampleCount: number;
  readonly rmsPositionError: number;
  readonly meanPositionError: number;
  readonly maxPositionError: number;
  readonly p95PositionError: number;
  readonly finalPositionError: number;
  readonly rmsErrorX: number;
  readonly rmsErrorY: number;
  readonly rmsErrorZ: number;
  readonly rmsVelocityError: number | null;
  readonly maxVelocityError: number | null;
  readonly estimatedTrackingLagSeconds: number | null;
}

export interface TrackingPoint {
  readonly t: number;
  readonly planned: readonly [number, number, number];
  readonly actual: readonly [number, number, number];
  readonly error: number;
}

export interface SimulationRunReport {
  readonly simulationReportSchema: string;
  readonly simulationReportSchemaVersion: string;
  readonly runId: string;
  readonly state: SimulationState;
  readonly status: SimulationRunStatus;
  readonly statement: string;
  readonly environment: SimulationEnvironment;
  readonly trajectorySource: "TEST_TRAJECTORY" | "SHOW_TRAJECTORY";
  readonly showPackageId: string | null;
  readonly analysisRevision: string | null;
  readonly simulationPayloadHash: string | null;
  readonly selectedDroneId: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationSeconds: number;
  readonly setpointRate: number;
  readonly telemetryRate: number;
  readonly coordinateMapping: Readonly<Record<string, string>>;
  readonly coordinateCalibration: Readonly<Record<string, string>> | null;
  readonly trackingMetrics: TrackingMetrics | null;
  readonly trackingSeries: readonly TrackingPoint[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly versions: Readonly<Record<string, string>>;
}

export interface SimulationRunStateSnapshot {
  readonly runId: string;
  readonly state: SimulationState;
  readonly status: SimulationRunStatus;
  readonly elapsedSeconds: number;
  readonly progress: number;
  readonly stage: string;
  readonly latest: TrackingPoint | null;
  readonly environmentMode: SimulationEnvironmentMode;
  readonly droneId: string | null;
}

export interface SimulationRunHistoryEntry {
  readonly runId: string;
  readonly droneId: string | null;
  readonly timestamp: string;
  readonly status: SimulationRunStatus;
  readonly environmentMode: SimulationEnvironmentMode;
  readonly rmsPositionError: number | null;
  readonly maxPositionError: number | null;
}
