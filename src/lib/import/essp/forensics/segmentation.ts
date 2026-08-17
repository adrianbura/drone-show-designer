/**
 * Scene segmentation.
 *
 * 1. classified windows are merged into runs of equal classification,
 * 2. runs shorter than minSegmentSeconds are absorbed into the longer neighbour,
 * 3. deformation segments are refined against a STABLE REFERENCE SNAPSHOT: a
 *    large net start->end shape change becomes FORMATION_TRANSITION, otherwise
 *    it stays DYNAMIC_DEFORMATION (optionally periodic),
 * 4. takeoff/landing candidates are only kept where the altitude evidence
 *    supports them (near-ground start / near-ground end),
 * 5. the first sustained static segment after takeoff may become
 *    POSSIBLE_STAGING.
 *
 * Change-point detection: a deterministic window-distance measure over the
 * motion feature vector (centroid speed, rotation rate, deformation RMS,
 * altitude change) — spikes above sensitivity * median become candidate
 * boundaries and are reported alongside the merged segments.
 */
import { detectPeriodicity } from "./periodicity";
import { intervalResiduals, netShapeChange } from "./metrics";
import type {
  HoldPeriod,
  MotionCluster,
  MotionWindow,
  PointCloudSequence,
  ReferenceForensicsThresholds,
  ReferenceSceneSegment,
  ReferenceSegmentClassification,
  SegmentMetrics,
} from "./types";

const LABEL_PREFIX: Record<ReferenceSegmentClassification, string> = {
  GROUND_STATIC: "Ground",
  TAKEOFF_ASCENT: "Takeoff",
  STATIC_FORMATION: "Static formation",
  POSSIBLE_STAGING: "Possible staging",
  GLOBAL_TRANSLATION: "Global translation",
  GLOBAL_ROTATION: "Global rotation",
  RIGID_MOTION: "Rigid motion",
  DYNAMIC_DEFORMATION: "Dynamic segment",
  FORMATION_TRANSITION: "Transition",
  LANDING_DESCENT: "Landing",
  UNKNOWN: "Unknown",
};

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

interface Run {
  classification: ReferenceSegmentClassification;
  windows: MotionWindow[];
}

function mergeRuns(windows: MotionWindow[], th: ReferenceForensicsThresholds): Run[] {
  const runs: Run[] = [];
  for (const w of windows) {
    const last = runs[runs.length - 1];
    if (last && last.classification === w.classification) last.windows.push(w);
    else runs.push({ classification: w.classification, windows: [w] });
  }
  // Absorb too-short runs into the longer neighbour, repeatedly.
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      const duration = run.windows[run.windows.length - 1]!.endTime - run.windows[0]!.startTime;
      if (duration >= th.minSegmentSeconds || runs.length === 1) continue;
      const prev = runs[i - 1];
      const next = runs[i + 1];
      const target =
        prev && next
          ? prev.windows.length >= next.windows.length
            ? prev
            : next
          : (prev ?? next)!;
      target.windows = [...target.windows, ...run.windows].sort((a, b) => a.index - b.index);
      runs.splice(i, 1);
      changed = true;
      break;
    }
  }
  return runs;
}

function clusters(residualMean: number[], droneIds: string[], threshold: number): MotionCluster[] {
  const active = residualMean
    .map((v, i) => ({ v, i }))
    .filter((e) => e.v > threshold)
    .sort((a, b) => b.v - a.v);
  if (active.length < 4) return [];
  const buckets: { ids: string[]; sum: number }[] = [
    { ids: [], sum: 0 },
    { ids: [], sum: 0 },
  ];
  // Deterministic split at the median residual of the active set.
  const cut = medianOf(active.map((e) => e.v));
  for (const e of active) {
    const b = e.v >= cut ? buckets[0]! : buckets[1]!;
    b.ids.push(droneIds[e.i]!);
    b.sum += e.v;
  }
  return buckets
    .filter((b) => b.ids.length > 0)
    .map((b, i) => ({
      id: `MOTION_CLUSTER_${i + 1}`,
      droneIds: b.ids,
      meanResidualMeters: b.sum / b.ids.length,
    }));
}

export interface SegmentationResult {
  segments: ReferenceSceneSegment[];
  holds: HoldPeriod[];
  changePointTimes: number[];
}

