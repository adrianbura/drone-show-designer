/** Import-only projection. Never changes the saved forensic report or source. */
import { intervalResiduals } from "../forensics/metrics";
import { detectPeriodicity } from "../forensics/periodicity";
import type {
  PointCloudSequence,
  ReferenceForensicsReport,
  ReferenceSceneSegment,
} from "../forensics/types";
import { visualIdentityResidual } from "./visualIdentity";

const VISUAL_CLASSES = new Set([
  "STATIC_FORMATION", "GLOBAL_TRANSLATION", "GLOBAL_ROTATION", "RIGID_MOTION",
  "DYNAMIC_DEFORMATION", "FORMATION_TRANSITION",
]);

function sampleAt(sequence: PointCloudSequence, time: number): number {
  return Math.max(0, Math.min(sequence.sampleCount - 1, Math.round(time * sequence.rateHz)));
}

/** The existing deformation tolerance now also measures similarity-fit identity.
 * Compare every available sample to a fixed anchor, not overlapping endpoints:
 * otherwise a slow morph could chain together into a false single scene.
 * No RGB gate: fading/recolouring alone must not split the same geometry.
 */
export function visualSceneSegments(
  sequence: PointCloudSequence,
  report: ReferenceForensicsReport,
  minimumSceneSeconds: number,
): ReferenceSceneSegment[] {
  const tolerance = report.thresholds.deformationRmsMeters;
  const episodes: { members: ReferenceSceneSegment[]; anchor: number }[] = [];
  let current: { members: ReferenceSceneSegment[]; anchor: number } | undefined;
  for (const segment of [...report.segments].sort((a, b) => a.startTime - b.startTime)) {
    if (!VISUAL_CLASSES.has(segment.classification)) {
      current = undefined;
      continue;
    }
    const start = sampleAt(sequence, segment.startTime);
    const end = sampleAt(sequence, segment.endTime);
    const anchor = sampleAt(sequence, (segment.startTime + segment.endTime) / 2);
    const matches = (reference: number) => {
      for (let sample = start; sample <= end; sample++) {
        if (visualIdentityResidual(sequence, reference, sample) > tolerance) return false;
      }
      return true;
    };
    const last = current?.members.at(-1);
    if (current && last && segment.startTime <= last.endTime && matches(current.anchor)) {
      current.members.push(segment);
    } else if (matches(anchor)) {
      current = { members: [segment], anchor };
      episodes.push(current);
    } else {
      // A real/uncertain transition is a barrier, not an episode to absorb.
      current = undefined;
      if (segment.classification !== "FORMATION_TRANSITION") {
        episodes.push({ members: [segment], anchor });
      }
    }
  }
  return episodes.flatMap(({ members }) => {
    const first = members[0];
    const last = members.at(-1);
    if (!first || !last) return [];
    const duration = last.endTime - first.startTime;
    // Duration alone cannot discard a bounded visual episode. The motion
    // pipeline has already performed its configured short-window cleanup.
    if (duration <= 0) return [];
    if (members.length === 1 && first.classification !== "FORMATION_TRANSITION") return [first];
    const start = sampleAt(sequence, first.startTime);
    const end = sampleAt(sequence, last.endTime);
    const residuals = intervalResiduals(sequence, start, end);
    const dynamic = members.some((s) => s.classification !== "STATIC_FORMATION");
    const periodicity = detectPeriodicity(
      residuals.projectionSeries, residuals.stepSeconds,
      report.thresholds.periodicityMinConfidence,
    );
    return [{
      ...first,
      endTime: last.endTime,
      duration,
      classification: dynamic ? "DYNAMIC_DEFORMATION" as const : "STATIC_FORMATION" as const,
      periodicity,
      // Metrics belong to the original motion report. Do not pretend a copied
      // fragment metric describes the whole grouped episode.
      metrics: {
        ...first.metrics,
        deformationRmsMeters: Math.max(...members.map((s) => s.metrics.deformationRmsMeters)),
      },
      label: first.label,
    }];
  }).filter((segment) => {
    const takeoff = report.takeoffInterval;
    const landing = report.landingInterval;
    if (takeoff && segment.endTime <= takeoff.endTime) return false;
    if (landing && segment.startTime >= landing.startTime) return false;
    // Explicit non-default duration requests still govern uncertain motion
    // fragments; identity-confirmed and short stable episodes remain eligible.
    return segment.duration >= minimumSceneSeconds || segment.classification === "STATIC_FORMATION"
      || segment.classification === "DYNAMIC_DEFORMATION";
  });
}