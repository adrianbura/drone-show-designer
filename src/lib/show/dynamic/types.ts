/**
 * DYNAMIC FORMATION ENGINE — domain model.
 *
 * A dynamic formation is a *living* formation: a base point cloud plus an
 * animation description. Nothing here plans flight. Sampling a dynamic
 * formation returns exactly N points in show-local metres (+Y up, see
 * coordinates.ts); assignment, trajectory planning, conflict detection, safety
 * validation and export are entirely unchanged downstream.
 *
 * Mathematical model, evaluated per point i at local formation time t:
 *
 *   P_i(t) = pivot + T(t) + R(t) * S(t) * [ (base_i - pivot) + D_i(t) ]
 *
 *   T(t)  global translation track (metres)
 *   R(t)  global rotation track (quaternion slerp of euler keyframes)
 *   S(t)  global scale track (per-axis)
 *   D_i(t) internal deformation contributed by every motion group the point
 *          belongs to (summed; groups are independent and additive)
 *
 * Global motion and internal deformation are deliberately SEPARATE: a bird can
 * translate across the sky (T), bank (R) and flap its wings (D) at once, and
 * each part is editable, loopable and reproducible on its own.
 */
import type { RGB, Vector3Tuple } from "../types";

export const DYNAMIC_FORMATION_ALGORITHM_VERSION = "0.1.0";

/** How a track behaves outside [0, duration]. */
export type LoopMode = "NONE" | "REPEAT" | "PING_PONG";

/** Interpolation used from a keyframe to the NEXT keyframe. */
export type KeyframeInterpolation = "linear" | "smooth" | "minJerk";

export interface TransformKeyframe {
  /** Local formation time in seconds, >= 0. */
  readonly t: number;
  /** Translation in show-local metres. */
  readonly translation: Vector3Tuple;
  /** Euler rotation in degrees, applied X then Y then Z about the pivot. */
  readonly rotation: Vector3Tuple;
  /** Per-axis scale. [1,1,1] is neutral. */
  readonly scale: Vector3Tuple;
  readonly interpolation?: KeyframeInterpolation;
}

/** One deformation state of a motion group, relative to the base cloud. */
export interface GroupDeformationKeyframe {
  readonly t: number;
  /** Rigid offset added to every point of the group (local metres). */
  readonly offset: Vector3Tuple;
  /** Euler degrees about the group pivot (e.g. a wing flapping). */
  readonly rotation: Vector3Tuple;
  /** Uniform scale about the group pivot. 1 is neutral. */
  readonly scale: number;
  readonly interpolation?: KeyframeInterpolation;
}

export interface MotionGroup {
  readonly id: string;
  readonly name: string;
  /** Stable point ids owned by this group. */
  readonly pointIds: readonly string[];
  /** Editor-only tint used by the viewport overlay. */
  readonly color: RGB;
  /** Rotation/scale centre. Defaults to the group centroid when absent. */
  readonly pivot?: Vector3Tuple;
  readonly keyframes: readonly GroupDeformationKeyframe[];
  readonly loop: LoopMode;
  /** Own loop period in seconds. 0 / absent -> the formation duration. */
  readonly loopDuration?: number;
  /** Seconds added to the group clock — the basis of wave/chase motion. */
  readonly phaseOffset: number;
  readonly enabled: boolean;
}

export interface DynamicFormationPoint {
  /** Stable id (`FP-001`). Never renumbered while the formation is edited. */
  readonly id: string;
  /** Base position in show-local metres. */
  readonly base: Vector3Tuple;
}

export interface DynamicFormation {
  readonly id: string;
  readonly name: string;
  /** Static formation this was derived from, when applicable. */
  readonly sourceFormationId?: string;
  readonly points: readonly DynamicFormationPoint[];
  /** Global rotation/scale centre in show-local metres. */
  readonly pivot: Vector3Tuple;
  /** Length of one animation cycle in seconds. Must be > 0. */
  readonly duration: number;
  readonly loop: LoopMode;
  /** Global motion track. Empty = no global motion. */
  readonly transform: readonly TransformKeyframe[];
  readonly groups: readonly MotionGroup[];
  readonly seed: number;
  readonly algorithmVersion: string;
}

/** Clip-level playback controls for a dynamic formation. */
export interface DynamicClipPlayback {
  /** Local time multiplier. 1 = real time. */
  readonly playbackRate: number;
  /** Local time the clip enters the animation at. */
  readonly startOffset: number;
}

export type DynamicIssueSeverity = "error" | "warning" | "info";

export interface DynamicFormationIssue {
  readonly id: string;
  readonly severity: DynamicIssueSeverity;
  readonly code:
    | "EMPTY_POINTS"
    | "INVALID_DURATION"
    | "POINT_COUNT_MISMATCH"
    | "SPACING"
    | "SPEED"
    | "ALTITUDE"
    | "AREA"
    | "LOOP_DISCONTINUITY"
    | "GROUP_UNKNOWN_POINT"
    | "GROUP_EMPTY";
  readonly message: string;
  /** Local formation time the issue was observed at, when applicable. */
  readonly time?: number;
  readonly pointIds?: readonly string[];
}

export interface DynamicFormationMetrics {
  readonly pointCount: number;
  readonly groupCount: number;
  readonly duration: number;
  readonly sampledFrames: number;
  /** Smallest point-to-point distance over the sampled animation. */
  readonly minSpacing: number;
  /** Largest displacement of any point from its base position. */
  readonly maxDisplacement: number;
  /** Largest point speed implied by the animation (m/s). */
  readonly maxPointSpeed: number;
  /** Largest implied acceleration (m/s^2). */
  readonly maxPointAcceleration: number;
  readonly minAltitude: number;
  readonly maxAltitude: number;
  /** Position gap between t = duration and t = 0 (loop seam), metres. */
  readonly loopSeamGap: number;
}

export interface DynamicFormationReport {
  readonly formationId: string;
  readonly status: "ok" | "warning" | "error";
  readonly metrics: DynamicFormationMetrics;
  readonly issues: readonly DynamicFormationIssue[];
  readonly algorithmVersion: string;
}

export type DynamicErrorCode =
  | "INVALID_DYNAMIC_FORMATION"
  | "INVALID_LOCAL_TIME"
  | "UNKNOWN_GROUP"
  | "UNKNOWN_POINT";

/** Structured failure — dynamic sampling never silently returns wrong counts. */
export class DynamicFormationError extends Error {
  readonly code: DynamicErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: DynamicErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DynamicFormationError";
    this.code = code;
    this.details = details;
  }
}
