/**
 * FULL SHOW ENGINE — domain model.
 *
 * A FullShowPlan is the semantic description of an ENTIRE show (every phase,
 * every transition, every hold) whose final trajectory representation is the
 * existing canonical `TrajectorySet`. There is deliberately no second
 * trajectory format: the object validated here is the object played back and
 * exported.
 *
 * Nothing in this package models hardware, radio, battery, GNSS or wind, and a
 * PASS status means only "validated against the current simulation/safety
 * profile" — never "safe to fly".
 */
import type { AssignmentStrategyId } from "../assignment";
import type { ConflictReport, TrajectoryConflict } from "../conflicts";
import type { DroneDefinition } from "../drones";
import type { SafetyReport } from "../safety";
import type { ClipTransitionOverride, ShowPlan } from "../trajectory/schedule";
import type { TrajectorySet } from "../trajectory/types";
import type { PreShowPlan } from "../preshow/types";
import type { PreShowValidationReport } from "../preshow/validate";
import type { RGB, ShowPhase, ShowProject } from "../types";
import type {
  EffectiveTrajectoryAuthority,
  ReferenceAuthorityInput,
  SpliceContinuityReport,
} from "./effective";

export const FULL_SHOW_ENGINE_VERSION = "0.1.0";

/* ------------------------------------------------------------------ errors */

export type FullShowErrorCode =
  | "INVALID_TIMELINE"
  | "MISSING_FORMATION"
  | "MISSING_TAKEOFF"
  | "MISSING_LANDING"
  | "TRAJECTORY_COMPOSITION_FAILED"
  | "TIME_DISCONTINUITY"
  | "DRONE_ID_MISMATCH"
  | "CONFLICT_ANALYSIS_FAILED"
  | "SAFETY_VALIDATION_FAILED"
  | "ANALYSIS_CANCELLED"
  | "STALE_INPUT";

export interface FullShowErrorDetails {
  readonly clipId?: string;
  readonly droneId?: string;
  readonly time?: number;
  readonly [key: string]: unknown;
}

/** Structured failure surfaced to the UI as a message, never as a stack trace. */
export class FullShowError extends Error {
  readonly code: FullShowErrorCode;
  readonly details: FullShowErrorDetails;

  constructor(code: FullShowErrorCode, message: string, details: FullShowErrorDetails = {}) {
    super(message);
    this.name = "FullShowError";
    this.code = code;
    this.details = details;
  }
}

/* --------------------------------------------------------------- structure */

/** One resolved slice of the timeline in absolute show time. */
export interface ShowSegment {
  readonly clipId: string;
  readonly phase: ShowPhase;
  readonly kind: "transition" | "hold";
  readonly start: number;
  readonly end: number;
  readonly formationId: string | null;
}

export type TransitionStatus = "notAnalyzed" | "analyzed" | "optimized" | "unresolved";

/** Per-clip transition record composed into the full show. */
export interface ShowTransition {
  readonly clipId: string;
  readonly phase: ShowPhase;
  readonly formationId: string | null;
  readonly formationName: string | null;
  readonly start: number;
  readonly transition: number;
  readonly hold: number;
  readonly end: number;
  readonly status: TransitionStatus;
  readonly assignmentStrategy: string;
}

export interface ShowHold {
  readonly clipId: string;
  readonly phase: ShowPhase;
  readonly start: number;
  readonly end: number;
}

export interface PhaseWindow {
  readonly phase: ShowPhase;
  readonly start: number;
  readonly end: number;
  readonly clipIds: string[];
}

/* ------------------------------------------------------------------- plan */

export interface FullShowPlanMetadata {
  readonly generatedAt: number;
  readonly analysisRevision: string;
  readonly showPackageId: string;
  readonly assignmentStrategy: AssignmentStrategyId;
  readonly overriddenClipIds: string[];
  readonly compositionMs: number;
  readonly samplingMs: number;
  readonly trajectoryMemoryEstimateBytes: number;
}

