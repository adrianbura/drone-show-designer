/**
 * Pure fidelity evaluator.
 *
 * The reconstruction ALWAYS goes through the public native sampler
 * (`sampleDynamicFormation`). No cached copy of the source samples is ever used
 * as the "reconstruction", so the measured error is genuinely
 *   source ESSP -> converted DynamicFormation -> sampler -> compare.
 */
import { sampleDynamicFormation } from "../../../show/dynamic/sampler";
import type { DynamicFormation } from "../../../show/dynamic/types";
import { rigidFitCentered } from "../forensics/rigid";
import {
  fidelityStatusFor,
  REFERENCE_DYNAMIC_CONVERTER_VERSION,
  type DynamicFormationFidelityReport,
} from "./types";

/** Immutable source view: the ESSP segment sampled in studio world metres. */
export interface FidelitySource {
  readonly segmentId: string;
  readonly droneIds: readonly string[];
  readonly droneCount: number;
  readonly sampleCount: number;
  /** Segment-local sample times (0 = segment start). */
  readonly times: readonly number[];
  /** Flat world positions [frame][drone][xyz]. */
  readonly positions: Float64Array;
  readonly duration: number;
  /** Optional per-frame rigid-fit residual RMS from the decomposition. */
  readonly rigidResidualRms?: readonly number[];
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function evaluateDynamicFormationFidelity(
  source: FidelitySource,
  formation: DynamicFormation,
): DynamicFormationFidelityReport {
  const n = source.droneCount;
  const frames = source.sampleCount;
  const errors: number[] = [];
  const perDroneSq = new Float64Array(n);
  const perFrameRms: number[] = [];
  let sumSq = 0;
  let sum = 0;
  let maxError = 0;
  let maxDrone = 0;
  let maxFrame = 0;
  let translationSq = 0;
  let deformationSq = 0;

  const recon = new Float64Array(n * 3);
  const srcCentred = new Float64Array(n * 3);
  const reconCentred = new Float64Array(n * 3);

  for (let k = 0; k < frames; k++) {
    const sampled = sampleDynamicFormation(formation, source.times[k]!);
    let frameSq = 0;
    let rcx = 0,
      rcy = 0,
      rcz = 0,
      scx = 0,
      scy = 0,
      scz = 0;
    for (let i = 0; i < n; i++) {
      const p = sampled[i] ?? [0, 0, 0];
      recon[i * 3] = p[0];
      recon[i * 3 + 1] = p[1];
      recon[i * 3 + 2] = p[2];
      const o = k * n * 3 + i * 3;
      const e = Math.hypot(
        p[0] - source.positions[o]!,
        p[1] - source.positions[o + 1]!,
        p[2] - source.positions[o + 2]!,
      );
      errors.push(e);
      sum += e;
      const sq = e * e;
      sumSq += sq;
      frameSq += sq;
      perDroneSq[i]! += sq;
      if (e > maxError) {
        maxError = e;
        maxDrone = i;
        maxFrame = k;
      }
      rcx += p[0];
      rcy += p[1];
      rcz += p[2];
      scx += source.positions[o]!;
      scy += source.positions[o + 1]!;
      scz += source.positions[o + 2]!;
    }
    perFrameRms.push(n ? Math.sqrt(frameSq / n) : 0);
    const k1 = Math.max(1, n);
    const dcx = rcx / k1 - scx / k1;
    const dcy = rcy / k1 - scy / k1;
    const dcz = rcz / k1 - scz / k1;
    translationSq += dcx * dcx + dcy * dcy + dcz * dcz;

    // Internal error = what is left after the centroid AND the best-fit
    // rotation between reconstruction and source are removed.
    for (let i = 0; i < n; i++) {
      const o = k * n * 3 + i * 3;
      srcCentred[i * 3] = source.positions[o]! - scx / k1;
      srcCentred[i * 3 + 1] = source.positions[o + 1]! - scy / k1;
      srcCentred[i * 3 + 2] = source.positions[o + 2]! - scz / k1;
      reconCentred[i * 3] = recon[i * 3]! - rcx / k1;
      reconCentred[i * 3 + 1] = recon[i * 3 + 1]! - rcy / k1;
      reconCentred[i * 3 + 2] = recon[i * 3 + 2]! - rcz / k1;
    }
    const fit = n > 0 ? rigidFitCentered(reconCentred, srcCentred) : null;
    deformationSq += fit ? fit.rmsError * fit.rmsError : 0;
  }

  const total = errors.length;
  const sorted = [...errors].sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2
        ? sorted[sorted.length >> 1]!
        : (sorted[(sorted.length >> 1) - 1]! + sorted[sorted.length >> 1]!) / 2;
  const rms = total ? Math.sqrt(sumSq / total) : 0;
  const rigid = source.rigidResidualRms ?? [];
  const rotationResidual = rigid.length
    ? Math.sqrt(rigid.reduce((s, v) => s + v * v, 0) / rigid.length)
    : 0;

  return {
    sourceSegmentId: source.segmentId,
    sourceSegmentDuration: source.duration,
    droneCount: n,
    sourceSampleCount: frames,
    totalComparedPositions: total,
    meanErrorMeters: total ? sum / total : 0,
    medianErrorMeters: median,
    rmsErrorMeters: rms,
    p95ErrorMeters: percentile(sorted, 95),
    p99ErrorMeters: percentile(sorted, 99),
    maxErrorMeters: maxError,
    maxErrorDroneId: source.droneIds[maxDrone] ?? "",
    maxErrorTime: source.times[maxFrame] ?? 0,
    perDroneRmsError: Array.from(perDroneSq, (v) => (frames ? Math.sqrt(v / frames) : 0)),
    perFrameRmsError: perFrameRms,
    globalTranslationErrorRms: frames ? Math.sqrt(translationSq / frames) : 0,
    globalRotationResidualRms: rotationResidual,
    internalDeformationErrorRms: frames ? Math.sqrt(deformationSq / frames) : 0,
    status: fidelityStatusFor(rms),
    algorithmVersion: REFERENCE_DYNAMIC_CONVERTER_VERSION,
  };
}
