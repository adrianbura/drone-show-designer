/**
 * Best-fit rigid rotation between two corresponding, centred point clouds.
 *
 * METHOD: orthogonal Procrustes / Kabsch solved through Horn's quaternion
 * formulation. The 3x3 covariance H = Σ q0_i q1_iᵀ is packed into the
 * symmetric 4x4 key matrix N; the eigenvector of its largest eigenvalue is the
 * optimal rotation quaternion. Eigen-decomposition uses a fixed-iteration
 * cyclic Jacobi sweep, which is numerically stable, reflection-free (a
 * quaternion can only encode a proper rotation) and fully deterministic — the
 * same inputs always produce bit-identical output, unlike sign-ambiguous SVD
 * implementations.
 */
import type { RigidFit } from "./types";

/** Symmetric eigen-decomposition by cyclic Jacobi rotations (deterministic). */
export function jacobiEigen(
  a: number[],
  n: number,
  sweeps = 32,
): { values: number[]; vectors: number[] } {
  const m = a.slice();
  const v = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p * n + q]! ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = m[p * n + q]!;
        if (Math.abs(apq) < 1e-18) continue;
        const app = m[p * n + p]!;
        const aqq = m[q * n + q]!;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = m[k * n + p]!;
          const akq = m[k * n + q]!;
          m[k * n + p] = c * akp - s * akq;
          m[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = m[p * n + k]!;
          const aqk = m[q * n + k]!;
          m[p * n + k] = c * apk - s * aqk;
          m[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p]!;
          const vkq = v[k * n + q]!;
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values: number[] = [];
  for (let i = 0; i < n; i++) values.push(m[i * n + i]!);
  return { values, vectors: v };
}

export function quaternionToMatrix(q: [number, number, number, number]): number[] {
  const [w, x, y, z] = q;
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

export function applyMatrix(
  r: number[],
  p: readonly [number, number, number],
): [number, number, number] {
  return [
    r[0]! * p[0] + r[1]! * p[1] + r[2]! * p[2],
    r[3]! * p[0] + r[4]! * p[1] + r[5]! * p[2],
    r[6]! * p[0] + r[7]! * p[1] + r[8]! * p[2],
  ];
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Rigid fit mapping centred cloud `from` onto centred cloud `to`.
 * Both arrays are flat xyz triplets of equal length and already centred.
 * Residuals are measured with scale fixed at 1 (pure rigid model); the
 * best-fit uniform scale is reported separately and never applied.
 */
export function rigidFitCentered(from: Float64Array, to: Float64Array): RigidFit {
  const n = Math.floor(Math.min(from.length, to.length) / 3);
  if (n === 0) {
    return {
      rotation: IDENTITY.slice(),
      angleDeg: 0,
      axis: [0, 1, 0],
      scale: 1,
      rmsError: 0,
      maxResidual: 0,
    };
  }
  // Covariance H = Σ from_i to_iᵀ
  let sxx = 0,
    sxy = 0,
    sxz = 0,
    syx = 0,
    syy = 0,
    syz = 0,
    szx = 0,
    szy = 0,
    szz = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    const ax = from[j]!,
      ay = from[j + 1]!,
      az = from[j + 2]!;
    const bx = to[j]!,
      by = to[j + 1]!,
      bz = to[j + 2]!;
    sxx += ax * bx;
    sxy += ax * by;
    sxz += ax * bz;
    syx += ay * bx;
    syy += ay * by;
    syz += ay * bz;
    szx += az * bx;
    szy += az * by;
    szz += az * bz;
  }
  // Horn key matrix N (symmetric 4x4).
  const nmat = [
    sxx + syy + szz,
    syz - szy,
    szx - sxz,
    sxy - syx,
    syz - szy,
    sxx - syy - szz,
    sxy + syx,
    szx + sxz,
    szx - sxz,
    sxy + syx,
    -sxx + syy - szz,
    syz + szy,
    sxy - syx,
    szx + sxz,
    syz + szy,
    -sxx - syy + szz,
  ];
  const { values, vectors } = jacobiEigen(nmat, 4);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i]! > values[best]!) best = i;
  let q: [number, number, number, number] = [
    vectors[0 * 4 + best]!,
    vectors[1 * 4 + best]!,
    vectors[2 * 4 + best]!,
    vectors[3 * 4 + best]!,
  ];
  const norm = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q = [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm];
  if (q[0] < 0) q = [-q[0], -q[1], -q[2], -q[3]]; // canonical sign
  const rotation = quaternionToMatrix(q);

  // Best-fit uniform scale (Umeyama): Σ<to, R from> / Σ|from|²
  let num = 0;
  let den = 0;
  let sq = 0;
  let maxResidual = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    const f: [number, number, number] = [from[j]!, from[j + 1]!, from[j + 2]!];
    const rf = applyMatrix(rotation, f);
    num += rf[0] * to[j]! + rf[1] * to[j + 1]! + rf[2] * to[j + 2]!;
    den += f[0] * f[0] + f[1] * f[1] + f[2] * f[2];
    const dx = to[j]! - rf[0];
    const dy = to[j + 1]! - rf[1];
    const dz = to[j + 2]! - rf[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    sq += d2;
    const d = Math.sqrt(d2);
    if (d > maxResidual) maxResidual = d;
  }
  const w = Math.min(1, Math.max(-1, q[0]));
  return {
    rotation,
    angleDeg: (2 * Math.acos(w) * 180) / Math.PI,
    axis: (() => {
      const s = Math.hypot(q[1], q[2], q[3]);
      return s < 1e-12
        ? ([0, 1, 0] as [number, number, number])
        : ([q[1] / s, q[2] / s, q[3] / s] as [number, number, number]);
    })(),
    scale: den > 1e-12 ? num / den : 1,
    rmsError: Math.sqrt(sq / n),
    maxResidual,
  };
}

