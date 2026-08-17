/**
 * Rotation representation helpers for the reference -> dynamic converter.
 *
 * The native DynamicFormation stores rotation as EULER DEGREES (X then Y then Z,
 * intrinsic) which `quatFromEulerDeg` turns back into a quaternion. Conversion
 * therefore has to travel:
 *
 *   3x3 best-fit matrix  ->  quaternion (sign-continuous)  ->  euler degrees
 *
 * and the round trip must reproduce the same rotation. `eulerDegFromMatrix`
 * is the exact inverse of `quatFromEulerDeg` for the XYZ convention, which is
 * covered by the conversion tests.
 */
import type { Quat } from "../../../show/dynamic/math";

const RAD = 180 / Math.PI;

/** Row-major 3x3 rotation matrix -> quaternion [x, y, z, w]. */
export function quatFromMatrix(r: readonly number[]): Quat {
  const m11 = r[0]!,
    m12 = r[1]!,
    m13 = r[2]!,
    m21 = r[3]!,
    m22 = r[4]!,
    m23 = r[5]!,
    m31 = r[6]!,
    m32 = r[7]!,
    m33 = r[8]!;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [(m32 - m23) / s, (m13 - m31) / s, (m21 - m12) / s, 0.25 * s];
  }
  if (m11 > m22 && m11 > m33) {
    const s = Math.sqrt(1 + m11 - m22 - m33) * 2;
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  }
  if (m22 > m33) {
    const s = Math.sqrt(1 + m22 - m11 - m33) * 2;
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  }
  const s = Math.sqrt(1 + m33 - m11 - m22) * 2;
  return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
}

/** Quaternion [x, y, z, w] -> row-major 3x3 rotation matrix. */
export function matrixFromQuat(q: Quat): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

/**
 * Row-major 3x3 rotation matrix -> euler DEGREES in the native XYZ convention.
 * Inverse of `quatFromEulerDeg`.
 */
export function eulerDegFromMatrix(r: readonly number[]): [number, number, number] {
  const m11 = r[0]!,
    m12 = r[1]!,
    m13 = r[2]!,
    m22 = r[4]!,
    m23 = r[5]!,
    m32 = r[7]!,
    m33 = r[8]!;
  const clamped = Math.min(1, Math.max(-1, m13));
  const y = Math.asin(clamped);
  if (Math.abs(clamped) < 0.9999999) {
    return [Math.atan2(-m23, m33) * RAD, y * RAD, Math.atan2(-m12, m11) * RAD];
  }
  // Gimbal-locked: fold the ambiguous z rotation into x.
  return [Math.atan2(m32, m22) * RAD, y * RAD, 0];
}

export function eulerDegFromQuat(q: Quat): [number, number, number] {
  return eulerDegFromMatrix(matrixFromQuat(q));
}

/** Flips `q` when it is on the far hemisphere from `previous` (no 360° flips). */
export function continuousQuat(q: Quat, previous: Quat | null): Quat {
  if (!previous) return q;
  const dot = q[0] * previous[0] + q[1] * previous[1] + q[2] * previous[2] + q[3] * previous[3];
  return dot < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
}

/** Rotates a vector by a row-major 3x3 matrix. */
export function applyRowMajor(
  r: readonly number[],
  v: readonly [number, number, number],
): [number, number, number] {
  return [
    r[0]! * v[0] + r[1]! * v[1] + r[2]! * v[2],
    r[3]! * v[0] + r[4]! * v[1] + r[5]! * v[2],
    r[6]! * v[0] + r[7]! * v[1] + r[8]! * v[2],
  ];
}

/** Rotates a vector by the TRANSPOSE (inverse) of a row-major rotation matrix. */
export function applyRowMajorTranspose(
  r: readonly number[],
  v: readonly [number, number, number],
): [number, number, number] {
  return [
    r[0]! * v[0] + r[3]! * v[1] + r[6]! * v[2],
    r[1]! * v[0] + r[4]! * v[1] + r[7]! * v[2],
    r[2]! * v[0] + r[5]! * v[1] + r[8]! * v[2],
  ];
}

/** Angle in radians between two unit quaternions (shortest arc). */
export function quatAngle(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
}
