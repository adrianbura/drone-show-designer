/**
 * PRE-SHOW DOMAIN MODEL — launch grid, staging, grouped takeoff.
 *
 * This package answers one question: how does the fleet get from PHYSICAL
 * GROUND PADS to an AERIAL STAGING FORMATION before the artistic show starts?
 * It models choreography only. Nothing here arms, commands or communicates with
 * a real aircraft, and no autopilot/MAVLink/PX4 concept exists in this package.
 *
 * TIME MODEL
 *   Show time is canonical and stays the clock used by every other engine.
 *   Pre-show occupies NEGATIVE show time:
 *
 *     showTime            = operationalTime - showStartOperationalTime
 *     showStartOperationalTime = preShowDuration
 *
 *   So the first liftoff happens at showTime = -preShowDuration + groupStart and
 *   SHOW TIME ZERO is exactly t = 0, unchanged for the artistic timeline and for
 *   audio synchronisation.
 *
 * COORDINATES
 *   The existing show-local frame (metres, +Y up, see coordinates.ts). No second
 *   convention is introduced. Friendly UI labels map as:
 *     Left / Right  -> +X is right
 *     Forward / Back-> +Z is forward
 *     Altitude      -> +Y
 *   Rotation is a yaw about +Y in degrees: +X rotates toward +Z.
 */
import type { AssignmentStrategyId, DroneAssignment } from "../assignment";
import type { RGB, Vector3Tuple } from "../types";

export const LAUNCH_ALGORITHM_VERSION = "0.1.0";
export const STAGING_ALGORITHM_VERSION = "0.1.0";
export const PRE_SHOW_ENGINE_VERSION = "0.1.0";

/* ------------------------------------------------------------- launch grid */

export interface LaunchGridConfig {
  readonly kind: "grid";
  readonly rows: number;
  readonly columns: number;
  readonly spacingX: number;
  readonly spacingZ: number;
  /** Grid centre in show-local metres (X = left/right, Z = forward/back). */
  readonly originX: number;
  readonly originZ: number;
  readonly groundAltitude: number;
  /** Yaw of the whole grid about its own centre, degrees. */
  readonly rotationDeg: number;
}

/** Only GRID exists today; the union keeps future layouts additive. */
export type LaunchLayoutConfig = LaunchGridConfig;

export interface LaunchPad {
  readonly id: string;
  readonly index: number;
  readonly position: Vector3Tuple;
  readonly row: number;
  readonly column: number;
}

