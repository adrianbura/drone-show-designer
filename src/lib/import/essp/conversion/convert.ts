/**
 * PURE reference-segment -> DynamicFormation converter.
 *
 * `convertReferenceSegmentToDynamicFormation(referenceShow, segment, options)`
 * has no UI dependencies and never mutates its inputs. It returns a PROPOSAL:
 * the studio decides whether to apply it.
 */
import { sequenceFromReferenceShow, referenceShowHash } from "../forensics/adapter";
import type { ReferenceSceneSegment } from "../forensics/types";
import type { PointCloudSequence } from "../forensics/types";
import type { ReferenceShow } from "../types";
import {
  buildDynamicFormationFromDecomposition,
  conversionPointId,
  countKeyframes,
} from "./build";
import { decomposeSegment, deformationTracks, segmentWindow } from "./decompose";
import { evaluateDynamicFormationFidelity, type FidelitySource } from "./fidelity";
import { simplifyQuaternionTrack, simplifyVectorTrack, unionIndices } from "./simplify";
import { subsetIndicesForDroneIds, subsetPointCloudSequence } from "./subset";
import {
  REFERENCE_DYNAMIC_CONVERTER_VERSION,
  ReferenceConversionError,
  segmentEligibility,
  type ConversionOptions,
  type DynamicFormationConversionProposal,
  type LoopClosureAnalysis,
  type ResolvedConversionOptions,
  type SuggestedMotionGroup,
} from "./types";
import type { DynamicFormation } from "../../../show/dynamic/types";
import type { Quat } from "../../../show/dynamic/math";

export function resolveConversionOptions(options: ConversionOptions = {}): ResolvedConversionOptions {
  return {
    mode: options.mode ?? "EXACT_SAMPLED",
    toleranceMeters: options.toleranceMeters && options.toleranceMeters > 0 ? options.toleranceMeters : 0.05,
    referenceFrame: options.referenceFrame ?? "SEGMENT_START",
    referenceTime: options.referenceTime ?? null,
    rotationFit: options.rotationFit ?? "KABSCH",
    suggestMotionGroups: options.suggestMotionGroups ?? true,
    loopClosureToleranceMeters:
      options.loopClosureToleranceMeters && options.loopClosureToleranceMeters > 0
        ? options.loopClosureToleranceMeters
        : 0.5,
    stableCoreResidualMeters:
      options.stableCoreResidualMeters && options.stableCoreResidualMeters > 0
        ? options.stableCoreResidualMeters
        : 0.15,
  };
}

/** Deterministic FNV-1a signature of the animated content of a formation. */
export function dynamicFormationSignature(formation: DynamicFormation): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xff;
    h = (h * 0x01000193) >>> 0;
  };
  const num = (v: number) => {
    const scaled = Math.round(v * 1e6);
    mix(scaled);
    mix(scaled >>> 8);
    mix(scaled >>> 16);
  };
  num(formation.duration);
  for (const p of formation.points) p.base.forEach(num);
  formation.pivot.forEach(num);
  for (const k of formation.transform) {
    num(k.t);
    k.translation.forEach(num);
    k.rotation.forEach(num);
    k.scale.forEach(num);
  }
  for (const g of formation.groups) {
    for (const ch of g.id) mix(ch.charCodeAt(0));
    mix(g.enabled ? 1 : 0);
    for (const k of g.keyframes) {
      num(k.t);
      k.offset.forEach(num);
      k.rotation.forEach(num);
      num(k.scale);
    }
  }
  return h.toString(16).padStart(8, "0");
}

