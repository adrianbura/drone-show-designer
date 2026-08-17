/**
 * Segment decomposition: sampled reference geometry -> global translation,
 * global rotation and LOCAL internal deformation.
 *
 * COORDINATE SPACES (never mixed implicitly):
 *   ESSP raw units        int16 triplets in the immutable ReferenceDrone arrays
 *   studio world metres   produced by the single ESSP coordinate adapter
 *   reference centred     world minus the fleet centroid at the current sample
 *   formation local       reference centred, de-rotated by R(t)^T
 *
 * Only READS the point-cloud sequence. Nothing is written back.
 */
import { rigidFitCentered, robustRigidFit } from "../forensics/rigid";
import type { PointCloudSequence } from "../forensics/types";
import {
  applyRowMajor,
  applyRowMajorTranspose,
  continuousQuat,
  eulerDegFromQuat,
  quatFromMatrix,
} from "./rotation";
import type {
  ExtractedDeformationTrack,
  ExtractedTransformSample,
  ReferenceFrameMode,
  RotationFitMode,
} from "./types";
import type { Quat } from "../../../show/dynamic/math";

export interface SegmentWindow {
  /** Inclusive source sample indices. */
  readonly firstIndex: number;
  readonly lastIndex: number;
}

/** Source sample indices covered by [startTime, endTime] (inclusive). */
export function segmentWindow(
  sequence: PointCloudSequence,
  startTime: number,
  endTime: number,
): SegmentWindow {
  const eps = 1e-9;
  let first = 0;
  let last = sequence.sampleCount - 1;
  for (let s = 0; s < sequence.sampleCount; s++) {
    if (sequence.times[s]! >= startTime - eps) {
      first = s;
      break;
    }
  }
  for (let s = sequence.sampleCount - 1; s >= 0; s--) {
    if (sequence.times[s]! <= endTime + eps) {
      last = s;
      break;
    }
  }
  if (last < first) last = first;
  return { firstIndex: first, lastIndex: last };
}

export interface SegmentDecomposition {
  readonly droneIds: readonly string[];
  readonly droneCount: number;
  readonly sampleCount: number;
  readonly rateHz: number;
  /** Segment-local times (0 = first sample of the segment). */
  readonly localTimes: number[];
  readonly absoluteTimes: number[];
  /** Reference centroid C_ref in world metres — the native formation pivot. */
  readonly pivot: [number, number, number];
  /** base_i = P_i(t_ref) in world metres. */
  readonly basePoints: [number, number, number][];
  /** Q_i = base_i - pivot. */
  readonly referenceLocal: Float64Array;
  readonly transform: ExtractedTransformSample[];
  /** Flat local deformation [frame][drone][xyz]. */
  readonly deformation: Float64Array;
  /** Flat source world positions [frame][drone][xyz] (copy, read-only use). */
  readonly world: Float64Array;
  readonly referenceIndex: number;
  readonly referenceTime: number;
  /** Per-frame rigid-fit residual RMS (rotation model error, metres). */
  readonly rigidResidualRms: number[];
  /** Per-drone mean local deformation magnitude. */
  readonly perDroneMeanDeformation: number[];
  readonly maxLocalRadius: number;
}

function centroidAt(positions: Float64Array, frame: number, n: number): [number, number, number] {
  let x = 0,
    y = 0,
    z = 0;
  const base = frame * n * 3;
  for (let i = 0; i < n; i++) {
    x += positions[base + i * 3]!;
    y += positions[base + i * 3 + 1]!;
    z += positions[base + i * 3 + 2]!;
  }
  const k = Math.max(1, n);
  return [x / k, y / k, z / k];
}

export interface DecomposeOptions {
  readonly referenceFrame: ReferenceFrameMode;
  readonly referenceTime: number | null;
  readonly rotationFit: RotationFitMode;
}

/**
 * Decomposes the sampled window into T(t), R(t) and D_i(t) about a reference
 * frame. The identity `P_i(t) = pivot + T(t) + R(t)[Q_i + D_i(t)]` holds
 * exactly by construction (D is defined as the residual).
 */
