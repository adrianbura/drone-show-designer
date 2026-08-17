/**
 * Forensics orchestration: sequence -> windows -> classification -> segments ->
 * report. Pure and deterministic: identical inputs give identical output.
 */
import {
  lightingSourceFromReferenceShow,
  referenceShowHash,
  sequenceFromReferenceShow,
} from "./adapter";
import { classifyWindows } from "./classification";
import { centeredCloud } from "./centroid";
import { analyzeLighting, intervalResiduals, perDroneMetrics } from "./metrics";
import { buildMotionWindows } from "./motion";
import { segmentShow } from "./segmentation";
import type { ReferenceShow } from "../types";
import {
  ESSP_FORENSICS_ALGORITHM_VERSION,
  FORENSICS_LIMITATIONS,
  FORENSICS_PRESETS,
  type DynamicFormationObservation,
  type ForensicsPresetName,
  type LightingStatistics,
  type MotionEnergyTracks,
  type PointCloudSequence,
  type ReferenceForensicsReport,
  type ReferenceForensicsThresholds,
  type ReferenceSegmentClassification,
} from "./types";
import { centroidAt } from "./centroid";

const EMPTY_COUNTS: Record<ReferenceSegmentClassification, number> = {
  GROUND_STATIC: 0,
  TAKEOFF_ASCENT: 0,
  STATIC_FORMATION: 0,
  POSSIBLE_STAGING: 0,
  GLOBAL_TRANSLATION: 0,
  GLOBAL_ROTATION: 0,
  RIGID_MOTION: 0,
  DYNAMIC_DEFORMATION: 0,
  FORMATION_TRANSITION: 0,
  LANDING_DESCENT: 0,
  UNKNOWN: 0,
};

export interface AnalyzeOptions {
  preset?: ForensicsPresetName;
  thresholds?: Partial<ReferenceForensicsThresholds>;
  lighting?: LightingStatistics | null;
  source?: ReferenceForensicsReport["source"];
  /** Optional cooperative cancellation hook. */
  shouldCancel?: () => boolean;
}

export class ForensicsCancelled extends Error {
  constructor() {
    super("Forensic analysis cancelled");
    this.name = "ForensicsCancelled";
  }
}