function suggestGroups(
  segment: ReferenceSceneSegment,
  droneIds: readonly string[],
  perDroneMeanDeformation: readonly number[],
  stableCoreResidual: number,
): SuggestedMotionGroup[] {
  const indexById = new Map<string, number>();
  droneIds.forEach((id, i) => indexById.set(id, i));
  const out: SuggestedMotionGroup[] = [];
  segment.clusters.forEach((cluster, i) => {
    const ids = cluster.droneIds
      .map((id) => indexById.get(id))
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    if (ids.length === 0) return;
    out.push({
      id: `REFERENCE_CLUSTER_${i + 1}`,
      name: `Reference cluster ${i + 1}`,
      pointIds: ids.map(conversionPointId),
      sourceDroneIds: ids.map((k) => droneIds[k]!),
      meanResidualMeters: cluster.meanResidualMeters,
      kind: "CLUSTER",
    });
  });
  const stable: number[] = [];
  perDroneMeanDeformation.forEach((v, i) => {
    if (v <= stableCoreResidual) stable.push(i);
  });
  if (stable.length >= Math.max(4, Math.floor(droneIds.length * 0.25)) && stable.length < droneIds.length) {
    const mean = stable.reduce((s, i) => s + perDroneMeanDeformation[i]!, 0) / stable.length;
    out.push({
      id: "REFERENCE_STABLE_CORE",
      name: "Reference stable core",
      pointIds: stable.map(conversionPointId),
      sourceDroneIds: stable.map((i) => droneIds[i]!),
      meanResidualMeters: mean,
      kind: "STABLE_CORE",
    });
  }
  return out;
}

function defaultName(segment: ReferenceSceneSegment): string {
  const auto = /^[A-Za-z?/ ]+ \d{2,}$/.test(segment.label.trim());
  if (!auto) return `${segment.label.trim()} — Converted`;
  const digits = segment.id.match(/(\d+)/)?.[1] ?? segment.label.match(/(\d+)/)?.[1] ?? "01";
  return `Reference Dynamic ${digits.padStart(2, "0")}`;
}

