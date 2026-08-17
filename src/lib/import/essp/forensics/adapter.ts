/**
 * ESSP reference show -> analysis sequence adapter.
 *
 * Converts the immutable raw int16 samples into a studio-metre point cloud
 * sequence. The source show is only read; nothing is written back.
 */
import { esspToStudio, DEFAULT_ESSP_AXIS_MAPPING, type EsspAxisMapping } from "../coordinates";
import type { ReferenceShow } from "../types";
import type { LightingSource } from "./metrics";
import type { PointCloudSequence } from "./types";

export function sequenceFromReferenceShow(
  show: ReferenceShow,
  mapping: EsspAxisMapping = DEFAULT_ESSP_AXIS_MAPPING,
): PointCloudSequence {
  const droneIds = show.drones.map((d) => d.sourceId);
  const droneCount = droneIds.length;
  const sampleCount = show.drones.reduce(
    (min, d) => Math.min(min, d.positionSampleCount),
    Number.POSITIVE_INFINITY,
  );
  const count = Number.isFinite(sampleCount) ? sampleCount : 0;
  const rateHz = show.timing.positionRateHz;
  const times = new Float64Array(count);
  const positions = new Float64Array(count * droneCount * 3);
  for (let s = 0; s < count; s++) {
    times[s] = s / rateHz;
    for (let i = 0; i < droneCount; i++) {
      const src = show.drones[i]!.positionSamples;
      const j = s * 3;
      const p = esspToStudio([src[j]!, src[j + 1]!, src[j + 2]!], mapping);
      const o = (s * droneCount + i) * 3;
      positions[o] = p[0];
      positions[o + 1] = p[1];
      positions[o + 2] = p[2];
    }
  }
  return { droneIds, droneCount, sampleCount: count, rateHz, times, positions };
}

export function lightingSourceFromReferenceShow(show: ReferenceShow): LightingSource {
  return {
    rgb: show.drones.map((d) => d.rgbSamples),
    sampleCount: show.drones.reduce((min, d) => Math.min(min, d.rgbSampleCount), Infinity) || 0,
    rateHz: show.timing.rgbRateHz,
  };
}

/** Deterministic FNV-1a provenance hash of the analysed reference show. */
export function referenceShowHash(show: ReferenceShow): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xff;
    h = (h * 0x01000193) >>> 0;
  };
  for (const d of show.drones) {
    for (const ch of d.sourceId) mix(ch.charCodeAt(0));
    mix(d.fileSize);
    mix(d.positionSampleCount);
    const s = d.positionSamples;
    const stride = Math.max(1, Math.floor(s.length / 512));
    for (let i = 0; i < s.length; i += stride) mix(s[i]!);
  }
  return h.toString(16).padStart(8, "0");
}

/** Point-cloud sequence from explicit frames (test fixtures, synthetic data). */
export function sequenceFromFrames(
  frames: readonly (readonly [number, number, number])[][],
  rateHz: number,
  droneIds?: string[],
): PointCloudSequence {
  const sampleCount = frames.length;
  const droneCount = frames[0]?.length ?? 0;
  const ids = droneIds ?? Array.from({ length: droneCount }, (_, i) => `PT-${i + 1}`);
  const times = new Float64Array(sampleCount);
  const positions = new Float64Array(sampleCount * droneCount * 3);
  for (let s = 0; s < sampleCount; s++) {
    times[s] = s / rateHz;
    for (let i = 0; i < droneCount; i++) {
      const p = frames[s]![i]!;
      const o = (s * droneCount + i) * 3;
      positions[o] = p[0];
      positions[o + 1] = p[1];
      positions[o + 2] = p[2];
    }
  }
  return { droneIds: ids, droneCount, sampleCount, rateHz, times, positions };
}
