/**
 * Deterministic playback evaluation of an imported reference show.
 *
 * Positions: linear interpolation between raw 8 Hz samples. At an exact sample
 * timestamp the result equals the decoded sample (within float tolerance).
 * Colours: SAMPLE-AND-HOLD on the independent 12 Hz clock, so displayed RGB is
 * always an original byte triplet.
 *
 * Nothing here mutates the imported tracks.
 */
import { esspToStudio, DEFAULT_ESSP_AXIS_MAPPING, type EsspAxisMapping } from "./coordinates";
import type { ReferenceDrone, ReferenceShow } from "./types";

export interface ReferenceSample {
  /** Studio metres. */
  position: [number, number, number];
  /** Raw ESSP triplet at the interpolated time (unscaled, unmapped). */
  raw: [number, number, number];
  color: [number, number, number];
  positionSampleIndex: number;
  rgbSampleIndex: number;
}

function clampIndex(i: number, count: number): number {
  if (!Number.isFinite(i) || i < 0) return 0;
  return Math.min(count - 1, Math.floor(i));
}

/** Raw (unscaled) interpolated ESSP triplet at time t. */
export function rawPositionAt(
  drone: ReferenceDrone,
  t: number,
  rateHz: number,
): [number, number, number] {
  const count = drone.positionSampleCount;
  if (count === 0) return [0, 0, 0];
  const exact = t * rateHz;
  const i0 = clampIndex(exact, count);
  const i1 = Math.min(count - 1, i0 + 1);
  const frac = i1 === i0 ? 0 : Math.min(1, Math.max(0, exact - i0));
  const s = drone.positionSamples;
  const a = i0 * 3;
  const b = i1 * 3;
  return [
    s[a]! + (s[b]! - s[a]!) * frac,
    s[a + 1]! + (s[b + 1]! - s[a + 1]!) * frac,
    s[a + 2]! + (s[b + 2]! - s[a + 2]!) * frac,
  ];
}

export function colorAt(drone: ReferenceDrone, t: number, rateHz: number): [number, number, number] {
  const count = drone.rgbSampleCount;
  if (count === 0) return [0, 0, 0];
  const i = clampIndex(t * rateHz, count) * 3;
  return [drone.rgbSamples[i]!, drone.rgbSamples[i + 1]!, drone.rgbSamples[i + 2]!];
}

export function sampleReferenceDrone(
  drone: ReferenceDrone,
  t: number,
  timing: { positionRateHz: number; rgbRateHz: number },
  mapping: EsspAxisMapping = DEFAULT_ESSP_AXIS_MAPPING,
): ReferenceSample {
  const raw = rawPositionAt(drone, t, timing.positionRateHz);
  return {
    raw,
    position: esspToStudio(raw, mapping),
    color: colorAt(drone, t, timing.rgbRateHz),
    positionSampleIndex: clampIndex(t * timing.positionRateHz, drone.positionSampleCount),
    rgbSampleIndex: clampIndex(t * timing.rgbRateHz, drone.rgbSampleCount),
  };
}

export function sampleReferenceShow(
  show: ReferenceShow,
  t: number,
  mapping: EsspAxisMapping = DEFAULT_ESSP_AXIS_MAPPING,
): ReferenceSample[] {
  return show.drones.map((d) => sampleReferenceDrone(d, t, show.timing, mapping));
}

/** Decimated studio-space path of one drone, for trajectory visualization. */
export function referencePathPoints(
  drone: ReferenceDrone,
  mapping: EsspAxisMapping = DEFAULT_ESSP_AXIS_MAPPING,
  maxPoints = 600,
): [number, number, number][] {
  const count = drone.positionSampleCount;
  if (count === 0) return [];
  const stride = Math.max(1, Math.ceil(count / maxPoints));
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i += stride) {
    const a = i * 3;
    out.push(
      esspToStudio(
        [drone.positionSamples[a]!, drone.positionSamples[a + 1]!, drone.positionSamples[a + 2]!],
        mapping,
      ),
    );
  }
  return out;
}