/** Conversion driven directly by a point-cloud sequence (tests, synthetic data). */
export function convertSequenceSegment(
  sequence: PointCloudSequence,
  segment: ReferenceSceneSegment,
  showHash: string,
  sourceSampleRateHz: number,
  options: ConversionOptions = {},
): DynamicFormationConversionProposal {
  const resolved = resolveConversionOptions(options);
  const window = segmentWindow(sequence, segment.startTime, segment.endTime);
  const decomposition = decomposeSegment(sequence, window, {
    referenceFrame: resolved.referenceFrame,
    referenceTime: resolved.referenceTime,
    rotationFit: resolved.rotationFit,
  });
  const n = decomposition.droneCount;
  const frames = decomposition.sampleCount;
  const warnings: string[] = [];
  const eligibility = segmentEligibility(segment.classification);
  if (eligibility === "EXPERIMENTAL") {
    warnings.push(
      "FORMATION_TRANSITION is experimental: it may be a topology morph rather than one coherent animated formation.",
    );
  }
  if (eligibility === "UNSUPPORTED") {
    warnings.push(
      `Segment class ${segment.classification} is not a recommended dynamic-formation source (takeoff/landing/ground phases).`,
    );
  }
  if (frames < 2) warnings.push("Segment contains fewer than two source samples.");

  const source: FidelitySource = {
    segmentId: segment.id,
    droneIds: decomposition.droneIds,
    droneCount: n,
    sampleCount: frames,
    times: decomposition.localTimes,
    positions: decomposition.world,
    duration: decomposition.localTimes[frames - 1] ?? 0,
    rigidResidualRms: decomposition.rigidResidualRms,
  };

  const allIndices = decomposition.localTimes.map((_, i) => i);
  const name = options.name ?? defaultName(segment);
  const id = options.formationId ?? `dyn-ref-${segment.id}`;
  const seed = 1;

  const exactFormation = buildDynamicFormationFromDecomposition({
    decomposition,
    transformIndices: allIndices,
    deformationIndices: Array.from({ length: n }, () => allIndices),
    id,
    name,
    seed,
  });
  const exactCounts = countKeyframes(exactFormation);

  const suggested = resolved.suggestMotionGroups
    ? suggestGroups(segment, decomposition.droneIds, decomposition.perDroneMeanDeformation, resolved.stableCoreResidualMeters)
    : [];

  let transformIndices = allIndices;
  let deformationIndices: number[][] = Array.from({ length: n }, () => allIndices);

  if (resolved.mode === "SIMPLIFIED" && frames > 2) {
    let tolerance = resolved.toleranceMeters;
    let accepted = false;
    for (let attempt = 0; attempt < 4 && !accepted; attempt++) {
      const selection = selectSimplifiedIndices(decomposition, tolerance);
      const candidate = buildDynamicFormationFromDecomposition({
        decomposition,
        transformIndices: selection.transformIndices,
        deformationIndices: selection.deformationIndices,
        id,
        name,
        seed,
      });
      // Never trust local fitting: re-measure over the WHOLE interval.
      const report = evaluateDynamicFormationFidelity(source, candidate);
      if (report.maxErrorMeters <= resolved.toleranceMeters) {
        transformIndices = selection.transformIndices;
        deformationIndices = selection.deformationIndices;
        accepted = true;
      } else {
        tolerance *= 0.4;
      }
    }
    if (!accepted) {
      warnings.push(
        `Simplification could not stay inside ${resolved.toleranceMeters.toFixed(3)} m; every source sample was retained.`,
      );
    }
  }

  const formation = buildDynamicFormationFromDecomposition({
    decomposition,
    transformIndices,
    deformationIndices,
    id,
    name,
    seed,
    suggestedGroups: suggested,
  });

  const fidelityReport = evaluateDynamicFormationFidelity(source, formation);
  const counts = countKeyframes(formation);
  const loop = analyzeLoopClosure(decomposition, segment, resolved.loopClosureToleranceMeters);

  if (fidelityReport.maxErrorMeters > resolved.toleranceMeters && resolved.mode === "SIMPLIFIED") {
    warnings.push(
      `Measured maximum reconstruction error ${fidelityReport.maxErrorMeters.toFixed(3)} m exceeds the requested tolerance.`,
    );
  }

  return {
    sourceReferenceShowHash: showHash,
    sourceSegmentId: segment.id,
    sourceSegmentLabel: segment.label,
    sourceStartTime: segment.startTime,
    sourceEndTime: segment.endTime,
    sourceClassification: segment.classification,
    eligibility,
    droneCount: n,
    referenceTime: decomposition.referenceTime,
    basePoints: decomposition.basePoints,
    pivot: decomposition.pivot,
    extractedGlobalTransformTrack: decomposition.transform,
    extractedDeformationTracks: deformationTracks(decomposition, conversionPointId),
    suggestedMotionGroups: suggested,
    sourceSampleRate: sourceSampleRateHz,
    nativeSampleSettings: {
      mode: resolved.mode,
      toleranceMeters: resolved.toleranceMeters,
      interpolation: "linear",
      duration: formation.duration,
    },
    sourceTimes: decomposition.localTimes,
    sourceWorld: decomposition.world,
    formation,
    fidelityReport,
    keyframes: {
      sourceFrames: frames,
      transformKeyframes: counts.transform,
      deformationKeyframes: counts.deformation,
      exactTotalKeyframes: exactCounts.total,
      totalKeyframes: counts.total,
      reduction: exactCounts.total > 0 ? 1 - counts.total / exactCounts.total : 0,
    },
    loop,
    provenance: {
      sourceType: "ESSP_REFERENCE_SEGMENT",
      sourceShowHash: showHash,
      sourceSegmentId: segment.id,
      sourceStartTime: segment.startTime,
      sourceEndTime: segment.endTime,
      sourceClassification: segment.classification,
      conversionMode: resolved.mode,
      conversionTolerance: resolved.toleranceMeters,
      conversionAlgorithmVersion: REFERENCE_DYNAMIC_CONVERTER_VERSION,
      referenceFrameMode: resolved.referenceFrame,
      referenceTime: decomposition.referenceTime,
      sourceSampleRateHz,
      sourceDroneIds: decomposition.droneIds,
      activeSourceDroneIds: segment.activeDroneIds,
      fidelitySummary: {
        meanErrorMeters: fidelityReport.meanErrorMeters,
        rmsErrorMeters: fidelityReport.rmsErrorMeters,
        p95ErrorMeters: fidelityReport.p95ErrorMeters,
        maxErrorMeters: fidelityReport.maxErrorMeters,
        status: fidelityReport.status,
      },
    },
    options: resolved,
    warnings,
    algorithmVersion: REFERENCE_DYNAMIC_CONVERTER_VERSION,
  };
}