export interface FullShowAlgorithmVersions {
  readonly schema: string;
  readonly fullShowEngine: string;
  readonly trajectory: string;
  readonly formation: string;
  readonly assignment: string;
  readonly optimizer: string;
  readonly conflictDetection: string;
}

/**
 * Semantic full-show plan. `trajectorySet` is the canonical composed set that
 * every downstream consumer (conflicts, safety, playback, export) reads.
 */
export interface FullShowPlan {
  readonly projectId: string;
  readonly droneCount: number;
  /** Artistic show duration (show time 0 .. duration). */
  readonly duration: number;
  /** First covered show time: -preShowDuration, or 0 without a pre-show. */
  readonly startTime: number;
  /** duration - startTime: the whole operation, pre-show included. */
  readonly operationalDuration: number;
  /** Operational time of SHOW TIME ZERO (= pre-show duration). */
  readonly showStartOperationalTime: number;
  readonly preShow: PreShowPlan | null;
  readonly sampleRate: number;
  readonly drones: readonly DroneDefinition[];
  readonly phases: PhaseWindow[];
  readonly segments: ShowSegment[];
  readonly transitions: ShowTransition[];
  readonly holds: ShowHold[];
  /**
   * THE EFFECTIVE TRAJECTORY: reference-owned intervals carry the imported
   * samples, planner-owned intervals the composed planner output. Every
   * validation, metric, simulation and export reads exactly this set.
   */
  readonly trajectorySet: TrajectorySet;
  /** The pure planner output on the same grid (diagnostics and splice checks). */
  readonly plannerTrajectorySet: TrajectorySet;
  /** Which authority produced which part of `trajectorySet`. */
  readonly effectiveAuthority: EffectiveTrajectoryAuthority;
  /** Boundary agreement between the two authorities (null when planner-only). */
  readonly splice: SpliceContinuityReport | null;
  /** The continuous plan the set was sampled from — playback uses this. */
  readonly showPlan: ShowPlan;
  readonly metadata: FullShowPlanMetadata;
  readonly algorithmVersions: FullShowAlgorithmVersions;
  readonly errors: FullShowError[];
  readonly warnings: FullShowIssue[];
}

export interface ComposeFullShowOptions {
  readonly sampleRate?: number;
  readonly assignmentStrategy?: AssignmentStrategyId;
  readonly transitionOverrides?: Readonly<Record<string, ClipTransitionOverride>>;
  /** Clip ids that have been analysed but not optimised. */
  readonly analyzedClipIds?: readonly string[];
  /** Clip ids whose analysis still reports unresolved conflicts. */
  readonly unresolvedClipIds?: readonly string[];
  /**
   * Imported ESSP authority. When present the composed set is SPLICED: the
   * analysis judges what actually flies, not the planner-only approximation.
   */
  readonly reference?: ReferenceAuthorityInput | null;
}

/* ------------------------------------------------------------------ issues */

export type FullShowIssueSeverity = "error" | "warning" | "info";

export type FullShowIssueCategory =
  | "timeline"
  | "continuity"
  | "conflict"
  | "safety"
  | "homePads"
  | "takeoff"
  | "landing"
  | "lighting"
  | "transition"
  | "preShow";

export interface FullShowIssue {
  readonly id: string;
  readonly severity: FullShowIssueSeverity;
  readonly category: FullShowIssueCategory;
  readonly code: string;
  readonly message: string;
  /** Absolute show time, when the issue is time-located. */
  readonly time?: number;
  readonly clipId?: string;
  readonly phase?: ShowPhase;
  readonly droneIds?: string[];
  readonly droneIndices?: number[];
  readonly value?: number;
  readonly limit?: number;
}

/* -------------------------------------------------------- sub-report types */

