/**
 * Canonical trajectory data model.
 *
 * Times: seconds. Positions: metres. Velocity m/s, acceleration m/s^2,
 * jerk m/s^3. Yaw and yawRate in degrees / deg per second, yaw normalised to
 * (-180, 180] with 0 along +X (see coordinates.ts).
 */
import type { Easing, ShowPhase, Vector3Tuple } from "../types";

export interface TrajectorySample {
  readonly t: number;
  readonly position: Vector3Tuple;
  readonly velocity: Vector3Tuple;
  readonly acceleration: Vector3Tuple;
  readonly jerk: Vector3Tuple;
  readonly yaw: number;
  readonly yawRate: number;
}

export interface DroneTrajectory {
  readonly droneId: string;
  readonly samples: TrajectorySample[];
}

export interface TrajectorySet {
  readonly droneCount: number;
  /** Sampled SPAN in seconds (end - startTime). */
  readonly duration: number;
  /** First sampled show time. Negative when the set contains a pre-show. */
  readonly startTime?: number;
  /** Samples per second. Any of 10/20/25/50/100 Hz (or other) is supported. */
  readonly sampleRate: number;
  readonly drones: DroneTrajectory[];
  readonly algorithmVersion: string;
}

export type YawPolicy =
  | { readonly kind: "fixed"; readonly yaw: number }
  | { readonly kind: "faceDirectionOfTravel"; readonly fallbackYaw?: number }
  | { readonly kind: "custom"; readonly yawAt: (t: number) => number };

export interface TrajectoryPlanInput {
  readonly start: Vector3Tuple;
  readonly end: Vector3Tuple;
  /** Segment duration in seconds. Must be > 0. */
  readonly duration: number;
  readonly maxVelocity: number;
  readonly maxAcceleration: number;
  readonly maxJerk: number;
  readonly yawPolicy: YawPolicy;
  readonly easing?: Easing;
  /**
   * Optional deterministic vertical bow added to the path (metres, peak at
   * mid-segment). Used to layer crossing morph paths; not a safety mechanism.
   */
  readonly verticalArc?: number;
  /** When true the planner throws instead of returning an over-limit path. */
  readonly strict?: boolean;
}

/** Continuous representation: samplable at any t in [0, duration]. */
export interface PlannedTrajectory {
  readonly duration: number;
  readonly plannerId: string;
  sample(t: number): TrajectorySample;
}

export interface TrajectoryPlanner {
  readonly id: string;
  readonly version: string;
  plan(input: TrajectoryPlanInput): PlannedTrajectory;
}

export type TrajectoryPlanningErrorCode =
  | "INVALID_DURATION"
  | "INVALID_POSITION"
  | "INVALID_FORMATION"
  | "VELOCITY_LIMIT_UNACHIEVABLE"
  | "ACCELERATION_LIMIT_UNACHIEVABLE"
  | "JERK_LIMIT_UNACHIEVABLE";

export interface TrajectoryPlanningErrorDetails {
  readonly droneId?: string;
  readonly phase?: ShowPhase;
  readonly clipId?: string;
  readonly value?: number;
  readonly limit?: number;
  readonly [key: string]: unknown;
}

/** Structured failure — never swallowed, always surfaced to the caller. */
export class TrajectoryPlanningError extends Error {
  readonly code: TrajectoryPlanningErrorCode;
  readonly droneId?: string;
  readonly phase?: ShowPhase;
  readonly details: TrajectoryPlanningErrorDetails;

  constructor(
    code: TrajectoryPlanningErrorCode,
    message: string,
    details: TrajectoryPlanningErrorDetails = {},
  ) {
    super(message);
    this.name = "TrajectoryPlanningError";
    this.code = code;
    this.details = details;
    if (details.droneId !== undefined) this.droneId = details.droneId;
    if (details.phase !== undefined) this.phase = details.phase;
  }
}
