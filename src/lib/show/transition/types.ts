/**
 * Transition analysis + optimisation domain model.
 *
 * A "transition" here is ONE source formation -> ONE target formation morph of
 * the whole fleet, analysed in isolation from the rest of the timeline. Nothing
 * in this package mutates a ShowProject: every function returns data.
 */
import type { AssignmentResult, AssignmentStrategyId } from "../assignment";
import type { ConflictReport } from "../conflicts";
import type { DroneDefinition } from "../drones";
import type { TrajectorySet } from "../trajectory/types";
import type { Easing, SafetyLimits, Vector3Tuple } from "../types";

/** Bumped whenever optimisation results can change for identical input. */
export const TRANSITION_OPTIMIZER_VERSION = "0.1.0";

export interface TransitionInput {
  readonly drones: readonly DroneDefinition[];
  /** Fleet positions when the transition begins, in drone index order. */
  readonly source: readonly Vector3Tuple[];
  /** Target formation points (may be padded/repeated by the assignment engine). */
  readonly target: readonly Vector3Tuple[];
  readonly duration: number;
  readonly limits: SafetyLimits;
  readonly strategy: AssignmentStrategyId;
  readonly easing?: Easing;
  readonly sampleRate?: number;
  /** Absolute show time the transition starts at — reporting only. */
  readonly startTime?: number;
  readonly clipId?: string;
}

/**
 * Scoring weights. All penalties are additive; lower score is better.
 * Nothing outside this object is allowed to hold a magic optimisation weight.
 */
export interface TransitionOptimizationWeights {
  /** Per critical conflict. Dominates everything else by design. */
  readonly criticalConflict: number;
  /** Per non-critical conflict. */
  readonly warningConflict: number;
  /** Per metre of separation shortfall, summed over conflicts. */
  readonly proximityShortfall: number;
  /** Per safety-profile constraint violation (velocity/accel/jerk/altitude). */
  readonly constraintViolation: number;
  /** Per metre of the longest individual path. */
  readonly maxPath: number;
  /** Per metre of total travel. */
  readonly totalDistance: number;
  /** Per second of accumulated start staggering. */
  readonly staggering: number;
  /** Per metre of accumulated vertical lane offset. */
  readonly verticalOffset: number;
}

export const DEFAULT_OPTIMIZATION_WEIGHTS: TransitionOptimizationWeights = {
  criticalConflict: 1000,
  warningConflict: 250,
  proximityShortfall: 40,
  constraintViolation: 500,
  maxPath: 1.5,
  totalDistance: 0.02,
  staggering: 2,
  verticalOffset: 0.5,
};

export interface TransitionOptimizationSettings {
  readonly maxIterations: number;
  /** Strategy A — local target swaps for conflicting pairs. */
  readonly enableSwaps: boolean;
  /** Strategy B — bounded deterministic start-time staggering. */
  readonly enableStagger: boolean;
  /** Strategy C — bounded deterministic vertical lanes. */
  readonly enableVerticalLanes: boolean;
  /** Hard bound on any single drone's start offset (seconds). */
  readonly maxStartOffsetSeconds: number;
  /** Offset step between staggered ranks (seconds). */
  readonly startOffsetStep: number;
  /** Vertical distance between adjacent deconfliction lanes (metres). */
  readonly verticalLaneSpacing: number;
  /** Hard bound on |lane offset| (metres). */
  readonly maxVerticalOffset: number;
  /** Extra clearance kept away from the altitude floor/ceiling (metres). */
  readonly verticalClearanceMargin: number;
  /** Maximum conflicting pairs considered for swapping per iteration. */
  readonly maxSwapsPerIteration: number;
  readonly weights: TransitionOptimizationWeights;
}

export const DEFAULT_OPTIMIZATION_SETTINGS: TransitionOptimizationSettings = {
  maxIterations: 10,
  enableSwaps: true,
  enableStagger: true,
  enableVerticalLanes: true,
  maxStartOffsetSeconds: 1.5,
  startOffsetStep: 0.5,
  verticalLaneSpacing: 4,
  maxVerticalOffset: 12,
  verticalClearanceMargin: 1,
  maxSwapsPerIteration: 32,
  weights: DEFAULT_OPTIMIZATION_WEIGHTS,
};

