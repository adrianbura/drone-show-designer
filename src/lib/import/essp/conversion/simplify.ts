/**
 * Deterministic, error-bounded keyframe reduction.
 *
 * A Ramer-Douglas-Peucker style recursive split on each track: the endpoints of
 * a span are kept, the sample whose LINEARLY INTERPOLATED value deviates most
 * from the source is inserted when its deviation exceeds the tolerance, and the
 * two halves are processed recursively. Deviation is always measured in METRES:
 * rotation deviation is converted using the largest local point radius, so a
 * tolerance means the same thing on every track. No randomness whatsoever.
 */
import { quatSlerp } from "../../../show/dynamic/math";
import type { Quat } from "../../../show/dynamic/math";

export type Vec3 = readonly [number, number, number];

function lerpVec(a: Vec3, b: Vec3, u: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Indices (always including the first and last) needed to stay within `tolerance`. */
export function simplifyVectorTrack(
  times: readonly number[],
  values: readonly Vec3[],
  tolerance: number,
): number[] {
  const n = values.length;
  if (n <= 2) return times.map((_, i) => i);
  const keep = new Set<number>([0, n - 1]);
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const ta = times[a]!;
    const tb = times[b]!;
    const span = tb - ta;
    let worst = -1;
    let worstError = 0;
    for (let i = a + 1; i < b; i++) {
      const u = span <= 0 ? 0 : (times[i]! - ta) / span;
      const approx = lerpVec(values[a]!, values[b]!, u);
      const v = values[i]!;
      const e = Math.hypot(v[0] - approx[0], v[1] - approx[1], v[2] - approx[2]);
      if (e > worstError) {
        worstError = e;
        worst = i;
      }
    }
    if (worst > 0 && worstError > tolerance) {
      keep.add(worst);
      stack.push([a, worst], [worst, b]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

/**
 * Same recursion for a quaternion track. Deviation is the arc between the
 * slerped approximation and the sample, scaled by `radius` to give metres.
 */
export function simplifyQuaternionTrack(
  times: readonly number[],
  quats: readonly Quat[],
  toleranceMeters: number,
  radius: number,
): number[] {
  const n = quats.length;
  if (n <= 2) return quats.map((_, i) => i);
  const r = Math.max(radius, 1e-6);
  const keep = new Set<number>([0, n - 1]);
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const ta = times[a]!;
    const tb = times[b]!;
    const span = tb - ta;
    let worst = -1;
    let worstError = 0;
    for (let i = a + 1; i < b; i++) {
      const u = span <= 0 ? 0 : (times[i]! - ta) / span;
      const approx = quatSlerp(quats[a]!, quats[b]!, u);
      const q = quats[i]!;
      const dot = Math.abs(
        approx[0] * q[0] + approx[1] * q[1] + approx[2] * q[2] + approx[3] * q[3],
      );
      const angle = 2 * Math.acos(Math.min(1, dot));
      const e = angle * r;
      if (e > worstError) {
        worstError = e;
        worst = i;
      }
    }
    if (worst > 0 && worstError > toleranceMeters) {
      keep.add(worst);
      stack.push([a, worst], [worst, b]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

export function unionIndices(a: readonly number[], b: readonly number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}