/** Per-drone residual magnitudes after removing translation + rotation. */
export function residualMagnitudes(
  from: Float64Array,
  to: Float64Array,
  rotation: number[],
): Float64Array {
  const n = Math.floor(Math.min(from.length, to.length) / 3);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    const rf = applyMatrix(rotation, [from[j]!, from[j + 1]!, from[j + 2]!]);
    out[i] = Math.hypot(to[j]! - rf[0], to[j + 1]! - rf[1], to[j + 2]! - rf[2]);
  }
  return out;
}

/** Residual VECTORS after removing translation + rotation. */
export function residualVectors(
  from: Float64Array,
  to: Float64Array,
  rotation: number[],
  fromCentroid: readonly [number, number, number] = [0, 0, 0],
  toCentroid: readonly [number, number, number] = [0, 0, 0],
): Float64Array {
  const n = Math.floor(Math.min(from.length, to.length) / 3);
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    const rf = applyMatrix(rotation, [
      from[j]! - fromCentroid[0],
      from[j + 1]! - fromCentroid[1],
      from[j + 2]! - fromCentroid[2],
    ]);
    out[j] = to[j]! - (toCentroid[0] + rf[0]);
    out[j + 1] = to[j + 1]! - (toCentroid[1] + rf[1]);
    out[j + 2] = to[j + 2]! - (toCentroid[2] + rf[2]);
  }
  return out;
}

export interface RobustRigidResult extends RigidFit {
  /** Residual vectors for EVERY point, measured against the robust frame. */
  residualVectors: Float64Array;
  /** Residual magnitudes for every point. */
  residuals: Float64Array;
  fromCentroid: [number, number, number];
  toCentroid: [number, number, number];
  /** Fraction of points used as inliers in the final fit. */
  inlierFraction: number;
}

function centroidOf(cloud: Float64Array, indices: number[]): [number, number, number] {
  let x = 0,
    y = 0,
    z = 0;
  for (const i of indices) {
    x += cloud[i * 3]!;
    y += cloud[i * 3 + 1]!;
    z += cloud[i * 3 + 2]!;
  }
  const k = Math.max(1, indices.length);
  return [x / k, y / k, z / k];
}