export type DurationLimitingMetric = "velocity" | "acceleration" | "jerk" | "none";

export interface DurationFeasibilityResult {
  readonly requestedDuration: number;
  readonly minimumEstimatedDuration: number;
  readonly feasible: boolean;
  readonly limitingMetric: DurationLimitingMetric;
  /** Longest assigned travel distance the estimate is based on (metres). */
  readonly worstDistance: number;
  readonly worstDroneId: string | null;
  readonly model: string;
}

export interface TransitionMetrics {
  readonly droneCount: number;
  readonly totalTravelDistance: number;
  readonly averageTravelDistance: number;
  readonly maximumTravelDistance: number;
  readonly minimumDynamicSeparation: number;
  readonly conflictCount: number;
  readonly criticalConflictCount: number;
  readonly uniqueConflictPairs: number;
  readonly potentialGeometricCrossings: number;
  readonly maximumVelocity: number;
  readonly maximumAcceleration: number;
  readonly maximumJerk: number;
  readonly maximumYawRate: number;
  readonly requestedDuration: number;
  readonly estimatedMinimumDuration: number;
  readonly optimizationIterations: number;
  readonly assignmentStrategy: AssignmentStrategyId;
  readonly totalStartOffset: number;
  readonly totalVerticalOffset: number;
  /** Weighted optimisation score (lower is better). */
  readonly score: number;
}

/** Deconfliction lane: 0 = nominal, +/-1 = one spacing above/below, etc. */
export interface DeconflictionLane {
  readonly index: number;
  readonly offsetMetres: number;
}

export interface TransitionDronePlan {
  readonly droneId: string;
  readonly index: number;
  readonly from: Vector3Tuple;
  readonly to: Vector3Tuple;
  readonly targetPointIndex: number;
  readonly distance: number;
  readonly startOffset: number;
  readonly lane: DeconflictionLane;
}

export interface TransitionAnalysis {
  readonly assignment: AssignmentResult;
  readonly trajectorySet: TrajectorySet;
  readonly conflicts: ConflictReport;
  readonly metrics: TransitionMetrics;
  readonly feasibility: DurationFeasibilityResult;
  readonly dronePlans: TransitionDronePlan[];
  /** Timing: t = 0 is the START OF THE TRANSITION, not of the show. */
  readonly timeBase: "transition-relative";
  readonly timings: {
    readonly assignmentMs: number;
    readonly planningMs: number;
    readonly conflictMs: number;
    readonly totalMs: number;
  };
}

export type TransitionOptimizationStatus =
  | "unchanged"
  | "improved"
  | "resolved"
  | "unresolved"
  | "failed"
  | "cancelled";

export interface TransitionOptimizationResult {
  readonly status: TransitionOptimizationStatus;
  readonly initial: TransitionAnalysis;
  readonly final: TransitionAnalysis;
  readonly iterations: number;
  readonly appliedStrategies: string[];
  readonly settings: TransitionOptimizationSettings;
  readonly warnings: string[];
  readonly optimizerVersion: string;
  readonly totalMs: number;
}

export type TransitionOptimizationErrorCode =
  | "INVALID_SOURCE_FORMATION"
  | "INVALID_TARGET_FORMATION"
  | "DRONE_COUNT_MISMATCH"
  | "INVALID_CONSTRAINTS"
  | "TRAJECTORY_GENERATION_FAILED"
  | "OPTIMIZATION_FAILED"
  | "OPTIMIZATION_CANCELLED"
  | "UNRESOLVED_CONFLICTS";

export class TransitionOptimizationError extends Error {
  readonly code: TransitionOptimizationErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(
    code: TransitionOptimizationErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TransitionOptimizationError";
    this.code = code;
    this.details = details;
  }
}

/** Structured, user-presentable message for any transition failure. */
export function describeTransitionError(err: unknown): { code: string; message: string } {
  if (err instanceof TransitionOptimizationError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: "OPTIMIZATION_FAILED", message: err.message };
  return { code: "OPTIMIZATION_FAILED", message: "Transition analysis failed" };
}
