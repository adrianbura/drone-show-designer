/**
 * Read-only RGB structure evidence for one reference interval:
 *  A. simultaneous exact-color groups (support + ambiguity),
 *  B. temporal behaviour (static/animated field, pulsation, wave) — only with
 *     held-out validation,
 *  C. exact-source reference and reconstruction-vs-source error of simple
 *     candidate models, with UNKNOWN fallback.
 * Never infers an effect recipe and never writes source samples.
 */
import { rawPositionAt } from "../playback";
import type { ReferenceDrone, ReferenceShow } from "../types";
import type { ReferenceClipBinding } from "./types";

/** Long intervals are not scanned temporally (bounded UI runtime). */
export const RGB_STRUCTURE_MAX_TICKS = 1200;
const MAX_LAG = 60;
const MIN_GROUP = 3;

function frameRange(show: ReferenceShow, start: number, end: number): [number, number] {
  const rate = show.timing.rgbRateHz;
  const max = show.drones.reduce((n, d) => Math.max(n, d.rgbSampleCount), 0);
  if (!Number.isFinite(rate) || rate <= 0 || !(end >= start)) return [0, 0];
  const a = Math.min(max, Math.max(0, Math.ceil(start * rate)));
  const b = Math.min(max, Math.max(a, Math.ceil(end * rate)));
  return [a, b];
}
const keyAt = (d: ReferenceDrone, i: number) =>
  i < d.rgbSampleCount
    ? ((d.rgbSamples[i * 3]! << 16) | (d.rgbSamples[i * 3 + 1]! << 8) | d.rgbSamples[i * 3 + 2]!)
    : -1;
const lumAt = (d: ReferenceDrone, i: number) =>
  (d.rgbSamples[i * 3]! + d.rgbSamples[i * 3 + 1]! + d.rgbSamples[i * 3 + 2]!) / 3;

function corr(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let ma = 0,
    mb = 0;
  for (let i = 0; i < n; i++) (ma += a[i]!), (mb += b[i]!);
  ma /= n;
  mb /= n;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma,
      y = b[i]! - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return saa > 1e-9 && sbb > 1e-9 ? sab / Math.sqrt(saa * sbb) : null;
}
const lagCorr = (s: number[], lag: number) => corr(s.slice(0, s.length - lag), s.slice(lag));
const std = (s: number[]) => {
  const m = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (s.length || 1));
};

/** Best periodic lag on `train`; null when no clear periodicity. */
function period(train: number[]): { lag: number; r: number } | null {
  let best: { lag: number; r: number } | null = null;
  const maxLag = Math.min(MAX_LAG, Math.floor(train.length / 3));
  let dipped = false;
  for (let lag = 2; lag <= maxLag; lag++) {
    const r = lagCorr(train, lag);
    if (r === null) continue;
    if (r < 0.3) dipped = true; // must leave the zero-lag lobe first
    if (dipped && r >= 0.8 && (!best || r > best.r + 1e-9)) best = { lag, r };
  }
  return best;
}

/** Linear least squares y = a + b·x (multi-x via normal equations, 3 axes). */
function fitLinear(xs: number[][], ys: number[]) {
  const n = ys.length,
    k = 4;
  const A = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (let i = 0; i < n; i++) {
    const row = [1, ...xs[i]!];
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) A[r]![c]! += row[r]! * row[c]!;
      A[r]![k]! += row[r]! * ys[i]!;
    }
  }
  for (let r = 0; r < k; r++) A[r]![r]! += 1e-6;
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const piv = A[c]![c]!;
    if (Math.abs(piv) < 1e-12) return null;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / piv;
      for (let j = c; j <= k; j++) A[r]![j]! -= f * A[c]![j]!;
    }
  }
  const coef = A.map((row, i) => row[k]! / row[i]!);
  return (x: number[]) => coef[0]! + coef[1]! * x[0]! + coef[2]! * x[1]! + coef[3]! * x[2]!;
}
const r2 = (pred: number[], ys: number[]) => {
  const m = ys.reduce((a, b) => a + b, 0) / (ys.length || 1);
  const tot = ys.reduce((a, b) => a + (b - m) ** 2, 0);
  const res = ys.reduce((a, y, i) => a + (y - pred[i]!) ** 2, 0);
  return tot > 1e-9 ? 1 - res / tot : null;
};