export interface TimelineValidationReport {
  readonly clipCount: number;
  readonly hasTakeoff: boolean;
  readonly hasLanding: boolean;
  readonly landingCount: number;
  readonly phaseOrderValid: boolean;
  readonly duration: number;
  readonly issues: FullShowIssue[];
}

export type ContinuityIssueType =
  | "POSITION_DISCONTINUITY"
  | "TIME_GAP"
  | "TIME_OVERLAP"
  | "DUPLICATE_TIMESTAMP"
  | "NON_MONOTONIC_TIME"
  | "VELOCITY_JUMP"
  | "MISSING_DRONE"
  | "DRONE_ID_MISMATCH"
  | "COVERAGE_GAP"
  | "NOT_LANDED"
  | "WRONG_HOME_PAD";

export interface ContinuityIssue {
  readonly droneId: string;
  readonly droneIndex: number;
  readonly time: number;
  readonly type: ContinuityIssueType;
  readonly magnitude: number;
  readonly tolerance: number;
  readonly clipId?: string;
}

export interface ContinuityReport {
  readonly ok: boolean;
  readonly checkedDrones: number;
  readonly checkedSamples: number;
  readonly maxPositionDiscontinuity: number;
  readonly maxSegmentBoundaryGap: number;
  readonly issues: ContinuityIssue[];
  readonly landedCount: number;
  readonly wrongPadCount: number;
  readonly positionTolerance: number;
}

export interface HomePadReport {
  readonly padCount: number;
  readonly minSpacing: number;
  readonly duplicateCount: number;
  readonly outsideAreaCount: number;
  readonly invalidAltitudeCount: number;
  readonly nonFiniteCount: number;
  readonly issues: FullShowIssue[];
}

export interface PhaseMetrics {
  readonly phase: ShowPhase;
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  readonly minSeparation: number;
  readonly maxVelocity: number;
  readonly maxAcceleration: number;
  readonly maxJerk: number;
  readonly maxYawRate: number;
  readonly conflictCount: number;
  readonly boundaryViolations: number;
}

export interface DroneShowMetrics {
  readonly droneId: string;
  readonly index: number;
  readonly totalDistance: number;
  readonly maxVelocity: number;
  readonly maxAcceleration: number;
  readonly maxJerk: number;
  readonly maxYawRate: number;
  readonly minSeparation: number;
  readonly conflictCount: number;
  readonly maxAltitude: number;
}

export interface TransitionReport {
  readonly clipId: string;
  readonly phase: ShowPhase;
  readonly formationName: string | null;
  readonly start: number;
  readonly end: number;
  readonly status: TransitionStatus;
  readonly totalTravelDistance: number;
  readonly maxTravelDistance: number;
  readonly minSeparation: number;
  readonly maxVelocity: number;
  readonly maxAcceleration: number;
  readonly maxJerk: number;
  readonly conflictCount: number;
}

export interface TransitionAggregate {
  readonly worstByMinSeparation: string | null;
  readonly longestTravel: string | null;
  readonly highestVelocity: string | null;
  readonly highestAcceleration: string | null;
  readonly highestJerk: string | null;
  readonly mostConflicts: string | null;
}

export interface FullShowMetrics {
  readonly droneCount: number;
  readonly showDuration: number;
  readonly sampleRate: number;
  readonly totalDistanceFlown: number;
  readonly averageDistancePerDrone: number;
  readonly maxDistanceBySingleDrone: number;
  readonly minimumDynamicSeparation: number;
  readonly maximumVelocity: number;
  readonly maximumAcceleration: number;
  readonly maximumJerk: number;
  readonly maximumYawRate: number;
  readonly totalConflictCount: number;
  readonly uniqueConflictPairs: number;
  readonly unresolvedTransitionCount: number;
  readonly takeoffMinSeparation: number;
  readonly landingMinSeparation: number;
  readonly validationRuntimeMs: number;
  readonly trajectoryMemoryEstimateBytes: number;
}

