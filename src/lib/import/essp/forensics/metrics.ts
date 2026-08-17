/**
 * Per-drone motion metrics and lighting forensics.
 * All read-only; RGB bytes are never modified.
 */
import { centeredCloud, cloudAt } from "./centroid";
import { rigidFitCentered, robustRigidFit } from "./rigid";
import type {
  LightingStatistics,
  LightingWindowSample,
  PerDroneMotionMetric,
  PointCloudSequence,
} from "./types";

export interface IntervalResiduals {
  /** Mean residual per drone over the interval (m). */
  mean: number[];
  /** Max residual per drone over the interval (m). */
  max: number[];
  /** Robust rigid-fit RMS per analysed sample. */
  rmsSeries: number[];
  /** Rotation angle (deg) per analysed sample, relative to interval start. */
  rotationSeries: number[];
  /**
   * SIGNED deformation series: projection of the residual field onto the
   * strongest residual field of the interval. Unlike the (always positive) RMS
   * series this preserves the sign of an oscillation, so a full flap cycle maps
   * to a full period instead of a rectified half period.
   */
  projectionSeries: number[];
  /** Seconds between consecutive analysed samples. */
  stepSeconds: number;
}

/**
 * Residual analysis over [startSample, endSample] against a STABLE REFERENCE
 * SNAPSHOT (the interval's first sample), using the robust rigid fit.
 */
export function intervalResiduals(
  seq: PointCloudSequence,
  startSample: number,
  endSample: number,
  stride = 1,
): IntervalResiduals {
  const n = seq.droneCount;
  const step = Math.max(1, stride);
  const mean = new Array<number>(n).fill(0);
  const max = new Array<number>(n).fill(0);
  const rmsSeries: number[] = [];
  const rotationSeries: number[] = [];
  const vectorFields: Float64Array[] = [];
  const pRef = cloudAt(seq, startSample);
  let count = 0;
  let strongest = 0;
  let strongestRms = -1;
  for (let s = startSample; s <= endSample; s += step) {
    const fit = robustRigidFit(pRef, cloudAt(seq, s));
    rmsSeries.push(fit.rmsError);
    rotationSeries.push(fit.angleDeg);
    vectorFields.push(fit.residualVectors);
    if (fit.rmsError > strongestRms) {
      strongestRms = fit.rmsError;
      strongest = vectorFields.length - 1;
    }
    for (let i = 0; i < n; i++) {
      const v = fit.residuals[i]!;
      mean[i] = mean[i]! + v;
      if (v > max[i]!) max[i] = v;
    }
    count++;
  }
  if (count > 0) for (let i = 0; i < n; i++) mean[i] = mean[i]! / count;
  const ref = vectorFields[strongest];
  let refNorm = 0;
  if (ref) for (const v of ref) refNorm += v * v;
  refNorm = Math.sqrt(refNorm) || 1;
  const projectionSeries = vectorFields.map((field) => {
    if (!ref) return 0;
    let dot = 0;
    for (let i = 0; i < field.length; i++) dot += field[i]! * ref[i]!;
    return dot / refNorm;
  });
  return {
    mean,
    max,
    rmsSeries,
    rotationSeries,
    projectionSeries,
    stepSeconds: step / seq.rateHz,
  };
}

/** Net shape change between interval endpoints (rigid-fit residual RMS). */
export function netShapeChange(
  seq: PointCloudSequence,
  startSample: number,
  endSample: number,
): number {
  const a = centeredCloud(seq, startSample);
  const b = centeredCloud(seq, endSample);
  return rigidFitCentered(a, b).rmsError;
}

export function perDroneMetrics(
  seq: PointCloudSequence,
  startSample: number,
  endSample: number,
  stride = 1,
): PerDroneMotionMetric[] {
  const n = seq.droneCount;
  const dt = 1 / seq.rateHz;
  const distance = new Array<number>(n).fill(0);
  const velSq = new Array<number>(n).fill(0);
  let steps = 0;
  for (let s = startSample + 1; s <= endSample; s++) {
    const prev = (s - 1) * n * 3;
    const cur = s * n * 3;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(
        seq.positions[cur + i * 3]! - seq.positions[prev + i * 3]!,
        seq.positions[cur + i * 3 + 1]! - seq.positions[prev + i * 3 + 1]!,
        seq.positions[cur + i * 3 + 2]! - seq.positions[prev + i * 3 + 2]!,
      );
      distance[i] = distance[i]! + d;
      velSq[i] = velSq[i]! + (d / dt) ** 2;
    }
    steps++;
  }
  const res = intervalResiduals(seq, startSample, endSample, stride);
  const totalMean = res.mean.reduce((a, b) => a + b, 0) || 1;
  return seq.droneIds.map((id, i) => ({
    droneId: id,
    distanceTraveledMeters: distance[i]!,
    meanResidualMeters: res.mean[i]!,
    maxResidualMeters: res.max[i]!,
    participationScore: res.mean[i]! / totalMean,
    velocityRmsMps: steps > 0 ? Math.sqrt(velSq[i]! / steps) : 0,
  }));
}

export interface LightingSource {
  /** Per-drone flat RGB byte samples. */
  rgb: ArrayLike<number>[];
  sampleCount: number;
  rateHz: number;
}

/** Fleet-level RGB forensics on the independent colour clock. */
export function analyzeLighting(
  source: LightingSource,
  strideSeconds: number,
  sensitivity: number,
): LightingStatistics {
  const track: LightingWindowSample[] = [];
  const n = source.rgb.length;
  const step = Math.max(1, Math.round(strideSeconds * source.rateHz));
  let prevMeans: number[] | null = null;
  let brightnessSum = 0;
  let maxChange = 0;
  for (let s = 0; s < source.sampleCount; s += step) {
    const means: number[] = [];
    let dark = 0;
    for (let i = 0; i < n; i++) {
      const j = s * 3;
      const arr = source.rgb[i]!;
      const b = ((arr[j] ?? 0) + (arr[j + 1] ?? 0) + (arr[j + 2] ?? 0)) / (3 * 255);
      means.push(b);
      if (b < 0.04) dark++;
    }
    const mean = means.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const variance = means.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n);
    let changing = 0;
    let energy = 0;
    if (prevMeans) {
      for (let i = 0; i < n; i++) {
        const d = Math.abs(means[i]! - prevMeans[i]!);
        energy += d;
        if (d > 0.05) changing++;
      }
      energy /= Math.max(1, n);
    }
    brightnessSum += mean;
    if (energy > maxChange) maxChange = energy;
    track.push({
      time: s / source.rateHz,
      meanBrightness: mean,
      colorVariance: variance,
      darkFraction: n ? dark / n : 0,
      changingFraction: n ? changing / n : 0,
      changeEnergy: energy,
    });
    prevMeans = means;
  }
  const energies = track.map((t) => t.changeEnergy).sort((a, b) => a - b);
  const medianEnergy = energies.length ? energies[energies.length >> 1]! : 0;
  const limit = Math.max(1e-4, medianEnergy * sensitivity);
  return {
    sampleRateHz: source.rateHz,
    meanBrightness: track.length ? brightnessSum / track.length : 0,
    maxChangeEnergy: maxChange,
    changeEventTimes: track.filter((t) => t.changeEnergy > limit).map((t) => t.time),
    track,
  };
}
