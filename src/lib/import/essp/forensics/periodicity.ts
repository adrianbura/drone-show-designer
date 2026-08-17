/**
 * Periodicity detection on a deformation-energy series.
 *
 * 1. detrend by subtracting a centred moving average (removes slow baseline
 *    drift such as a formation morph),
 * 2. normalised autocorrelation over candidate lags,
 * 3. dominant lag = first strong local maximum.
 *
 * Deterministic, dependency-free. No biological or artistic meaning is implied.
 */
import type { PeriodicityResult } from "./types";

export function detrend(series: number[], window = 5): number[] {
  const n = series.length;
  const half = Math.max(1, Math.floor(window / 2));
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k < 0 || k >= n) continue;
      sum += series[k]!;
      count++;
    }
    out[i] = series[i]! - sum / Math.max(1, count);
  }
  return out;
}

export function autocorrelation(series: number[], maxLag: number): number[] {
  const n = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let denom = 0;
  for (const v of series) denom += (v - mean) ** 2;
  const out: number[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let num = 0;
    for (let i = 0; i + lag < n; i++) num += (series[i]! - mean) * (series[i + lag]! - mean);
    out.push(denom > 1e-18 ? num / denom : 0);
  }
  return out;
}

/**
 * @param series deformation energy per analysis window
 * @param stepSeconds seconds between consecutive series entries (window stride)
 */
export function detectPeriodicity(
  series: number[],
  stepSeconds: number,
  minConfidence: number,
): PeriodicityResult {
  if (series.length < 8 || stepSeconds <= 0) {
    return { periodic: false, estimatedPeriodSeconds: null, confidence: 0 };
  }
  const d = detrend(series, Math.max(3, Math.round(series.length / 6) | 1));
  const maxLag = Math.floor(series.length / 2);
  const ac = autocorrelation(d, maxLag);
  let bestLag = 0;
  let bestValue = 0;
  for (let lag = 2; lag < maxLag; lag++) {
    const v = ac[lag]!;
    if (v > bestValue && v >= ac[lag - 1]! && v >= ac[lag + 1]!) {
      bestValue = v;
      bestLag = lag;
    }
  }
  const confidence = Math.max(0, Math.min(1, bestValue));
  if (bestLag === 0 || confidence < minConfidence) {
    return { periodic: false, estimatedPeriodSeconds: null, confidence };
  }
  return { periodic: true, estimatedPeriodSeconds: bestLag * stepSeconds, confidence };
}
