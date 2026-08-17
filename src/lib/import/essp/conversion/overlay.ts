/**
 * Diagnostic comparison data for the viewport (ORIGINAL / RECONSTRUCTED /
 * OVERLAY / ERROR VECTORS / HEATMAP).
 *
 * Pure and read-only: neither dataset is altered, and reconstruction always
 * goes through the native sampler.
 */
import { sampleDynamicFormation } from "../../../show/dynamic/sampler";
import type { DynamicFormationConversionProposal } from "./types";

export type ComparisonMode = "ORIGINAL" | "RECONSTRUCTED" | "OVERLAY" | "ERROR_VECTORS";

export interface ComparisonFrame {
  /** Segment-local time of the nearest source sample. */
  readonly time: number;
  readonly frameIndex: number;
  readonly original: readonly (readonly [number, number, number])[];
  readonly reconstructed: readonly (readonly [number, number, number])[];
  /** Per-drone Euclidean error in metres (heatmap source). */
  readonly errors: readonly number[];
  readonly maxError: number;
  readonly rmsError: number;
}

/** Nearest source sample index for a segment-local time. */
export function nearestSourceFrame(
  proposal: DynamicFormationConversionProposal,
  localTime: number,
): number {
  const times = proposal.sourceTimes;
  if (times.length === 0) return 0;
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i]! - localTime);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  }
  return best;
}

/**
 * Original and reconstructed clouds at the SAME source timestamp.
 * `sourceWorld` is the immutable flat [frame][drone][xyz] world buffer the
 * proposal was measured against.
 */
export function comparisonFrameAt(
  proposal: DynamicFormationConversionProposal,
  sourceWorld: Float64Array,
  localTime: number,
): ComparisonFrame {
  const n = proposal.droneCount;
  const frameIndex = nearestSourceFrame(proposal, localTime);
  const time = proposal.sourceTimes[frameIndex] ?? 0;
  const reconstructed = sampleDynamicFormation(proposal.formation, time);
  const original: [number, number, number][] = [];
  const errors: number[] = [];
  let maxError = 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const o = frameIndex * n * 3 + i * 3;
    const p: [number, number, number] = [sourceWorld[o]!, sourceWorld[o + 1]!, sourceWorld[o + 2]!];
    original.push(p);
    const r = reconstructed[i] ?? [0, 0, 0];
    const e = Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2]);
    errors.push(e);
    sq += e * e;
    if (e > maxError) maxError = e;
  }
  return {
    time,
    frameIndex,
    original,
    reconstructed,
    errors,
    maxError,
    rmsError: n ? Math.sqrt(sq / n) : 0,
  };
}
