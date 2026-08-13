/**
 * Deterministic trajectory decorators used by transition deconfliction.
 *
 * Both decorators wrap a PlannedTrajectory and keep the canonical sample model
 * intact (position, velocity, acceleration, jerk, yaw, yawRate all populated and
 * finite). They are shared by the transition planner and the show schedule so an
 * optimised transition previews exactly as it was analysed.
 */
import { planHold } from "./planner";
import type { PlannedTrajectory, TrajectorySample } from "./types";
import type { Vector3Tuple } from "../types";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Smooth vertical bump: o(x) = A * sin(pi x)^3 with x = t / T.
 * Value, first and second derivative vanish at both ends, so the drone leaves
 * and rejoins its nominal path with no altitude, velocity or acceleration step;
 * jerk stays finite everywhere.
 */
export function verticalLaneProfile(amplitude: number, T: number) {
  const k = Math.PI;
  const safeT = Math.max(1e-6, T);
  return {
    offset(t: number) {
      return amplitude * Math.sin(k * clamp01(t / safeT)) ** 3;
    },
    velocity(t: number) {
      const x = clamp01(t / safeT);
      const s = Math.sin(k * x);
      return (amplitude * 3 * s * s * Math.cos(k * x) * k) / safeT;
    },
    acceleration(t: number) {
      const x = clamp01(t / safeT);
      const s = Math.sin(k * x);
      const c = Math.cos(k * x);
      return (amplitude * 3 * s * (2 * c * c - s * s) * k * k) / (safeT * safeT);
    },
    jerk(t: number) {
      const x = clamp01(t / safeT);
      const s = Math.sin(k * x);
      const c = Math.cos(k * x);
      return (amplitude * 3 * c * (2 * c * c - 7 * s * s) * k * k * k) / (safeT * safeT * safeT);
    },
  };
}

/** Adds a bounded temporary altitude offset (metres) to a planned segment. */
export function withVerticalLane(planned: PlannedTrajectory, amplitude: number): PlannedTrajectory {
  if (!amplitude) return planned;
  const profile = verticalLaneProfile(amplitude, planned.duration);
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

/**
 * Prefixes a stationary wait of `offset` seconds while keeping the same end
 * time, so show timing is preserved.
 */
export function withStartOffset(
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
      const tc = Math.max(0, Math.min(total, t));
      const s = tc <= offset ? hold.sample(tc) : planned.sample(tc - offset);
      return { ...s, t: tc };
    },
  };
}
