/**
 * Dynamic clip -> canonical PlannedTrajectory.
 *
 * Dynamic formations are NOT a second trajectory format. A dynamic hold is
 * turned into an ordinary `PlannedTrajectory` whose position comes from the
 * dynamic sampler and whose derivatives come from central finite differences.
 * The result flows through the existing sampler, conflict detector, safety
 * validator and exporter untouched.
 */
import { headingFromVelocity, normalizeYawDeg } from "../coordinates";
import type { Vector3Tuple } from "../types";
import type { PlannedTrajectory, TrajectorySample } from "../trajectory/types";
import type { DynamicEvaluator } from "./sampler";
import { DYNAMIC_FORMATION_ALGORITHM_VERSION } from "./types";

/** Finite-difference step (s). 1/240 keeps derivative noise below 1e-3. */
const H = 1 / 240;

const sub = (a: Vector3Tuple, b: Vector3Tuple, k: number): Vector3Tuple => [
  (a[0] - b[0]) * k,
  (a[1] - b[1]) * k,
  (a[2] - b[2]) * k,
];

export interface DynamicSegmentOptions {
  /** Yaw when the point is (nearly) stationary. */
  readonly fallbackYaw?: number;
  /** When true, yaw follows the horizontal direction of travel. */
  readonly faceDirectionOfTravel?: boolean;
}

/**
 * Wraps one point of a dynamic formation as a continuous trajectory over
 * [0, duration] of the clip's hold.
 */
export function planDynamicPoint(
  /**
   * Any memoised point-field evaluator: a single dynamic formation OR a composed
   * multi-formation scene (Sprint 7.3.5). Both expose the same sampling surface,
   * so there is still exactly ONE trajectory format downstream.
   */
  evaluator: Pick<DynamicEvaluator, "pointAt">,
  pointIndex: number,
  duration: number,
  options: DynamicSegmentOptions = {},
): PlannedTrajectory {
  const span = Math.max(0.01, duration);
  const faceTravel = options.faceDirectionOfTravel ?? true;
  const fallbackYaw = options.fallbackYaw ?? 0;

  const at = (t: number): Vector3Tuple =>
    evaluator.pointAt(pointIndex, Math.max(0, Math.min(span, t)));

  const sample = (tRaw: number): TrajectorySample => {
    const t = Math.max(0, Math.min(span, tRaw));
    const p0 = at(t - H);
    const p1 = at(t);
    const p2 = at(t + H);
    const pm = at(t - 2 * H);
    const pp = at(t + 2 * H);
    const velocity = sub(p2, p0, 1 / (2 * H));
    const acceleration: Vector3Tuple = [
      (p2[0] - 2 * p1[0] + p0[0]) / (H * H),
      (p2[1] - 2 * p1[1] + p0[1]) / (H * H),
      (p2[2] - 2 * p1[2] + p0[2]) / (H * H),
    ];
    const jerk: Vector3Tuple = [
      (pp[0] - 2 * p2[0] + 2 * p0[0] - pm[0]) / (2 * H * H * H),
      (pp[1] - 2 * p2[1] + 2 * p0[1] - pm[1]) / (2 * H * H * H),
      (pp[2] - 2 * p2[2] + 2 * p0[2] - pm[2]) / (2 * H * H * H),
    ];
    const horizontal = Math.hypot(velocity[0], velocity[2]);
    const yaw =
      faceTravel && horizontal > 0.05
        ? headingFromVelocity(velocity[0], velocity[2])
        : normalizeYawDeg(fallbackYaw);
    const yawPrev = (() => {
      if (!faceTravel) return yaw;
      const v = sub(p1, p0, 1 / H);
      return Math.hypot(v[0], v[2]) > 0.05
        ? headingFromVelocity(v[0], v[2])
        : normalizeYawDeg(fallbackYaw);
    })();
    return {
      t,
      position: p1,
      velocity,
      acceleration,
      jerk,
      yaw,
      yawRate: normalizeYawDeg(yaw - yawPrev) / H,
    };
  };

  return {
    duration: span,
    plannerId: `dynamicFormation@${DYNAMIC_FORMATION_ALGORITHM_VERSION}`,
    sample,
  };
}

/** Positions of every point at the END of a dynamic segment. */
export function dynamicEndPositions(
  evaluator: DynamicEvaluator,
  duration: number,
): readonly Vector3Tuple[] {
  return evaluator.positionsAt(Math.max(0.01, duration));
}
