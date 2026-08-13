/**
 * DURATION FEASIBILITY ESTIMATOR.
 *
 * MODEL — a min-jerk point-to-point segment of length d over duration T has
 * closed-form peaks:
 *     |v|max = 1.875 d / T          => T_v = 1.875 d / vMax
 *     |a|max = 5.7735 d / T^2       => T_a = sqrt(5.7735 d / aMax)
 *     |j|max = 60 d / T^3           => T_j = cbrt(60 d / jMax)
 * The minimum feasible duration is the largest of the three. This is an estimate
 * for the planner's own polynomial profile — it is NOT a statement about real
 * vehicle dynamics, motor saturation, wind or tracking error.
 */
import type {
  DurationFeasibilityResult,
  DurationLimitingMetric,
  TransitionDronePlan,
} from "./types";
import type { SafetyLimits } from "../types";

export const PEAK_VELOCITY_FACTOR = 1.875;
export const PEAK_ACCELERATION_FACTOR = 5.7735;
export const PEAK_JERK_FACTOR = 60;

export const DURATION_MODEL =
  "min-jerk closed form: T_v = 1.875 d / vMax, T_a = sqrt(5.7735 d / aMax), T_j = cbrt(60 d / jMax)";

export interface DurationEstimate {
  readonly duration: number;
  readonly limitingMetric: DurationLimitingMetric;
}

/** Minimum min-jerk duration for a single straight segment of length `d`. */
export function estimateMinimumDuration(d: number, limits: SafetyLimits): DurationEstimate {
  if (!(d > 0)) return { duration: 0, limitingMetric: "none" };
  const tv = limits.maxVelocity > 0 ? (PEAK_VELOCITY_FACTOR * d) / limits.maxVelocity : Infinity;
  const ta =
    limits.maxAcceleration > 0 ? Math.sqrt((PEAK_ACCELERATION_FACTOR * d) / limits.maxAcceleration) : Infinity;
  const tj = limits.maxJerk > 0 ? Math.cbrt((PEAK_JERK_FACTOR * d) / limits.maxJerk) : Infinity;
  let duration = tv;
  let limitingMetric: DurationLimitingMetric = "velocity";
  if (ta > duration) {
    duration = ta;
    limitingMetric = "acceleration";
  }
  if (tj > duration) {
    duration = tj;
    limitingMetric = "jerk";
  }
  return { duration, limitingMetric };
}

/** Feasibility of the requested duration for the worst assigned drone. */
export function assessDurationFeasibility(
  plans: readonly TransitionDronePlan[],
  requestedDuration: number,
  limits: SafetyLimits,
): DurationFeasibilityResult {
  let worstDistance = 0;
  let worstDroneId: string | null = null;
  for (const p of plans) {
    if (p.distance > worstDistance) {
      worstDistance = p.distance;
      worstDroneId = p.droneId;
    }
  }
  const estimate = estimateMinimumDuration(worstDistance, limits);
  const minimum = roundUp(estimate.duration);
  return {
    requestedDuration,
    minimumEstimatedDuration: minimum,
    feasible: requestedDuration + 1e-6 >= estimate.duration,
    limitingMetric: estimate.limitingMetric,
    worstDistance,
    worstDroneId,
    model: DURATION_MODEL,
  };
}

/** Suggested duration: the estimated minimum rounded up to 0.1 s. */
export function suggestedDuration(feasibility: DurationFeasibilityResult): number {
  return Math.max(feasibility.requestedDuration, feasibility.minimumEstimatedDuration);
}

function roundUp(v: number): number {
  return Number.isFinite(v) ? Math.ceil(v * 10) / 10 : 0;
}
