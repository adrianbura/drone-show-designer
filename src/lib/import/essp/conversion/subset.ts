/**
 * DRONE-SUBSET BOUNDARY for the existing reference converter.
 *
 * The conversion maths (decomposition, rigid fit, fidelity) is NOT duplicated
 * here. This module only produces a narrowed VIEW of an immutable
 * `PointCloudSequence` so the very same converter can be applied to one
 * coherent drone subset of a scene instead of the whole fleet.
 *
 * Pure module: the source sequence is only read.
 */
import type { PointCloudSequence } from "../forensics/types";

/**
 * A sequence containing only `indices`, in the given order. Sample times and
 * rate are preserved exactly; positions are copied verbatim (no resampling).
 */
export function subsetPointCloudSequence(
  sequence: PointCloudSequence,
  indices: readonly number[],
): PointCloudSequence {
  const n = indices.length;
  const frames = sequence.sampleCount;
  const positions = new Float64Array(frames * n * 3);
  for (let s = 0; s < frames; s++) {
    for (let k = 0; k < n; k++) {
      const src = (s * sequence.droneCount + indices[k]!) * 3;
      const dst = (s * n + k) * 3;
      positions[dst] = sequence.positions[src]!;
      positions[dst + 1] = sequence.positions[src + 1]!;
      positions[dst + 2] = sequence.positions[src + 2]!;
    }
  }
  return {
    droneIds: indices.map((i) => sequence.droneIds[i] ?? `SRC-${i + 1}`),
    droneCount: n,
    sampleCount: frames,
    rateHz: sequence.rateHz,
    times: sequence.times,
    positions,
  };
}

/** Indices of the given source drone ids, in sequence order. Unknown ids are dropped. */
export function subsetIndicesForDroneIds(
  sequence: PointCloudSequence,
  droneIds: readonly string[],
): number[] {
  const wanted = new Set(droneIds);
  const out: number[] = [];
  sequence.droneIds.forEach((id, i) => {
    if (wanted.has(id)) out.push(i);
  });
  return out;
}