export interface LightingReport {
  readonly sampledInstants: number;
  readonly invalidSamples: number;
  readonly issues: FullShowIssue[];
}

/** Contextual full-show conflict: an engine conflict plus timeline context. */
export interface ContextualConflict extends TrajectoryConflict {
  readonly clipId: string | null;
  readonly phase: ShowPhase | null;
  readonly context: string;
}

export type FullShowStatus = "PASS" | "PASS_WITH_WARNINGS" | "FAIL";

export type ExportReadinessStatus = "READY" | "READY_WITH_WARNINGS" | "BLOCKED";

export interface ExportReadiness {
  readonly status: ExportReadinessStatus;
  readonly blockers: string[];
  readonly warnings: string[];
}

export interface FullShowValidationReport {
  readonly status: FullShowStatus;
  readonly statement: string;
  readonly projectId: string;
  readonly analysisRevision: string;
  readonly showPackageId: string;
  readonly showDuration: number;
  readonly droneCount: number;
  readonly sampleRate: number;
  readonly transitionCount: number;
  readonly analyzedTransitions: number;
  readonly optimizedTransitions: number;
  readonly unresolvedTransitions: number;
  readonly conflicts: ConflictReport;
  readonly contextualConflicts: ContextualConflict[];
  readonly safety: SafetyReport;
  readonly continuity: ContinuityReport;
  /** Which authority owns which part of the validated trajectory. */
  readonly effectiveAuthority: EffectiveTrajectoryAuthority;
  /** Splice boundary agreement; null when the show is planner-only. */
  readonly splice: SpliceContinuityReport | null;
  readonly timeline: TimelineValidationReport;
  readonly homePads: HomePadReport;
  readonly lighting: LightingReport;
  /** PRE-SHOW section (launch grid, staging, takeoff schedule). */
  readonly preShow: PreShowValidationReport | null;
  readonly phaseReports: PhaseMetrics[];
  readonly transitionReports: TransitionReport[];
  readonly transitionAggregate: TransitionAggregate;
  readonly droneReports: DroneShowMetrics[];
  readonly metrics: FullShowMetrics;
  readonly exportReadiness: ExportReadiness;
  readonly warnings: FullShowIssue[];
  readonly errors: FullShowIssue[];
  readonly issues: FullShowIssue[];
  readonly stages: FullShowStageTiming[];
  readonly algorithmVersions: FullShowAlgorithmVersions;
  readonly engineVersion: string;
}

/* ---------------------------------------------------------- orchestration */

export type FullShowStage =
  | "preparing"
  | "planningTransitions"
  | "composingShow"
  | "checkingConflicts"
  | "validating"
  | "buildingReport"
  | "done";

export const FULL_SHOW_STAGE_LABELS: Record<FullShowStage, string> = {
  preparing: "Preparing",
  planningTransitions: "Planning transitions",
  composingShow: "Composing show",
  checkingConflicts: "Checking conflicts",
  validating: "Validating",
  buildingReport: "Building report",
  done: "Done",
};

export interface FullShowStageTiming {
  readonly stage: FullShowStage;
  readonly ms: number;
}

export interface FullShowProgress {
  readonly stage: FullShowStage;
  readonly label: string;
  /** Index of the stage in the pipeline, 1-based. Not a fabricated percentage. */
  readonly step: number;
  readonly totalSteps: number;
}

export interface AnalyzeFullShowOptions extends ComposeFullShowOptions {
  readonly onProgress?: (progress: FullShowProgress) => void;
  /** Cooperative cancellation: checked between stages. */
  readonly isCancelled?: () => boolean;
  readonly project?: ShowProject;
}

/** Light sample representation (decoupled from trajectory logic). */
export interface DroneLightSample {
  readonly t: number;
  readonly droneId: string;
  readonly color: RGB;
  /** 0..1 relative luminance of the evaluated colour. */
  readonly brightness: number;
}
