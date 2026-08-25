/**
 * Trajectory planners.
 *
 * A planner turns start/end/constraints into a CONTINUOUS PlannedTrajectory.
 * It never samples on a fixed grid (that is the sampler's job) and never owns
 * safety limits — they arrive through TrajectoryPlanInput from the project's
 * flight profile. Validation of the resulting motion is the Safety Engine's job;
 * `strict: true` makes the planner refuse impossible requests up front.
 */
import { headingFromVelocity, normalizeYawDeg, yawDeltaDeg } from "../coordinates";
import type { Easing, Vector3Tuple } from "../types";
import {
  TrajectoryPlanningError,
  type PlannedTrajectory,
  type TrajectoryPlanInput,
  type TrajectoryPlanner,
  type TrajectorySample,
  type YawPolicy,
} from "./types";

export const MIN_JERK_PLANNER_VERSION = "0.1.0";

/** Normalised easing profile and its first three derivatives w.r.t. x. */
function easeProfile(kind: Easing, xRaw: number): [number, number, number, number] {
  const x = Math.max(0, Math.min(1, xRaw));
  switch (kind) {
    case "linear":
      return [x, 1, 0, 0];
    case "smooth":
      return [3 * x ** 2 - 2 * x ** 3, 6 * x - 6 * x ** 2, 6 - 12 * x, -12];
    case "minJerk":
    default:
      return [
        10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5,
        30 * x ** 2 - 60 * x ** 3 + 30 * x ** 4,
        60 * x - 180 * x ** 2 + 120 * x ** 3,
        60 - 360 * x + 360 * x ** 2,
      ];
  }
}

/** Peak |velocity| factor of the normalised profile (times distance / T). */
const PEAK_VELOCITY_FACTOR: Record<Easing, number> = {
  linear: 1,
  smooth: 1.5,
  minJerk: 1.875,
};
const PEAK_ACCEL_FACTOR: Record<Easing, number> = {
  linear: 0,
  smooth: 6,
  minJerk: 5.7735,
};

function assertFinitePosition(p: Vector3Tuple, which: string, input: TrajectoryPlanInput) {
  if (!p || p.length !== 3 || p.some((v) => !Number.isFinite(v))) {
    throw new TrajectoryPlanningError(
      "INVALID_POSITION",
      `${which} position is not a finite 3-vector`,
      { value: Number.NaN },
    );
  }
  void input;
}

function yawEvaluator(
  policy: YawPolicy,
  /** Horizontal displacement of the segment (straight line for this planner). */
  travel: readonly [number, number],
) {
  if (policy.kind === "fixed") {
    const fixed = normalizeYawDeg(policy.yaw);
    return () => fixed;
  }
  if (policy.kind === "custom") {
    return (t: number) => normalizeYawDeg(policy.yawAt(t));
  }
  const fallback = normalizeYawDeg(policy.fallbackYaw ?? 0);
  const EPS = 1e-3;
  // A min-jerk segment is a straight line, so the direction of travel is
  // constant for the whole segment. Deriving yaw from the instantaneous
  // velocity instead would produce enormous, meaningless yaw rates near the
  // endpoints where |v| -> 0 and the heading is undefined.
  const horizontal = Math.hypot(travel[0], travel[1]);
  const heading = horizontal < EPS ? fallback : headingFromVelocity(travel[0], travel[1]);
  return () => heading;
}

/**
 * Polynomial point-to-point planner. `easing` selects the profile; `minJerk`
 * (default) has zero velocity, acceleration and jerk at both endpoints.
 */
