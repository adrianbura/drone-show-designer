/**
 * TRANSITION PLANNER (composition layer).
 *
 * Reuses the canonical minJerkPlanner + a deterministic vertical-lane offset
 * profile and a bounded start offset, then samples the result into a canonical
 * TrajectorySet. Nothing here bypasses TrajectorySet: position, velocity,
 * acceleration, jerk, yaw and yawRate are always populated.
 *
 * TIME BASE: t = 0 is the start of the transition (NOT of the show).
 */
import { minJerkPlanner, planHold } from "../trajectory/planner";
import { TrajectoryPlanningError } from "../trajectory/types";
import type { PlannedTrajectory, TrajectorySample, TrajectorySet } from "../trajectory/types";
import type { DroneTrajectory } from "../trajectory/types";
import type { DroneDefinition } from "../drones";
import type { Easing, SafetyLimits, Vector3Tuple } from "../types";
import { TRAJECTORY_ALGORITHM_VERSION } from "../types";
import type { TransitionDronePlan } from "./types";

export interface TransitionPlanSpec {
  readonly drones: readonly DroneDefinition[];
  readonly from: readonly Vector3Tuple[];
  /** Resolved per-drone target position (assignment already applied). */
  readonly to: readonly Vector3Tuple[];
  readonly targetPointIndex: readonly number[];
  readonly duration: number;
  readonly easing: Easing;
  readonly limits: SafetyLimits;
  /** Seconds each drone waits before starting to move (>= 0, bounded). */
  readonly startOffsets: readonly number[];
  /** Signed vertical lane offsets in metres (already clamped to bounds). */
  readonly laneOffsets: readonly number[];
  readonly laneSpacing: number;
  readonly sampleRate: number;
}

export interface PlannedTransition {
  readonly set: TrajectorySet;
  readonly dronePlans: TransitionDronePlan[];
  readonly errors: TrajectoryPlanningError[];
}

/**
 * Smooth vertical bump: o(x) = A * sin(pi x)^3 with x = t / T.
 * Value, first and second derivative are zero at both ends, so the drone leaves
 * and re-enters its nominal path with no altitude, velocity or acceleration
 * step, and jerk stays finite everywhere.
 */
function laneProfile(amplitude: number, T: number) {
  const k = Math.PI;
  return {
    offset(t: number) {
      const x = clamp01(t / T);
      return amplitude * Math.sin(k * x) ** 3;
    },
    velocity(t: number) {
      const x = clamp01(t / T);
      const s = Math.sin(k * x);
      const c = Math.cos(k * x);
      return (amplitude * 3 * s * s * c * k) / T;
    },
    acceleration(t: number) {
      const x = clamp01(t / T);
      const s = Math.sin(k * x);
      const c = Math.cos(k * x);
      return (amplitude * 3 * s * (2 * c * c - s * s) * k * k) / (T * T);
    },
    jerk(t: number) {
      const x = clamp01(t / T);
      const s = Math.sin(k * x);
      const c = Math.cos(k * x);
      return (amplitude * 3 * c * (2 * c * c - 7 * s * s) * k * k * k) / (T * T * T);
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function withLane(planned: PlannedTrajectory, amplitude: number): PlannedTrajectory {
  if (amplitude === 0) return planned;
  const profile = laneProfile(amplitude, planned.duration);
  return {
    duration: planned.duration,
    plannerId: `${planned.plannerId}+vertical-lane`,
    sample(t: number): TrajectorySample {
      const s = planned.sample(t);
      return {
        ...s,
        position: [s.position[0], s.position[1] + profile.offset(t), s.position[2]],
        velocity: [s.velocity[0], s.velocity[1] + profile.velocity(t), s.velocity[2]],
        acceleration: [
          s.acceleration[0],
          s.acceleration[1] + profile.acceleration(t),
          s.acceleration[2],
        ],
        jerk: [s.jerk[0], s.jerk[1] + profile.jerk(t), s.jerk[2]],
      };
    },
  };
}

/** Prefixes a stationary wait of `offset` seconds, keeping the same end time. */
function withStartOffset(
  planned: PlannedTrajectory,
  offset: number,
  from: Vector3Tuple,
  total: number,
): PlannedTrajectory {
  if (offset <= 0) return planned;
  const hold = planHold(from, offset);
  return {
    duration: total,
    plannerId: `${planned.plannerId}+stagger`,
    sample(t: number): TrajectorySample {
      if (t <= offset) {
        const s = hold.sample(Math.max(0, t));
        return { ...s, t: Math.max(0, Math.min(total, t)) };
      }
      const s = planned.sample(t - offset);
      return { ...s, t: Math.max(0, Math.min(total, t)) };
    },
  };
}

export function planTransition(spec: TransitionPlanSpec): PlannedTransition {
  const errors: TrajectoryPlanningError[] = [];
  const T = Math.max(0.05, spec.duration);
  const dronePlans: TransitionDronePlan[] = [];
  const planned: PlannedTrajectory[] = [];

  spec.drones.forEach((drone, i) => {
    const from = spec.from[i] ?? drone.homePosition;
    const to = spec.to[i] ?? from;
    const offset = Math.max(0, Math.min(spec.startOffsets[i] ?? 0, T * 0.5));
    const lane = spec.laneOffsets[i] ?? 0;
    const moveDuration = Math.max(0.05, T - offset);
    let trajectory: PlannedTrajectory;
    try {
      trajectory = minJerkPlanner.plan({
        start: from,
        end: to,
        duration: moveDuration,
        maxVelocity: spec.limits.maxVelocity,
        maxAcceleration: spec.limits.maxAcceleration,
        maxJerk: spec.limits.maxJerk,
        yawPolicy: { kind: "faceDirectionOfTravel", fallbackYaw: 0 },
        easing: spec.easing,
      });
    } catch (err) {
      const planningError =
        err instanceof TrajectoryPlanningError
          ? err
          : new TrajectoryPlanningError("INVALID_POSITION", String(err), { droneId: drone.id });
      errors.push(planningError);
      trajectory = planHold(from, moveDuration);
    }
    planned.push(withStartOffset(withLane(trajectory, lane), offset, from, T));
    dronePlans.push({
      droneId: drone.id,
      index: i,
      from,
      to,
      targetPointIndex: spec.targetPointIndex[i] ?? i,
      distance: Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]),
      startOffset: offset,
      lane: {
        index: spec.laneSpacing > 0 ? Math.round(lane / spec.laneSpacing) : 0,
        offsetMetres: lane,
      },
    });
  });

  const rate = spec.sampleRate;
  const stepCount = Math.floor(T * rate) + 1;
  const drones: DroneTrajectory[] = spec.drones.map((drone, i) => {
    const traj = planned[i]!;
    const samples: TrajectorySample[] = new Array(stepCount);
    for (let k = 0; k < stepCount; k++) {
      const t = k / rate;
      samples[k] = { ...traj.sample(Math.min(t, T)), t };
    }
    return { droneId: drone.id, samples };
  });

  return {
    set: {
      droneCount: spec.drones.length,
      duration: T,
      sampleRate: rate,
      drones,
      algorithmVersion: TRAJECTORY_ALGORITHM_VERSION,
    },
    dronePlans,
    errors,
  };
}