/** Core analysis over any point-cloud sequence (used by tests and by the show). */
export function analyzeSequence(
  seq: PointCloudSequence,
  options: AnalyzeOptions = {},
): ReferenceForensicsReport {
  const preset = options.preset ?? "BALANCED";
  const th: ReferenceForensicsThresholds = { ...FORENSICS_PRESETS[preset], ...options.thresholds };
  if (options.shouldCancel?.()) throw new ForensicsCancelled();

  const { windows: raw } = buildMotionWindows(seq, th);
  const windows = classifyWindows(raw, th);
  if (options.shouldCancel?.()) throw new ForensicsCancelled();

  const lighting = options.lighting ?? null;
  const lightingEnergyAt = (t: number) => {
    if (!lighting || !lighting.track.length) return 0;
    let best = lighting.track[0]!;
    for (const s of lighting.track) if (Math.abs(s.time - t) < Math.abs(best.time - t)) best = s;
    return best.changeEnergy;
  };

  const { segments, holds, changePointTimes } = segmentShow(seq, windows, th, lightingEnergyAt);
  if (options.shouldCancel?.()) throw new ForensicsCancelled();

  const counts = { ...EMPTY_COUNTS, total: segments.length };
  for (const s of segments) counts[s.classification] += 1;

  const energy: MotionEnergyTracks = {
    times: windows.map((w) => w.startTime),
    globalTranslationEnergy: windows.map((w) => w.centroidSpeedMps),
    globalRotationEnergy: windows.map((w) => w.rotationRateDegPerSec),
    internalDeformationEnergy: windows.map((w) => w.deformationRmsMeters),
    lightingChangeEnergy: windows.map((w) => lightingEnergyAt(w.startTime)),
  };

  let maxAltitude = 0;
  for (let s = 0; s < seq.sampleCount; s++) {
    const n = seq.droneCount;
    const base = s * n * 3;
    for (let i = 0; i < n; i++) {
      const y = seq.positions[base + i * 3 + 1]!;
      if (y > maxAltitude) maxAltitude = y;
    }
  }
  let travel = 0;
  for (let s = 1; s < seq.sampleCount; s++) {
    const a = centroidAt(seq, s - 1);
    const b = centroidAt(seq, s);
    travel += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }

  const dynamicObservations: DynamicFormationObservation[] = segments
    .filter((s) => s.classification === "DYNAMIC_DEFORMATION")
    .slice(0, 12)
    .map((s) => {
      const s0 = Math.round(s.startTime * seq.rateHz);
      const s1 = Math.min(seq.sampleCount - 1, Math.round(s.endTime * seq.rateHz));
      const stride = Math.max(1, Math.round((s1 - s0) / 60));
      const res = intervalResiduals(seq, s0, s1, stride);
      const centroidTrack: [number, number, number][] = [];
      for (let k = s0; k <= s1; k += stride) centroidTrack.push(centroidAt(seq, k));
      return {
        segmentId: s.id,
        referenceTime: s.startTime,
        centroidTrack,
        rigidRotationTrack: res.rotationSeries,
        residualTrack: res.rmsSeries,
        activeDroneIds: s.activeDroneIds,
        periodicity: s.periodicity,
      };
    });

  const takeoff = segments.find((s) => s.classification === "TAKEOFF_ASCENT") ?? null;
  const landing = [...segments].reverse().find((s) => s.classification === "LANDING_DESCENT") ?? null;
  const staging = segments.find((s) => s.classification === "POSSIBLE_STAGING") ?? null;
  const correlated = lighting
    ? changePointTimes.filter((t) => lighting.changeEventTimes.some((l) => Math.abs(l - t) <= 0.5))
    : [];

  return {
    algorithmVersion: ESSP_FORENSICS_ALGORITHM_VERSION,
    analyzedAt: new Date().toISOString(),
    preset,
    thresholds: th,
    source:
      options.source ??
      {
        importedAt: "",
        droneCount: seq.droneCount,
        sampleRateHz: seq.rateHz,
        positionSampleCount: seq.sampleCount,
        showDurationSeconds: seq.times[seq.sampleCount - 1] ?? 0,
        showHash: "synthetic",
      },
    segments,
    holds,
    possibleStaging: staging ? { startTime: staging.startTime, endTime: staging.endTime } : null,
    takeoffInterval: takeoff ? { startTime: takeoff.startTime, endTime: takeoff.endTime } : null,
    landingInterval: landing ? { startTime: landing.startTime, endTime: landing.endTime } : null,
    counts,
    motion: {
      maxCentroidSpeedMps: Math.max(0, ...windows.map((w) => w.centroidSpeedMps)),
      totalCentroidTravelMeters: travel,
      maxRotationRateDegPerSec: Math.max(0, ...windows.map((w) => w.rotationRateDegPerSec)),
      maxDeformationRmsMeters: Math.max(0, ...windows.map((w) => w.deformationRmsMeters)),
      maxAltitudeMeters: maxAltitude,
    },
    lighting,
    energy,
    perDrone: perDroneMetrics(
      seq,
      0,
      Math.max(0, seq.sampleCount - 1),
      Math.max(1, Math.round(seq.sampleCount / 400)),
    ),
    dynamicObservations,
    correlatedBoundaries: correlated,
    limitations: FORENSICS_LIMITATIONS,
  };
}

/** Full forensic analysis of an imported (immutable) ESSP reference show. */
export function analyzeReferenceShow(
  show: ReferenceShow,
  options: AnalyzeOptions = {},
): ReferenceForensicsReport {
  const seq = sequenceFromReferenceShow(show);
  const preset = options.preset ?? "BALANCED";
  const th = { ...FORENSICS_PRESETS[preset], ...options.thresholds };
  const lighting = analyzeLighting(
    lightingSourceFromReferenceShow(show),
    th.strideSeconds,
    th.changePointSensitivity,
  );
  return analyzeSequence(seq, {
    ...options,
    preset,
    lighting,
    source: {
      importedAt: show.importedAt,
      droneCount: show.drones.length,
      sampleRateHz: show.timing.positionRateHz,
      positionSampleCount: seq.sampleCount,
      showDurationSeconds: show.timing.playbackDurationSeconds,
      showHash: referenceShowHash(show),
    },
  });
}

/** Serialises the report for download. Never includes flight trajectories. */
export function forensicsReportToJson(report: ReferenceForensicsReport): string {
  const { energy, perDrone, lighting, ...rest } = report;
  return JSON.stringify(
    {
      kind: "ESSPReferenceForensicsReport",
      ...rest,
      lighting: lighting
        ? {
            sampleRateHz: lighting.sampleRateHz,
            meanBrightness: lighting.meanBrightness,
            maxChangeEnergy: lighting.maxChangeEnergy,
            changeEventCount: lighting.changeEventTimes.length,
          }
        : null,
      perDroneTop: [...perDrone]
        .sort((a, b) => b.meanResidualMeters - a.meanResidualMeters)
        .slice(0, 25),
      energySampleCount: energy.times.length,
    },
    null,
    2,
  );
}

export { centeredCloud };