export const minJerkPlanner: TrajectoryPlanner = {
  id: "polynomial-min-jerk",
  version: MIN_JERK_PLANNER_VERSION,
  plan(input: TrajectoryPlanInput): PlannedTrajectory {
    const { start, end, duration } = input;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new TrajectoryPlanningError("INVALID_DURATION", "Segment duration must be > 0", {
        value: duration,
      });
    }
    assertFinitePosition(start, "start", input);
    assertFinitePosition(end, "end", input);

    const easing: Easing = input.easing ?? "minJerk";
    const arc = input.verticalArc ?? 0;
    const T = duration;
    const d: Vector3Tuple = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    const distance = Math.hypot(d[0], d[1], d[2]);

    if (input.strict) {
      const peakV = (PEAK_VELOCITY_FACTOR[easing] * distance) / T;
      if (peakV > input.maxVelocity) {
        throw new TrajectoryPlanningError(
          "VELOCITY_LIMIT_UNACHIEVABLE",
          `Segment needs ${peakV.toFixed(2)} m/s but limit is ${input.maxVelocity} m/s`,
          { value: peakV, limit: input.maxVelocity },
        );
      }
      const peakA = (PEAK_ACCEL_FACTOR[easing] * distance) / (T * T);
      if (peakA > input.maxAcceleration) {
        throw new TrajectoryPlanningError(
          "ACCELERATION_LIMIT_UNACHIEVABLE",
          `Segment needs ${peakA.toFixed(2)} m/s² but limit is ${input.maxAcceleration} m/s²`,
          { value: peakA, limit: input.maxAcceleration },
        );
      }
    }

    const hasBoundaryVelocity = !!input.startVelocity || !!input.endVelocity;
    const startVelocity = input.startVelocity ?? ([0, 0, 0] as Vector3Tuple);
    const endVelocity = input.endVelocity ?? ([0, 0, 0] as Vector3Tuple);
    assertFinitePosition(startVelocity, "start velocity", input);
    assertFinitePosition(endVelocity, "end velocity", input);
    const coefficients = d.map((delta, axis) => {
      const v0 = startVelocity[axis]!;
      const v1 = endVelocity[axis]!;
      return [
        start[axis]!,
        v0,
        0,
        (10 * delta - (6 * v0 + 4 * v1) * T) / T ** 3,
        (-15 * delta + (8 * v0 + 7 * v1) * T) / T ** 4,
        (6 * delta - (3 * v0 + 3 * v1) * T) / T ** 5,
      ] as const;
    });
    const polynomial = (axis: number, t: number, derivative: 0 | 1 | 2 | 3): number => {
      const [a0, a1, a2, a3, a4, a5] = coefficients[axis]!;
      if (derivative === 0)
        return a0 + a1 * t + a2 * t ** 2 + a3 * t ** 3 + a4 * t ** 4 + a5 * t ** 5;
      if (derivative === 1)
        return a1 + 2 * a2 * t + 3 * a3 * t ** 2 + 4 * a4 * t ** 3 + 5 * a5 * t ** 4;
      if (derivative === 2) return 2 * a2 + 6 * a3 * t + 12 * a4 * t ** 2 + 20 * a5 * t ** 3;
      return 6 * a3 + 24 * a4 * t + 60 * a5 * t ** 2;
    };
    const positionAt = (t: number): Vector3Tuple => {
      const x = Math.max(0, Math.min(1, t / T));
      const tc = x * T;
      if (hasBoundaryVelocity) {
        return [polynomial(0, tc, 0), polynomial(1, tc, 0), polynomial(2, tc, 0)];
      }
      const [s] = easeProfile(easing, x);
      const bow = arc === 0 ? 0 : Math.sin(x * Math.PI) * arc;
      return [start[0] + d[0] * s, start[1] + d[1] * s + bow, start[2] + d[2] * s];
    };
    const velocityAt = (t: number): Vector3Tuple => {
      const x = Math.max(0, Math.min(1, t / T));
      const tc = x * T;
      if (hasBoundaryVelocity) {
        return [polynomial(0, tc, 1), polynomial(1, tc, 1), polynomial(2, tc, 1)];
      }
      const ds = easeProfile(easing, x)[1] / T;
      const bow = arc === 0 ? 0 : (Math.PI / T) * Math.cos(x * Math.PI) * arc;
      return [d[0] * ds, d[1] * ds + bow, d[2] * ds];
    };
    const accelerationAt = (t: number): Vector3Tuple => {
      const x = Math.max(0, Math.min(1, t / T));
      const tc = x * T;
      if (hasBoundaryVelocity) {
        return [polynomial(0, tc, 2), polynomial(1, tc, 2), polynomial(2, tc, 2)];
      }
      const dds = easeProfile(easing, x)[2] / (T * T);
      const bow = arc === 0 ? 0 : -((Math.PI / T) ** 2) * Math.sin(x * Math.PI) * arc;
      return [d[0] * dds, d[1] * dds + bow, d[2] * dds];
    };
    const jerkAt = (t: number): Vector3Tuple => {
      const x = Math.max(0, Math.min(1, t / T));
      const tc = x * T;
      if (hasBoundaryVelocity) {
        return [polynomial(0, tc, 3), polynomial(1, tc, 3), polynomial(2, tc, 3)];
      }
      const ddds = easeProfile(easing, x)[3] / (T * T * T);
      const bow = arc === 0 ? 0 : -((Math.PI / T) ** 3) * Math.cos(x * Math.PI) * arc;
      return [d[0] * ddds, d[1] * ddds + bow, d[2] * ddds];
    };

    const yawAt = yawEvaluator(input.yawPolicy, [d[0], d[2]]);
    const h = Math.min(0.01, T / 100);
    const yawRateAt = (t: number) => {
      const a = yawAt(Math.max(0, t - h));
      const b = yawAt(Math.min(T, t + h));
      const span = Math.min(T, t + h) - Math.max(0, t - h);
      return span > 0 ? yawDeltaDeg(a, b) / span : 0;
    };

    return {
      duration: T,
      plannerId: hasBoundaryVelocity ? `${minJerkPlanner.id}+boundary-velocity` : minJerkPlanner.id,
      sample(t: number): TrajectorySample {
        const tc = Math.max(0, Math.min(T, t));
        return {
          t: tc,
          position: positionAt(tc),
          velocity: velocityAt(tc),
          acceleration: accelerationAt(tc),
          jerk: jerkAt(tc),
          yaw: yawAt(tc),
          yawRate: yawRateAt(tc),
        };
      },
    };
  },
};

/** Stationary hold. All derivatives are exactly zero. */
export function planHold(position: Vector3Tuple, duration: number, yaw = 0): PlannedTrajectory {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new TrajectoryPlanningError("INVALID_DURATION", "Hold duration must be >= 0", {
      value: duration,
    });
  }
  const y = normalizeYawDeg(yaw);
  return {
    duration,
    plannerId: "hold",
    sample(t: number): TrajectorySample {
      return {
        t: Math.max(0, Math.min(duration, t)),
        position,
        velocity: [0, 0, 0],
        acceleration: [0, 0, 0],
        jerk: [0, 0, 0],
        yaw: y,
        yawRate: 0,
      };
    },
  };
}

export const PLANNERS = { minJerk: minJerkPlanner } as const;
