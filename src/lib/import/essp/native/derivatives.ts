/**
 * KINEMATICS OF AN IMPORTED (REFERENCE-OWNED) INTERVAL.
 *
 * The imported archive carries POSITIONS ONLY. Velocity, acceleration and jerk
 * are therefore DERIVED from the source position stream by finite differences on
 * the source clock (h = 1 / positionRateHz) — never re-planned, never smoothed
 * and never taken from the planner:
 *
 *   v(t) = (p(t+h) - p(t-h)) / 2h
 *   a(t) = (p(t+h) - 2p(t) + p(t-h)) / h^2          (difference of velocities)
 *   j(t) = (p(t+2h) - 2p(t+h) + 2p(t-h) - p(t-2h)) / 2h^3   (difference of accelerations)
 *
 * Yaw is NOT part of the ESSP payload, so reference-owned samples report
 * yaw = 0 and yawRate = 0 rather than inventing a heading the source never
 * stated.
 */
import type { Vector3Tuple } from "../../../show/types";
import { sampleReferenceDrone } from "../playback";
import type { ReferenceDrone, ReferenceShow } from "../types";

export interface ReferenceKinematics {
  readonly position: Vector3Tuple;
  readonly velocity: Vector3Tuple;
  readonly acceleration: Vector3Tuple;
  readonly jerk: Vector3Tuple;
}

const sub = (a: Vector3Tuple, b: Vector3Tuple, k: number): Vector3Tuple => [
  (a[0] - b[0]) * k,
  (a[1] - b[1]) * k,
  (a[2] - b[2]) * k,
];

/** Kinematic state of one imported drone at show time `t`. */
export function referenceKinematicsAt(
  drone: ReferenceDrone,
  t: number,
  timing: ReferenceShow["timing"],
): ReferenceKinematics {
  const h = 1 / Math.max(1e-9, timing.positionRateHz);
  const at = (time: number): Vector3Tuple =>
    sampleReferenceDrone(drone, Math.max(0, time), timing).position as Vector3Tuple;

  const p0 = at(t);
  const pPlus = at(t + h);
  const pMinus = at(t - h);
  const pPlus2 = at(t + 2 * h);
  const pMinus2 = at(t - 2 * h);

  const velocity = sub(pPlus, pMinus, 1 / (2 * h));
  const acceleration: Vector3Tuple = [
    (pPlus[0] - 2 * p0[0] + pMinus[0]) / (h * h),
    (pPlus[1] - 2 * p0[1] + pMinus[1]) / (h * h),
    (pPlus[2] - 2 * p0[2] + pMinus[2]) / (h * h),
  ];
  const jerk: Vector3Tuple = [
    (pPlus2[0] - 2 * pPlus[0] + 2 * pMinus[0] - pMinus2[0]) / (2 * h * h * h),
    (pPlus2[1] - 2 * pPlus[1] + 2 * pMinus[1] - pMinus2[1]) / (2 * h * h * h),
    (pPlus2[2] - 2 * pPlus[2] + 2 * pMinus[2] - pMinus2[2]) / (2 * h * h * h),
  ];

  return { position: p0, velocity, acceleration, jerk };
}
