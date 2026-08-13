/**
 * TRANSITION PLANNER (composition layer).
 *
 * Reuses the canonical minJerkPlanner plus the shared deterministic decorators
 * (bounded vertical lane offset, bounded start stagger) and samples the result
 * into a canonical TrajectorySet. Nothing here bypasses TrajectorySet: position,
 * velocity, acceleration, jerk, yaw and yawRate are always populated.
 *
 * TIME BASE: t = 0 is the start of the transition (NOT of the show).
 */
import { withStartOffset, withVerticalLane } from "../trajectory/offsets";
import { minJerkPlanner, planHold } from "../trajectory/planner";
import { TrajectoryPlanningError } from "../trajectory/types";
import type {
  DroneTrajectory,
  PlannedTrajectory,
  TrajectorySample,
  TrajectorySet,
} from "../trajectory/types";
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
    planned.push(withStartOffset(withVerticalLane(trajectory, lane), offset, from, T));
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
      const t = Math.min(k / rate, T);
      samples[k] = { ...traj.sample(t), t };
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