function selectSimplifiedIndices(
  decomposition: ReturnType<typeof decomposeSegment>,
  tolerance: number,
): { transformIndices: number[]; deformationIndices: number[][] } {
  const times = decomposition.localTimes;
  const globalTolerance = tolerance * 0.5;
  const localTolerance = tolerance * 0.5;
  const translations = decomposition.transform.map(
    (s) => s.translation as readonly [number, number, number],
  );
  const quats = decomposition.transform.map((s) => s.quaternion as Quat);
  const transformIndices = unionIndices(
    simplifyVectorTrack(times, translations, globalTolerance),
    simplifyQuaternionTrack(times, quats, globalTolerance, decomposition.maxLocalRadius),
  );
  const deformationIndices: number[][] = [];
  const n = decomposition.droneCount;
  for (let i = 0; i < n; i++) {
    const offsets: [number, number, number][] = times.map((_, k) => {
      const o = k * n * 3 + i * 3;
      return [decomposition.deformation[o]!, decomposition.deformation[o + 1]!, decomposition.deformation[o + 2]!];
    });
    deformationIndices.push(simplifyVectorTrack(times, offsets, localTolerance));
  }
  return { transformIndices, deformationIndices };
}

function analyzeLoopClosure(
  decomposition: ReturnType<typeof decomposeSegment>,
  segment: ReferenceSceneSegment,
  toleranceMeters: number,
): LoopClosureAnalysis {
  const n = decomposition.droneCount;
  const frames = decomposition.sampleCount;
  let sq = 0;
  let max = 0;
  if (frames >= 2 && n > 0) {
    const last = frames - 1;
    for (let i = 0; i < n; i++) {
      const a = i * 3;
      const b = last * n * 3 + i * 3;
      // Local geometry Q_i + D_i, at the first and last sample.
      const dx = decomposition.deformation[b]! - decomposition.deformation[a]!;
      const dy = decomposition.deformation[b + 1]! - decomposition.deformation[a + 1]!;
      const dz = decomposition.deformation[b + 2]! - decomposition.deformation[a + 2]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      sq += d2;
      const d = Math.sqrt(d2);
      if (d > max) max = d;
    }
  }
  const rms = n ? Math.sqrt(sq / n) : 0;
  return {
    loopClosureRms: rms,
    loopClosureMax: max,
    loopCandidate: frames >= 3 && rms <= toleranceMeters,
    periodicSeconds: segment.periodicity.estimatedPeriodSeconds,
    periodicityConfidence: segment.periodicity.confidence,
  };
}

/** Immutable fidelity source view of a proposal (for re-comparison after edits). */
export function fidelitySourceFromProposal(
  proposal: DynamicFormationConversionProposal,
): FidelitySource {
  return {
    segmentId: proposal.sourceSegmentId,
    droneIds: proposal.provenance.sourceDroneIds,
    droneCount: proposal.droneCount,
    sampleCount: proposal.sourceTimes.length,
    times: proposal.sourceTimes,
    positions: proposal.sourceWorld,
    duration: proposal.formation.duration,
    rigidResidualRms: proposal.extractedGlobalTransformTrack.map((s) => s.rigidRmsMeters),
  };
}

/**
 * Conversion entry point. Reads the immutable reference show; returns a
 * proposal. Nothing in the reference show is modified.
 */
export function convertReferenceSegmentToDynamicFormation(
  referenceShow: ReferenceShow,
  segment: ReferenceSceneSegment,
  options: ConversionOptions = {},
): DynamicFormationConversionProposal {
  const full = sequenceFromReferenceShow(referenceShow);
  const subset = options.sourceDroneIds?.length
    ? subsetIndicesForDroneIds(full, options.sourceDroneIds)
    : null;
  if (subset && subset.length === 0) {
    throw new ReferenceConversionError(
      "NO_DRONES",
      "The requested drone subset does not intersect the imported show.",
    );
  }
  const sequence = subset ? subsetPointCloudSequence(full, subset) : full;
  return convertSequenceSegment(
    sequence,
    segment,
    referenceShowHash(referenceShow),
    referenceShow.timing.positionRateHz,
    options,
  );
}