export function segmentShow(
  seq: PointCloudSequence,
  windows: MotionWindow[],
  th: ReferenceForensicsThresholds,
  lightingEnergyAt: (t: number) => number,
): SegmentationResult {
  if (!windows.length) return { segments: [], holds: [], changePointTimes: [] };
  const runs = mergeRuns(windows, th);
  const showEnd = seq.times[seq.sampleCount - 1] ?? 0;
  const counters = new Map<ReferenceSegmentClassification, number>();
  const segments: ReferenceSceneSegment[] = [];

  for (const run of runs) {
    const first = run.windows[0]!;
    const last = run.windows[run.windows.length - 1]!;
    const startSample = first.startSample;
    const endSample = last.endSample;
    const stride = Math.max(1, Math.round((endSample - startSample) / 240));
    const res = intervalResiduals(seq, startSample, endSample, stride);
    const net = netShapeChange(seq, startSample, endSample);
    const periodicity = detectPeriodicity(
      res.projectionSeries,
      res.stepSeconds,
      th.periodicityMinConfidence,
    );

    let classification = run.classification;
    let confidence = mean(run.windows.map((w) => w.confidence));

    if (classification === "DYNAMIC_DEFORMATION" && net > th.transitionNetResidualMeters) {
      classification = "FORMATION_TRANSITION";
      confidence = Math.min(1, 0.5 + net / (4 * th.transitionNetResidualMeters));
    }
    if (classification === "TAKEOFF_ASCENT" && first.meanAltitude > 3 * th.groundAltitudeMeters) {
      classification = "GLOBAL_TRANSLATION";
    }
    if (
      classification === "LANDING_DESCENT" &&
      last.centroidEnd[1] > 3 * th.groundAltitudeMeters &&
      last.endTime < 0.5 * showEnd
    ) {
      classification = "GLOBAL_TRANSLATION";
    }

    const activeDroneIds = seq.droneIds.filter(
      (_, i) => res.mean[i]! > th.activeDroneResidualMeters,
    );
    const metrics: SegmentMetrics = {
      centroidTravelMeters: Math.hypot(
        last.centroidEnd[0] - first.centroidStart[0],
        last.centroidEnd[1] - first.centroidStart[1],
        last.centroidEnd[2] - first.centroidStart[2],
      ),
      meanCentroidSpeedMps: mean(run.windows.map((w) => w.centroidSpeedMps)),
      maxRotationDeg: Math.max(...res.rotationSeries, 0),
      totalRotationDeg: run.windows.reduce((a, w) => a + w.rotationDeg, 0),
      meanScale: mean(run.windows.map((w) => w.scale)),
      rigidRmsMeters: mean(res.rmsSeries),
      deformationRmsMeters: mean(run.windows.map((w) => w.deformationRmsMeters)),
      maxDeformationMeters: Math.max(...run.windows.map((w) => w.deformationMaxMeters), 0),
      medianDeformationMeters: medianOf(run.windows.map((w) => w.deformationMedianMeters)),
      netShapeChangeMeters: net,
      activeFraction: seq.droneCount ? activeDroneIds.length / seq.droneCount : 0,
      meanAltitudeMeters: mean(run.windows.map((w) => w.meanAltitude)),
      altitudeChangeMeters: last.centroidEnd[1] - first.centroidStart[1],
      lightingChangeEnergy: mean(run.windows.map((w) => lightingEnergyAt(w.startTime))),
    };
    const nth = (counters.get(classification) ?? 0) + 1;
    counters.set(classification, nth);
    segments.push({
      id: `SEG-${String(segments.length + 1).padStart(3, "0")}`,
      label: `${LABEL_PREFIX[classification]} ${String(nth).padStart(2, "0")}`,
      startTime: first.startTime,
      endTime: last.endTime,
      duration: last.endTime - first.startTime,
      classification,
      confidence: Math.max(0, Math.min(1, confidence)),
      metrics,
      periodicity:
        classification === "DYNAMIC_DEFORMATION"
          ? periodicity
          : { periodic: false, estimatedPeriodSeconds: null, confidence: periodicity.confidence },
      activeDroneIds,
      clusters:
        classification === "DYNAMIC_DEFORMATION"
          ? clusters(res.mean, seq.droneIds, th.activeDroneResidualMeters)
          : [],
      inferred: true,
    });
  }

  // POSSIBLE_STAGING: first sustained static formation after the takeoff.
  const takeoffIndex = segments.findIndex((s) => s.classification === "TAKEOFF_ASCENT");
  if (takeoffIndex >= 0) {
    for (let i = takeoffIndex + 1; i < segments.length; i++) {
      const s = segments[i]!;
      if (s.classification === "STATIC_FORMATION" && s.duration >= th.holdMinSeconds) {
        segments[i] = {
          ...s,
          classification: "POSSIBLE_STAGING",
          label: `${LABEL_PREFIX.POSSIBLE_STAGING} 01`,
        };
        break;
      }
      if (s.classification !== "STATIC_FORMATION" && s.classification !== "GROUND_STATIC") break;
    }
  }

  // Hold detection over the raw window stream (independent of classification).
  const holds: HoldPeriod[] = [];
  let holdStart: MotionWindow | null = null;
  let holdWindows: MotionWindow[] = [];
  const flush = (end: MotionWindow | null) => {
    if (holdStart && end) {
      const duration = end.endTime - holdStart.startTime;
      if (duration >= th.holdMinSeconds) {
        holds.push({
          startTime: holdStart.startTime,
          endTime: end.endTime,
          duration,
          meanCentroidSpeedMps: mean(holdWindows.map((w) => w.centroidSpeedMps)),
        });
      }
    }
    holdStart = null;
    holdWindows = [];
  };
  let lastQuiet: MotionWindow | null = null;
  for (const w of windows) {
    const quiet =
      w.centroidSpeedMps <= th.staticCentroidSpeedMps &&
      w.rotationRateDegPerSec <= th.staticRotationRateDegPerSec &&
      w.deformationRmsMeters <= th.deformationRmsMeters;
    if (quiet) {
      if (!holdStart) holdStart = w;
      holdWindows.push(w);
      lastQuiet = w;
    } else {
      flush(lastQuiet);
      lastQuiet = null;
    }
  }
  flush(lastQuiet);

  // Change points from a normalised motion feature vector.
  const feats = windows.map((w) => [
    w.centroidSpeedMps,
    w.rotationRateDegPerSec,
    w.deformationRmsMeters,
    Math.abs(w.verticalSpeedMps),
  ]);
  const dists: number[] = [0];
  for (let i = 1; i < feats.length; i++) {
    let d = 0;
    for (let k = 0; k < 4; k++) d += Math.abs(feats[i]![k]! - feats[i - 1]![k]!);
    dists.push(d);
  }
  const limit = Math.max(1e-6, medianOf(dists) * th.changePointSensitivity);
  const changePointTimes = windows.filter((_, i) => dists[i]! > limit).map((w) => w.startTime);

  return { segments, holds, changePointTimes };
}
