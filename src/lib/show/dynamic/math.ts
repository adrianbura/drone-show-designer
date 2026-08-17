/**
 * Pure maths for the dynamic formation engine: loop mapping, keyframe easing,
 * quaternion rotation and slerp. No allocations beyond small tuples; every
 * function is deterministic.
 */
import type { Vector3Tuple } from "../types";
import type { KeyframeInterpolation, LoopMode } from "./types";

export type Quat = readonly [number, number, number, number]; // x, y, z, w

const DEG = Math.PI / 180;

/** Maps an unbounded local time into [0, duration] per the loop mode. */
export function mapLoopTime(t: number, duration: number, loop: LoopMode): number {
  if (!Number.isFinite(t) || duration <= 0) return 0;
  if (loop === "NONE") return Math.max(0, Math.min(duration, t));
  if (t >= 0 && t <= duration) return t;
  if (loop === "REPEAT") {
    const m = t % duration;
    return m < 0 ? m + duration : m;
  }
  // PING_PONG: triangle wave with period 2 * duration.
  const period = duration * 2;
  let m = t % period;
  if (m < 0) m += period;
  return m <= duration ? m : period - m;
}

/** Eased progress in [0,1]. `minJerk` is the standard 6t^5-15t^4+10t^3 curve. */
export function easeProgress(u: number, kind: KeyframeInterpolation = "linear"): number {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  if (kind === "smooth") return x * x * (3 - 2 * x);
  if (kind === "minJerk") return x * x * x * (10 + x * (-15 + 6 * x));
  return x;
}

export interface KeyframeSpan<K> {
  readonly a: K;
  readonly b: K;
  /** Eased progress from a to b. */
  readonly u: number;
}

/**
 * Locates the keyframe span around `t`. Keyframes must be sorted by `t`.
 * Before the first / after the last keyframe the boundary keyframe is held.
 */
export function keyframeSpan<K extends { t: number; interpolation?: KeyframeInterpolation }>(
  keys: readonly K[],
  t: number,
): KeyframeSpan<K> | null {
  if (keys.length === 0) return null;
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (keys.length === 1 || t <= first.t) return { a: first, b: first, u: 0 };
  if (t >= last.t) return { a: last, b: last, u: 0 };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const raw = span <= 0 ? 1 : (t - a.t) / span;
      return { a, b, u: easeProgress(raw, a.interpolation ?? "smooth") };
    }
  }
  return { a: last, b: last, u: 0 };
}

export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

export function lerpVec(a: Vector3Tuple, b: Vector3Tuple, u: number): Vector3Tuple {
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
}

/** Euler degrees (X then Y then Z, intrinsic) -> unit quaternion. */
export function quatFromEulerDeg(e: Vector3Tuple): Quat {
  const hx = (e[0] * DEG) / 2;
  const hy = (e[1] * DEG) / 2;
  const hz = (e[2] * DEG) / 2;
  const cx = Math.cos(hx);
  const sx = Math.sin(hx);
  const cy = Math.cos(hy);
  const sy = Math.sin(hy);
  const cz = Math.cos(hz);
  const sz = Math.sin(hz);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

export function quatSlerp(a: Quat, b: Quat, u: number): Quat {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  if (dot > 0.9995) {
    const q: Quat = [
      lerp(a[0], bx, u),
      lerp(a[1], by, u),
      lerp(a[2], bz, u),
      lerp(a[3], bw, u),
    ];
    return quatNormalize(q);
  }
  const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)));
  const theta = theta0 * u;
  const sin0 = Math.sin(theta0);
  const s0 = Math.sin(theta0 - theta) / sin0;
  const s1 = Math.sin(theta) / sin0;
  return [a[0] * s0 + bx * s1, a[1] * s0 + by * s1, a[2] * s0 + bz * s1, a[3] * s0 + bw * s1];
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n === 0) return [0, 0, 0, 1];
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotates a vector by a unit quaternion. */
export function rotateByQuat(v: Vector3Tuple, q: Quat): Vector3Tuple {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

export function centroid(points: readonly Vector3Tuple[]): Vector3Tuple {
  if (points.length === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length;
  return [x / n, y / n, z / n];
}