export interface LaunchBounds {
  readonly width: number;
  readonly depth: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface LaunchLayout {
  readonly kind: "grid";
  readonly rows: number;
  readonly columns: number;
  readonly pads: LaunchPad[];
  /** Explicit identity mapping, e.g. DRN-037 -> PAD-084. */
  readonly droneToPad: Readonly<Record<string, string>>;
  readonly padToDrone: Readonly<Record<string, string>>;
  readonly bounds: LaunchBounds;
  readonly center: Vector3Tuple;
  /** Smallest static pad-to-pad distance. NOT a dynamic flight separation. */
  readonly minPadSpacing: number;
  readonly duplicatePads: readonly (readonly [string, string])[];
  readonly config: LaunchGridConfig;
  readonly algorithmVersion: string;
}

/* ----------------------------------------------------------------- staging */

export type StagingFormationKind = "grid" | "circle" | "formation";

export interface StagingConfiguration {
  readonly formationKind: StagingFormationKind;
  /** Referenced project formation id when formationKind === "formation". */
  readonly formationId: string | null;
  readonly spacing: number;
  /** Optional explicit grid shape; derived from the fleet size when absent. */
  readonly rows: number | null;
  readonly columns: number | null;
  /** Metres above ground. Never derived from the first artistic formation. */
  readonly altitude: number;
  /** +X offset of the staging centre relative to the LAUNCH GRID centre. */
  readonly leftRight: number;
  /** +Z offset of the staging centre relative to the LAUNCH GRID centre. */
  readonly forwardBack: number;
  /** Yaw about the STAGING CENTRE, degrees. */
  readonly rotationDeg: number;
}

export interface StagingBounds {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly minStaticSpacing: number;
}

export interface StagingLayout {
  /** Exactly project.droneCount targets, in formation-point order. */
  readonly targets: Vector3Tuple[];
  readonly center: Vector3Tuple;
  readonly bounds: StagingBounds;
  readonly config: StagingConfiguration;
  readonly formationKind: StagingFormationKind;
  readonly algorithmVersion: string;
}

/* ------------------------------------------------------------------ groups */

export type LaunchGroupingStrategy = "ROWS" | "COLUMNS" | "BLOCKS" | "MANUAL";
/** Architected for future CHECKERBOARD / CENTER_OUT / OUTSIDE_IN / OPTIMIZED. */
export type LaunchGroupOrder = "forward" | "reverse";

export interface LaunchGroupingConfig {
  readonly strategy: LaunchGroupingStrategy;
  readonly rowsPerGroup: number;
  readonly columnsPerGroup: number;
  readonly blockRows: number;
  readonly blockColumns: number;
  readonly order: LaunchGroupOrder;
  readonly groupIntervalSeconds: number;
  /** Per-group absolute start-time override in operational seconds. */
  readonly startTimeOverrides: Readonly<Record<string, number>>;
  /** MANUAL strategy: drone ids per group, in launch order. */
  readonly manualGroups: readonly (readonly string[])[];
}

export interface LaunchGroup {
  readonly id: string;
  readonly index: number;
  readonly droneIds: string[];
  readonly droneIndices: number[];
  readonly padIds: string[];
  /** Operational seconds from the first liftoff opportunity (t = 0). */
  readonly startTime: number;
  readonly delayFromPrevious: number;
  readonly strategyMetadata: Readonly<Record<string, number | string>>;
}

/* ------------------------------------------------------------------ config */

export type PreShowLightingPolicy = "OFF" | "DIM";
export type PreShowTransitMode = "clearanceFirst" | "direct";

export interface PreShowConfig {
  readonly enabled: boolean;
  readonly launch: LaunchLayoutConfig;
  readonly staging: StagingConfiguration;
  readonly grouping: LaunchGroupingConfig;
  /** Vertical clearance reached before any significant horizontal travel. */
  readonly initialClearance: number;
  readonly ascentDuration: number;
  readonly transitDuration: number;
  readonly stagingHold: number;
  readonly lighting: PreShowLightingPolicy;
  readonly lightingColor: RGB;
  readonly assignmentStrategy: AssignmentStrategyId;
  readonly transitMode: PreShowTransitMode;
}

/* ------------------------------------------------------------------ phases */

export type PreShowPhaseName =
  | "GROUND_WAIT"
  | "LIFTOFF"
  | "INITIAL_ASCENT"
  | "STAGING_TRANSIT"
  | "FORM_UP"
  | "STAGING_HOLD"
  | "SHOW_READY";

/** Window in OPERATIONAL seconds (0 = first liftoff opportunity). */
export interface PreShowPhaseWindow {
  readonly phase: PreShowPhaseName;
  readonly start: number;
  readonly end: number;
}

/* ----------------------------------------------------------------- metrics */

export interface LaunchGroupMetrics {
  readonly groupId: string;
  readonly droneCount: number;
  readonly startTime: number;
  readonly duration: number;
  readonly minimumSeparation: number;
  readonly maximumVelocity: number;
  readonly maximumAcceleration: number;
  readonly maximumJerk: number;
  readonly totalDistance: number;
  readonly maximumIndividualDistance: number;
  readonly conflictCount: number;
}

export interface PreShowMetrics {
  readonly droneCount: number;
  readonly groupCount: number;
  readonly preShowDuration: number;
  readonly firstLiftoffTime: number;
  readonly lastLiftoffTime: number;
  readonly allDronesAtStagingTime: number;
  readonly showReadyTime: number;
  readonly minimumSeparation: number;
  readonly maximumVelocity: number;
  readonly maximumAcceleration: number;
  readonly maximumJerk: number;
  readonly totalConflicts: number;
  readonly uniqueConflictPairs: number;
  readonly totalDistance: number;
  readonly maximumIndividualDistance: number;
  readonly minPadSpacing: number;
  readonly planningMs: number;
}

/* -------------------------------------------------------------------- plan */

export interface PreShowSegmentInfo {
  readonly droneIndex: number;
  readonly droneId: string;
  readonly groupId: string;
  readonly phase: PreShowPhaseName;
  /** Show time (negative during pre-show). */
  readonly start: number;
  readonly end: number;
}

export interface PreShowAlgorithmVersions {
  readonly preShowEngine: string;
  readonly launch: string;
  readonly staging: string;
  readonly assignment: string;
}

/**
 * Deterministic pre-show plan. `schedules` are continuous per-drone schedules in
 * SHOW time spanning [-duration, 0]; there is no animation-only shortcut.
 */
export interface PreShowPlan {
  readonly droneCount: number;
  readonly layout: LaunchLayout;
  readonly staging: StagingLayout;
  readonly groups: LaunchGroup[];
  readonly phases: PreShowPhaseWindow[];
  readonly segments: PreShowSegmentInfo[];
  /** Operational duration of the whole pre-show, seconds. */
  readonly duration: number;
  readonly showStartOperationalTime: number;
  readonly firstLiftoffTime: number;
  readonly lastLiftoffTime: number;
  readonly allDronesAtStagingTime: number;
  readonly showReadyTime: number;
  /** Launch pad -> staging target assignment (AssignmentEngine output). */
  readonly assignments: DroneAssignment[];
  readonly assignmentStrategy: string;
  /** Staging target per drone index, after assignment. */
  readonly targetByDrone: Vector3Tuple[];
  readonly groupIdByDrone: string[];
  readonly config: PreShowConfig;
  readonly algorithmVersions: PreShowAlgorithmVersions;
  readonly errors: PreShowError[];
  readonly planningMs: number;
}

/* ----------------------------------------------------------------- errors */

export type PreShowErrorCode =
  | "INVALID_LAUNCH_LAYOUT"
  | "DUPLICATE_PAD"
  | "INVALID_STAGING"
  | "MISSING_STAGING_FORMATION"
  | "INVALID_GROUPING"
  | "GROUP_MEMBERSHIP_INVALID"
  | "INFEASIBLE_DURATION";

export class PreShowError extends Error {
  readonly code: PreShowErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(code: PreShowErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PreShowError";
    this.code = code;
    this.details = details;
  }
}

/* ------------------------------------------------------------ validation */

export type PreShowStatus = "VALID" | "WARNING" | "FAIL";

export const PRE_SHOW_STATUS_LABELS: Record<PreShowStatus, string> = {
  VALID: "PRE-SHOW VALID",
  WARNING: "PRE-SHOW WARNING",
  FAIL: "PRE-SHOW FAIL",
};

/**
 * PRE-SHOW VALID means "no violation of the configured simulation profile was
 * detected in the pre-show trajectories". It is never "safe to launch" and
 * never a flight certification.
 */
export const PRE_SHOW_HONESTY_STATEMENT =
  "Pre-show validated against the configured simulation and safety profile only. Wind, GNSS, battery, radio link, site approval and airspace clearance are out of scope; this is not an authorisation to launch.";