export function decomposeSegment(
  sequence: PointCloudSequence,
  window: SegmentWindow,
  options: DecomposeOptions,
): SegmentDecomposition {
  const n = sequence.droneCount;
  const frames = window.lastIndex - window.firstIndex + 1;
  const first = decomposeAbout(sequence, window, resolveReferenceIndex(sequence, window, options), options);
  if (options.referenceFrame !== "LOWEST_DEFORMATION_FRAME" || frames < 3 || n === 0) return first;
  // Second pass: re-anchor on the frame with the smallest rigid residual.
  let best = 0;
  for (let k = 1; k < first.rigidResidualRms.length; k++) {
    if (first.rigidResidualRms[k]! < first.rigidResidualRms[best]!) best = k;
  }
  if (best === 0) return first;
  return decomposeAbout(sequence, window, window.firstIndex + best, options);
}

function resolveReferenceIndex(
  sequence: PointCloudSequence,
  window: SegmentWindow,
  options: DecomposeOptions,
): number {
  if (options.referenceFrame === "USER_SELECTED_FRAME" && options.referenceTime !== null) {
    let best = window.firstIndex;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let s = window.firstIndex; s <= window.lastIndex; s++) {
      const d = Math.abs(sequence.times[s]! - options.referenceTime);
      if (d < bestDelta) {
        bestDelta = d;
        best = s;
      }
    }
    return best;
  }
  return window.firstIndex;
}