export function analyzeRgbGroups(show: ReferenceShow, binding: ReferenceClipBinding) {
  const [a, b] = frameRange(show, binding.referenceStart, binding.referenceEnd);
  const drones = show.drones.filter((d) => d.rgbSampleCount >= b && b > a);
  if (!drones.length || b <= a)
    return { status: "NO_RGB" as const, groups: [], ticks: 0, ambiguousFraction: null, meanSimultaneousSupported: null };
  // Exact full-interval signatures: drones in one group share every RGB tick.
  const bySig = new Map<string, number[]>();
  for (const d of drones) {
    let h = "";
    for (let i = a; i < b; i++) h += keyAt(d, i).toString(36) + ",";
    const list = bySig.get(h) ?? [];
    list.push(d.numericSourceId);
    bySig.set(h, list);
  }
  const groups = [...bySig.values()]
    .filter((ids) => ids.length >= MIN_GROUP)
    .map((ids) => ids.sort((x, y) => x - y))
    .sort((x, y) => y.length - x.length || x[0]! - y[0]!)
    .map((ids, i) => ({ id: `G${i + 1}`, support: ids.length, supportFraction: ids.length / drones.length, droneIds: ids }));
  const grouped = groups.reduce((n, g) => n + g.support, 0);
  let simult = 0;
  for (let i = a; i < b; i++) {
    const counts = new Map<number, number>();
    for (const d of drones) counts.set(keyAt(d, i), (counts.get(keyAt(d, i)) ?? 0) + 1);
    simult += [...counts.values()].filter((c) => c >= MIN_GROUP).length;
  }
  const ambiguousFraction = 1 - grouped / drones.length;
  return {
    status:
      groups.length === 0 || ambiguousFraction > 0.5
        ? ("AMBIGUOUS" as const)
        : groups.length === 1
          ? ("SINGLE_GROUP" as const)
          : ("MULTIPLE_GROUPS" as const),
    groups,
    ticks: b - a,
    ambiguousFraction,
    meanSimultaneousSupported: simult / (b - a),
  };
}

export function analyzeRgbTemporal(show: ReferenceShow, binding: ReferenceClipBinding) {
  const [a, b] = frameRange(show, binding.referenceStart, binding.referenceEnd);
  const rate = show.timing.rgbRateHz;
  const drones = show.drones.filter((d) => d.rgbSampleCount >= b && b > a);
  const base = { periodSeconds: null as number | null, trainCorrelation: null as number | null, heldOutCorrelation: null as number | null, phaseCoherence: null as number | null, waveHeldOutR2: null as number | null };
  if (!drones.length || b <= a) return { status: "NO_RGB" as const, ...base };
  if (b - a > RGB_STRUCTURE_MAX_TICKS) return { status: "TOO_LONG" as const, ...base };
  let constant = true;
  for (const d of drones) for (let i = a + 1; i < b && constant; i++) if (keyAt(d, i) !== keyAt(d, a)) constant = false;
  if (constant) return { status: "STATIC" as const, ...base };
  const series = drones.map((d) => Array.from({ length: b - a }, (_, i) => lumAt(d, a + i)));
  const fleet = series[0]!.map((_, i) => series.reduce((s, x) => s + x[i]!, 0) / series.length);
  const half = Math.floor(fleet.length / 2);
  // Train on the first half, validate on the held-out second half.
  const trainPer = period(fleet.slice(0, half));
  const tooShort = !trainPer || half < 3 * trainPer.lag;
  // Per-drone periodicity (wave candidates when fleet mean cancels out).
  const droneTrain = trainPer ?? period(series[0]!.slice(0, half));
  if (!droneTrain || half < 3 * droneTrain.lag) return { status: "NONPERIODIC_OR_UNKNOWN" as const, ...base };
  const lag = droneTrain.lag;
  const held = trainPer && !tooShort ? lagCorr(fleet.slice(half), lag) : null;
  const phase = series.map((s) => corr(s, fleet)).filter((v): v is number => v !== null);
  const phaseCoherence = phase.length ? phase.sort((x, y) => x - y)[Math.floor(phase.length / 2)]! : null;
  const out = { ...base, periodSeconds: lag / rate, trainCorrelation: droneTrain.r, heldOutCorrelation: held };
  if (held !== null && held >= 0.7 && std(fleet) >= 8 && (phaseCoherence ?? 0) >= 0.9)
    return { status: "PULSATION_SUPPORTED" as const, ...out, phaseCoherence };
  // Wave: per-drone phase lag vs position, fit on even drones, validated on odd.
  const ref = series[0]!;
  const mid = (a + (b - a) / 2) / rate;
  const pts: { x: number[]; lag: number }[] = [];
  for (let k = 0; k < series.length; k++) {
    let best = -2,
      bl = 0;
    for (let l = 0; l < lag; l++) {
      const r = corr(ref.slice(0, ref.length - l), series[k]!.slice(l)) ?? -2;
      if (r > best) (best = r), (bl = l);
    }
    if (best < 0.8) continue;
    const p = rawPositionAt(drones[k]!, mid, show.timing.positionRateHz);
    // Unwrap: choose lag representation nearest to a smooth field is not
    // attempted; a wrapped phase simply fails validation (conservative).
    pts.push({ x: p.map((v) => v / 100), lag: bl });
  }
  const train = pts.filter((_, i) => i % 2 === 0),
    test = pts.filter((_, i) => i % 2 === 1);
  if (train.length >= 12 && test.length >= 12) {
    const f = fitLinear(train.map((p) => p.x), train.map((p) => p.lag));
    const v = f ? r2(test.map((p) => f(p.x)), test.map((p) => p.lag)) : null;
    if (v !== null && v >= 0.8 && (phaseCoherence ?? 1) < 0.9)
      return { status: "WAVE_SUPPORTED" as const, ...out, phaseCoherence, waveHeldOutR2: v };
    return { status: "PERIODIC_UNVALIDATED" as const, ...out, phaseCoherence, waveHeldOutR2: v };
  }
  return { status: "PERIODIC_UNVALIDATED" as const, ...out, phaseCoherence };
}

