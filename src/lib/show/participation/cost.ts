/**
 * PARTICIPATION COST MODEL — explicit, deterministic, arithmetic only.
 *
 * No AI, no randomness, no wall-clock input. Every term is squared metres so
 * the model is scale-consistent and comparable across scenes:
 *
 *   activeCost(d, p)   = |current(d) - p|^2                       (transition now)
 *                        * stabilityDiscount when d was active in the previous
 *                          scene of the same formation                (churn)
 *   reserveCost(d)     = reserveBase * scale + future * futureCost(d)
 *                        futureCost(d) = min over LOOK-AHEAD points |current(d) - p|^2
 *   prepositionCost    = |current(d) - adjustedTarget|^2
 *                        + footprint * scale  when the straight path crosses the
 *                          artistic footprint sphere            (visual clutter)
 *                        + movement * |current(d) - adjustedTarget|^2
 *
 * `scale` is the mean of every drone's cheapest active cost for the scene, so
 * the constant terms stay meaningful for a 20 m and for a 200 m show alike.
 */
import type { Vector3Tuple } from "../types";

export const PARTICIPATION_COST_MODEL_VERSION = "0.1.0";

export interface ParticipationCostWeights {
  /** Weight of the current transition cost for active candidates. */
  readonly active: number;
  /** Weight of the look-ahead positioning cost when staying out of the image. */
  readonly future: number;
  /** Constant reluctance to leave a drone out of the active formation. */
  readonly reserveBase: number;
  /** Multiplier (< 1) applied to a previously active drone's active cost. */
  readonly stabilityDiscount: number;
  /** Penalty for pre-positioning paths crossing the artistic footprint. */
  readonly footprint: number;
  /** Penalty for unnecessary movement of non-participating drones. */
  readonly movement: number;
}

export const DEFAULT_PARTICIPATION_WEIGHTS: ParticipationCostWeights = {
  active: 1,
  future: 0.6,
  reserveBase: 1.2,
  stabilityDiscount: 0.85,
  footprint: 2,
  movement: 0.1,
};

export function sqDistance(a: Vector3Tuple, b: Vector3Tuple): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

export interface Footprint {
  readonly centroid: Vector3Tuple;
  /** Radius of the bounding sphere of the artistic point cloud, in metres. */
  readonly radius: number;
  readonly min: Vector3Tuple;
  readonly max: Vector3Tuple;
}

export const EMPTY_FOOTPRINT: Footprint = {
  centroid: [0, 0, 0],
  radius: 0,
  min: [0, 0, 0],
  max: [0, 0, 0],
};

export function footprintOf(points: readonly Vector3Tuple[]): Footprint {
  if (points.length === 0) return EMPTY_FOOTPRINT;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    sx += p[0];
    sy += p[1];
    sz += p[2];
    for (let k = 0; k < 3; k++) {
      if (p[k]! < min[k]!) min[k] = p[k]!;
      if (p[k]! > max[k]!) max[k] = p[k]!;
    }
  }
  const n = points.length;
  const centroid: Vector3Tuple = [sx / n, sy / n, sz / n];
  let radius = 0;
  for (const p of points) radius = Math.max(radius, sqDistance(p, centroid));
  return { centroid, radius: Math.sqrt(radius), min, max };
}

/**
 * True when the straight segment a -> b passes through the footprint sphere
 * (inflated by `margin`). Used as a visual-clutter penalty, never as a safety
 * check: the conflict detector remains authoritative.
 */
export function segmentCrossesFootprint(
  a: Vector3Tuple,
  b: Vector3Tuple,
  footprint: Footprint,
  margin = 0,
): boolean {
  const r = footprint.radius + margin;
  if (!(r > 0)) return false;
  const c = footprint.centroid;
  const ab: Vector3Tuple = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vector3Tuple = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  if (len2 <= 1e-9) return sqDistance(a, c) <= r * r;
  let t = (ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2]) / len2;
  t = Math.max(0, Math.min(1, t));
  const closest: Vector3Tuple = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return sqDistance(closest, c) <= r * r;
}

/**
 * Moves a pre-position target out of the artistic footprint so preparing drones
 * do not stand inside the visible image. Deterministic: the point is pushed
 * radially outward in XZ, altitude untouched.
 */
export function pushOutsideFootprint(
  point: Vector3Tuple,
  footprint: Footprint,
  margin: number,
): Vector3Tuple {
  const r = footprint.radius + margin;
  if (!(r > 0)) return point;
  const c = footprint.centroid;
  const dx = point[0] - c[0];
  const dz = point[2] - c[2];
  const planar = Math.hypot(dx, dz);
  const dy = point[1] - c[1];
  if (Math.sqrt(planar * planar + dy * dy) >= r) return point;
  // Degenerate centre: push along +X so the result stays deterministic.
  const ux = planar > 1e-6 ? dx / planar : 1;
  const uz = planar > 1e-6 ? dz / planar : 0;
  const need = Math.sqrt(Math.max(0, r * r - dy * dy));
  return [c[0] + ux * need, point[1], c[2] + uz * need];
}
