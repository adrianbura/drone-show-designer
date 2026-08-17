/**
 * Window motion descriptors.
 *
 * Fits are ROBUST (median-inlier reweighting), so a locally deforming subset
 * cannot drag the global rigid frame.
 *
 * REFERENCE FRAME: each window is analysed against its own FIRST sample
 * ("window start" mode). Rotation and deformation are therefore relative to the
 * shape the fleet had when the window opened, which keeps the estimate local
 * and avoids drift over a 10-minute show. Segment-level metrics additionally
 * use a "stable reference snapshot" (the segment's first sample) — see
 * segmentation.ts.
 */
import { cloudAt, centroidAt, groundFractionAt } from "./centroid";
import { robustRigidFit } from "./rigid";
import type { MotionWindow, PointCloudSequence, ReferenceForensicsThresholds } from "./types";

function median(values: ArrayLike<number>): number {
  const arr = Array.from(values).sort((a, b) => a - b);
  if (arr.length === 0) return 0;
  const mid = arr.length >> 1;
  return arr.length % 2 ? arr[mid]! : (arr[mid - 1]! + arr[mid]!) / 2;
}

export type WindowResiduals = number[];

/** Builds unclassified motion descriptors over the whole sequence. */
export function buildMotionWindows(
  seq: PointCloudSequence,
  th: ReferenceForensicsThresholds,
): { windows: MotionWindow[]; residuals: number[][] } {
  const windows: MotionWindow[] = [];
  const residuals: number[][] = [];
  if (seq.sampleCount < 2 || seq.droneCount === 0) return { windows, residuals };
  const windowSamples = Math.max(1, Math.round(th.windowSeconds * seq.rateHz));
  const strideSamples = Math.max(1, Math.round(th.strideSeconds * seq.rateHz));
  let index = 0;
  for (let start = 0; start < seq.sampleCount - 1; start += strideSamples) {
    const end = Math.min(seq.sampleCount - 1, start + windowSamples);
    const cStart = centroidAt(seq, start);
    const cEnd = centroidAt(seq, end);
    const pStart = cloudAt(seq, start);
    const duration = (end - start) / seq.rateHz;

    let worstRms = -1;
    let worstResiduals: number[] = new Array<number>(seq.droneCount).fill(0);
    let energy = 0;
    for (let s = start + 1; s <= end; s++) {
      const fit = robustRigidFit(pStart, cloudAt(seq, s));
      energy = Math.max(energy, fit.rmsError);
      if (fit.rmsError > worstRms) {
        worstRms = fit.rmsError;
        worstResiduals = [...fit.residuals];
      }
    }
    const endFit = robustRigidFit(pStart, cloudAt(seq, end));
    const travel = Math.hypot(cEnd[0] - cStart[0], cEnd[1] - cStart[1], cEnd[2] - cStart[2]);
    let maxResidual = 0;
    let active = 0;
    for (const r of worstResiduals) {
      if (r > maxResidual) maxResidual = r;
      if (r > th.activeDroneResidualMeters) active++;
    }
    let altSum = 0;
    for (let s = start; s <= end; s++) altSum += centroidAt(seq, s)[1];
    windows.push({
      index,
      startTime: seq.times[start]!,
      endTime: seq.times[end]!,
      startSample: start,
      endSample: end,
      centroidStart: cStart,
      centroidEnd: cEnd,
      centroidTravel: travel,
      centroidSpeedMps: duration > 0 ? travel / duration : 0,
      meanAltitude: altSum / (end - start + 1),
      altitudeChange: cEnd[1] - cStart[1],
      verticalSpeedMps: duration > 0 ? (cEnd[1] - cStart[1]) / duration : 0,
      groundFraction: groundFractionAt(seq, start, th.groundAltitudeMeters),
      rotationDeg: endFit.angleDeg,
      rotationRateDegPerSec: duration > 0 ? endFit.angleDeg / duration : 0,
      scale: endFit.scale,
      rigidRmsMeters: endFit.rmsError,
      deformationRmsMeters: Math.max(0, worstRms),
      deformationMaxMeters: maxResidual,
      deformationMedianMeters: median(worstResiduals),
      activeFraction: seq.droneCount ? active / seq.droneCount : 0,
      deformationEnergy: energy,
      classification: "UNKNOWN",
      confidence: 0,
    });
    residuals.push(worstResiduals);
    index++;
    if (end >= seq.sampleCount - 1) break;
  }
  return { windows, residuals };
}

export { median as medianOf };