function decomposeAbout(
  sequence: PointCloudSequence,
  window: SegmentWindow,
  referenceIndex: number,
  options: DecomposeOptions,
): SegmentDecomposition {
  const n = sequence.droneCount;
  const frames = window.lastIndex - window.firstIndex + 1;
  const src = sequence.positions;
  const t0 = sequence.times[window.firstIndex] ?? 0;

  const pivot = centroidAt(src, referenceIndex, n);
  const basePoints: [number, number, number][] = [];
  const referenceLocal = new Float64Array(n * 3);
  const refBase = referenceIndex * n * 3;
  for (let i = 0; i < n; i++) {
    const p: [number, number, number] = [
      src[refBase + i * 3]!,
      src[refBase + i * 3 + 1]!,
      src[refBase + i * 3 + 2]!,
    ];
    basePoints.push(p);
    referenceLocal[i * 3] = p[0] - pivot[0];
    referenceLocal[i * 3 + 1] = p[1] - pivot[1];
    referenceLocal[i * 3 + 2] = p[2] - pivot[2];
  }
  let maxLocalRadius = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(
      referenceLocal[i * 3]!,
      referenceLocal[i * 3 + 1]!,
      referenceLocal[i * 3 + 2]!,
    );
    if (r > maxLocalRadius) maxLocalRadius = r;
  }

  const localTimes: number[] = [];
  const absoluteTimes: number[] = [];
  const transform: ExtractedTransformSample[] = [];
  const deformation = new Float64Array(frames * n * 3);
  const world = new Float64Array(frames * n * 3);
  const rigidResidualRms: number[] = [];
  const perDroneSum = new Float64Array(n);
  let previousQuat: Quat | null = null;
  const current = new Float64Array(n * 3);

  for (let k = 0; k < frames; k++) {
    const s = window.firstIndex + k;
    absoluteTimes.push(sequence.times[s]!);
    localTimes.push(sequence.times[s]! - t0);
    const base = s * n * 3;
    const centroid = centroidAt(src, s, n);
    for (let i = 0; i < n; i++) {
      const o = base + i * 3;
      world[k * n * 3 + i * 3] = src[o]!;
      world[k * n * 3 + i * 3 + 1] = src[o + 1]!;
      world[k * n * 3 + i * 3 + 2] = src[o + 2]!;
      current[i * 3] = src[o]! - centroid[0];
      current[i * 3 + 1] = src[o + 1]! - centroid[1];
      current[i * 3 + 2] = src[o + 2]! - centroid[2];
    }

    const fit =
      options.rotationFit === "ROBUST" && n >= 8
        ? robustRigidFit(referenceLocal, current)
        : rigidFitCentered(referenceLocal, current);
    const rotation = fit.rotation;
    const quat = continuousQuat(quatFromMatrix(rotation), previousQuat);
    previousQuat = quat;

    // Robust mode anchors the frame on the INLIER centroids so a locally moving
    // subset (a flapping wing) cannot drag the global translation or rotation.
    // KABSCH mode uses the plain fleet centroid (fc = tc = 0).
    const fc: [number, number, number] =
      "fromCentroid" in fit ? (fit.fromCentroid as [number, number, number]) : [0, 0, 0];
    const tc: [number, number, number] =
      "toCentroid" in fit ? (fit.toCentroid as [number, number, number]) : [0, 0, 0];
    const rfc = applyRowMajor(rotation, fc);

    // Rigid residual measured in the SAME frame as the reconstruction.
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const rq = applyRowMajor(rotation, [
        referenceLocal[i * 3]! - fc[0],
        referenceLocal[i * 3 + 1]! - fc[1],
        referenceLocal[i * 3 + 2]! - fc[2],
      ]);
      const dx = current[i * 3]! - tc[0] - rq[0];
      const dy = current[i * 3 + 1]! - tc[1] - rq[1];
      const dz = current[i * 3 + 2]! - tc[2] - rq[2];
      sq += dx * dx + dy * dy + dz * dz;
      // D_i(t) = R^T (P_i - pivot - T(t)) - Q_i   (LOCAL space)
      const local = applyRowMajorTranspose(rotation, [
        current[i * 3]! - tc[0],
        current[i * 3 + 1]! - tc[1],
        current[i * 3 + 2]! - tc[2],
      ]);
      const ox = local[0] + fc[0] - referenceLocal[i * 3]!;
      const oy = local[1] + fc[1] - referenceLocal[i * 3 + 1]!;
      const oz = local[2] + fc[2] - referenceLocal[i * 3 + 2]!;
      const off = k * n * 3 + i * 3;
      deformation[off] = ox;
      deformation[off + 1] = oy;
      deformation[off + 2] = oz;
      perDroneSum[i]! += Math.hypot(ox, oy, oz);
    }
    rigidResidualRms.push(n ? Math.sqrt(sq / n) : 0);

    transform.push({
      t: localTimes[k]!,
      translation: [
        centroid[0] - pivot[0] + tc[0] - rfc[0],
        centroid[1] - pivot[1] + tc[1] - rfc[1],
        centroid[2] - pivot[2] + tc[2] - rfc[2],
      ],
      quaternion: quat,
      rotationEulerDeg: eulerDegFromQuat(quat),
      rigidRmsMeters: rigidResidualRms[k]!,
    });
  }

  return {
    droneIds: sequence.droneIds,
    droneCount: n,
    sampleCount: frames,
    rateHz: sequence.rateHz,
    localTimes,
    absoluteTimes,
    pivot,
    basePoints,
    referenceLocal,
    transform,
    deformation,
    world,
    referenceIndex,
    referenceTime: sequence.times[referenceIndex] ?? 0,
    rigidResidualRms,
    perDroneMeanDeformation: Array.from(perDroneSum, (v) => (frames ? v / frames : 0)),
    maxLocalRadius,
  };
}

/** Extracted per-point deformation tracks (LOCAL metres) for the proposal. */
export function deformationTracks(
  decomposition: SegmentDecomposition,
  pointIdOf: (index: number) => string,
): ExtractedDeformationTrack[] {
  const { droneCount, sampleCount, deformation } = decomposition;
  const out: ExtractedDeformationTrack[] = [];
  for (let i = 0; i < droneCount; i++) {
    const offsets: [number, number, number][] = [];
    let sum = 0;
    let max = 0;
    for (let k = 0; k < sampleCount; k++) {
      const o = k * droneCount * 3 + i * 3;
      const v: [number, number, number] = [deformation[o]!, deformation[o + 1]!, deformation[o + 2]!];
      offsets.push(v);
      const m = Math.hypot(v[0], v[1], v[2]);
      sum += m;
      if (m > max) max = m;
    }
    out.push({
      pointId: pointIdOf(i),
      sourceDroneId: decomposition.droneIds[i] ?? `SRC-${i + 1}`,
      offsets,
      meanMagnitude: sampleCount ? sum / sampleCount : 0,
      maxMagnitude: max,
    });
  }
  return out;
}
