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
 * Adds a smooth temporary horizontal detour perpendicular to the direct XZ
 * path. The same endpoint-flat profile as the vertical lane keeps position,
 * velocity and acceleration unchanged at both splice boundaries.
 */
export function withLateralLane(
  planned: PlannedTrajectory,
  amplitude: number,
  from: Vector3Tuple,
  to: Vector3Tuple,
): PlannedTrajectory {
  if (!amplitude) return planned;
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dz);
  // Canonicalise the undirected path orientation so A→B and B→A obtain the
  // same normal. Opposite signed lane amplitudes then really put a head-on pair
  // on opposite sides instead of accidentally moving both to the same side.
  const orientation = dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dz < 0) ? -1 : 1;
  const canonicalX = dx * orientation;
  const canonicalZ = dz * orientation;
  const nx = length > 1e-9 ? -canonicalZ / length : 1;
  const nz = length > 1e-9 ? canonicalX / length : 0;
  const profile = verticalLaneProfile(amplitude, planned.duration);
  return {
    duration: planned.duration,
    plannerId: `${planned.plannerId}+lateral-lane`,
    sample(t: number): TrajectorySample {
      const s = planned.sample(t);
      const p = profile.offset(t);
      const v = profile.velocity(t);
      const a = profile.acceleration(t);
      const j = profile.jerk(t);
      return {
        ...s,
        position: [s.position[0] + nx * p, s.position[1], s.position[2] + nz * p],
        velocity: [s.velocity[0] + nx * v, s.velocity[1], s.velocity[2] + nz * v],
        acceleration: [s.acceleration[0] + nx * a, s.acceleration[1], s.acceleration[2] + nz * a],
        jerk: [s.jerk[0] + nx * j, s.jerk[1], s.jerk[2] + nz * j],
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
