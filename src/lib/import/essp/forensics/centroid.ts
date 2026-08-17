/**
 * Centroid decomposition.
 *
 * C(t) = mean of all drone positions at sample t. Subtracting C(t) yields the
 * centred formation shape Q_i(t) = P_i(t) - C(t), which removes pure global
 * translation and isolates rotation + internal deformation. Raw coordinates are
 * never altered — every helper returns fresh arrays.
 */
import type { PointCloudSequence } from "./types";

export interface CentroidTrack {
  times: Float64Array;
  /** Flat xyz per sample. */
  positions: Float64Array;
  /** Flat xyz per sample (finite difference). */
  velocities: Float64Array;
  /** Flat xyz per sample (finite difference of velocity). */
  accelerations: Float64Array;
  speeds: Float64Array;
  meanAltitude: Float64Array;
}

export function centroidAt(seq: PointCloudSequence, sample: number): [number, number, number] {
  const n = seq.droneCount;
  if (n === 0) return [0, 0, 0];
  const base = sample * n * 3;
  let x = 0,
    y = 0,
    z = 0;
  for (let i = 0; i < n; i++) {
    const j = base + i * 3;
    x += seq.positions[j]!;
    y += seq.positions[j + 1]!;
    z += seq.positions[j + 2]!;
  }
  return [x / n, y / n, z / n];
}

/** Centred cloud Q_i(t) = P_i(t) - C(t). Returns a new array. */
export function centeredCloud(
  seq: PointCloudSequence,
  sample: number,
  centroid?: readonly [number, number, number],
): Float64Array {
  const c = centroid ?? centroidAt(seq, sample);
  const n = seq.droneCount;
  const out = new Float64Array(n * 3);
  const base = sample * n * 3;
  for (let i = 0; i < n; i++) {
    const j = base + i * 3;
    out[i * 3] = seq.positions[j]! - c[0];
    out[i * 3 + 1] = seq.positions[j + 1]! - c[1];
    out[i * 3 + 2] = seq.positions[j + 2]! - c[2];
  }
  return out;
}

export function computeCentroidTrack(seq: PointCloudSequence): CentroidTrack {
  const m = seq.sampleCount;
  const positions = new Float64Array(m * 3);
  const velocities = new Float64Array(m * 3);
  const accelerations = new Float64Array(m * 3);
  const speeds = new Float64Array(m);
  const meanAltitude = new Float64Array(m);
  const dt = 1 / seq.rateHz;
  for (let s = 0; s < m; s++) {
    const c = centroidAt(seq, s);
    positions[s * 3] = c[0];
    positions[s * 3 + 1] = c[1];
    positions[s * 3 + 2] = c[2];
    meanAltitude[s] = c[1];
  }
  for (let s = 1; s < m; s++) {
    for (let k = 0; k < 3; k++) {
      velocities[s * 3 + k] = (positions[s * 3 + k]! - positions[(s - 1) * 3 + k]!) / dt;
    }
    speeds[s] = Math.hypot(velocities[s * 3]!, velocities[s * 3 + 1]!, velocities[s * 3 + 2]!);
  }
  if (m > 1) {
    speeds[0] = speeds[1]!;
    for (let k = 0; k < 3; k++) velocities[k] = velocities[3 + k]!;
  }
  for (let s = 1; s < m; s++) {
    for (let k = 0; k < 3; k++) {
      accelerations[s * 3 + k] = (velocities[s * 3 + k]! - velocities[(s - 1) * 3 + k]!) / dt;
    }
  }
  return { times: seq.times, positions, velocities, accelerations, speeds, meanAltitude };
}

/** Fraction of drones at or below a ground altitude at one sample. */
export function groundFractionAt(
  seq: PointCloudSequence,
  sample: number,
  groundAltitude: number,
): number {
  const n = seq.droneCount;
  if (n === 0) return 0;
  const base = sample * n * 3;
  let count = 0;
  for (let i = 0; i < n; i++) if (seq.positions[base + i * 3 + 1]! <= groundAltitude) count++;
  return count / n;
}

/** Raw (uncentred) cloud at one sample, as a fresh array. */
export function cloudAt(seq: PointCloudSequence, sample: number): Float64Array {
  const n = seq.droneCount;
  const out = new Float64Array(n * 3);
  const base = sample * n * 3;
  for (let i = 0; i < n * 3; i++) out[i] = seq.positions[base + i]!;
  return out;
}