/**
 * ROBUST rigid fit between two uncentred clouds.
 *
 * Seeding: per-point displacement vectors d_i = to_i - from_i are compared to
 * the MEDIAN displacement. Under rigid motion every d_i is close to the median;
 * a locally deforming subset (a flapping wing) deviates strongly. Points within
 * a median-absolute-deviation band form the inlier seed, so the global frame is
 * estimated from the rigid body only and cannot be tilted by the moving subset.
 * Two trimming passes then refine the inlier set by residual. Fully
 * deterministic — selection uses medians, never randomness.
 * Residuals are reported for ALL points against the robust frame.
 */
export function robustRigidFit(
  from: Float64Array,
  to: Float64Array,
  passes = 2,
): RobustRigidResult {
  const n = Math.floor(Math.min(from.length, to.length) / 3);
  const all = Array.from({ length: n }, (_, i) => i);
  let indices = n >= 8 ? displacementSeed(from, to, n) : all;
  if (indices.length < 4) indices = all;
  let result = fitOn(from, to, indices, n);
  for (let pass = 1; pass < passes && n >= 8; pass++) {
    const mags = result.residuals;
    const med = medianNumber(indices.map((i) => mags[i]!));
    const limit = Math.max(1e-9, med * 3 + 1e-6);
    const next = all.filter((i) => mags[i]! <= limit);
    if (next.length < 4 || next.length === indices.length) break;
    indices = next;
    result = fitOn(from, to, indices, n);
  }
  return { ...result, inlierFraction: n ? indices.length / n : 0 };
}

function fitOn(
  from: Float64Array,
  to: Float64Array,
  indices: number[],
  n: number,
): Omit<RobustRigidResult, "inlierFraction"> {
  const fc = centroidOf(from, indices);
  const tc = centroidOf(to, indices);
  const fit = rigidFitCentered(subtract(from, indices, fc), subtract(to, indices, tc));
  const vectors = residualVectors(from, to, fit.rotation, fc, tc);
  const residuals = magnitudesOf(vectors);
  let sq = 0;
  let max = 0;
  for (const r of residuals) {
    sq += r * r;
    if (r > max) max = r;
  }
  return {
    ...fit,
    rmsError: n ? Math.sqrt(sq / n) : 0,
    maxResidual: max,
    residualVectors: vectors,
    residuals: Float64Array.from(residuals),
    fromCentroid: fc,
    toCentroid: tc,
  };
}

function medianNumber(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function displacementSeed(from: Float64Array, to: Float64Array, n: number): number[] {
  const dx: number[] = [];
  const dy: number[] = [];
  const dz: number[] = [];
  for (let i = 0; i < n; i++) {
    dx.push(to[i * 3]! - from[i * 3]!);
    dy.push(to[i * 3 + 1]! - from[i * 3 + 1]!);
    dz.push(to[i * 3 + 2]! - from[i * 3 + 2]!);
  }
  const mx = medianNumber(dx);
  const my = medianNumber(dy);
  const mz = medianNumber(dz);
  const dev = dx.map((_, i) => Math.hypot(dx[i]! - mx, dy[i]! - my, dz[i]! - mz));
  const mad = medianNumber(dev);
  const limit = Math.max(1e-6, mad * 2.5);
  const seed = dev.map((d, i) => ({ d, i })).filter((e) => e.d <= limit).map((e) => e.i);
  return seed.length >= Math.max(4, Math.floor(n * 0.25)) ? seed : [];
}

function subtract(
  cloud: Float64Array,
  indices: number[],
  c: readonly [number, number, number],
): Float64Array {
  const out = new Float64Array(indices.length * 3);
  indices.forEach((src, k) => {
    out[k * 3] = cloud[src * 3]! - c[0];
    out[k * 3 + 1] = cloud[src * 3 + 1]! - c[1];
    out[k * 3 + 2] = cloud[src * 3 + 2]! - c[2];
  });
  return out;
}

function magnitudesOf(vectors: Float64Array): number[] {
  const n = vectors.length / 3;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.hypot(vectors[i * 3]!, vectors[i * 3 + 1]!, vectors[i * 3 + 2]!);
  }
  return out;
}