/** Error of a candidate model against the exact source, on the RGB clock. */
export function evaluateRgbReconstruction(show: ReferenceShow, binding: ReferenceClipBinding, tolerance = 2) {
  const [a, b] = frameRange(show, binding.referenceStart, binding.referenceEnd);
  const drones = show.drones.filter((d) => d.rgbSampleCount >= b && b > a);
  if (!drones.length || b <= a)
    return { status: "NO_RGB" as const, reference: "EXACT_SOURCE" as const, tolerance, models: [], best: "UNKNOWN" as const };
  const ch = (d: ReferenceDrone, i: number, c: number) => d.rgbSamples[i * 3 + c]!;
  const score = (predict: (k: number, i: number, c: number) => number) => {
    let sum = 0,
      max = 0,
      n = 0;
    for (let k = 0; k < drones.length; k++)
      for (let i = a; i < b; i++)
        for (let c = 0; c < 3; c++) {
          const e = Math.abs(Math.round(predict(k, i, c)) - ch(drones[k]!, i, c));
          sum += e;
          max = Math.max(max, e);
          n++;
        }
    return { meanAbsError: sum / n, maxAbsError: max };
  };
  const tickMean = Array.from({ length: b - a }, (_, i) =>
    [0, 1, 2].map((c) => drones.reduce((s, d) => s + ch(d, a + i, c), 0) / drones.length),
  );
  const droneMean = drones.map((d) =>
    [0, 1, 2].map((c) => {
      let s = 0;
      for (let i = a; i < b; i++) s += ch(d, i, c);
      return s / (b - a);
    }),
  );
  const groups = analyzeRgbGroups(show, binding);
  const groupOf = new Map<number, number>();
  groups.groups.forEach((g, gi) => g.droneIds.forEach((id) => groupOf.set(id, gi)));
  const leaders = groups.groups.map((g) => drones.find((d) => d.numericSourceId === g.droneIds[0])!);
  const models = [
    { model: "FLEET_COLOR_PER_TICK" as const, ...score((_k, i, c) => tickMean[i - a]![c]!) },
    { model: "STATIC_COLOR_PER_DRONE" as const, ...score((k, _i, c) => droneMean[k]![c]!) },
    {
      model: "EXACT_GROUPS_PLUS_UNGROUPED_UNKNOWN" as const,
      ...score((k, i, c) => {
        const g = groupOf.get(drones[k]!.numericSourceId);
        return g === undefined ? tickMean[i - a]![c]! : ch(leaders[g]!, i, c);
      }),
    },
  ].map((m) => ({ ...m, withinTolerance: m.maxAbsError <= tolerance }));
  const ok = models.filter((m) => m.withinTolerance);
  return {
    status: "EVALUATED" as const,
    // Playback always uses the exact original samples; models are evidence only.
    reference: "EXACT_SOURCE" as const,
    tolerance,
    models,
    best: ok.length ? ok[0]!.model : ("UNKNOWN" as const),
  };
}

export function analyzeRgbStructure(show: ReferenceShow, binding: ReferenceClipBinding) {
  return {
    groups: analyzeRgbGroups(show, binding),
    temporal: analyzeRgbTemporal(show, binding),
    reconstruction: evaluateRgbReconstruction(show, binding),
    recipe: "UNKNOWN" as const,
  };
}
