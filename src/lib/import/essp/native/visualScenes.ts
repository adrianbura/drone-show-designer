/** Import-only projection. Never changes the saved forensic report or source. */
import { intervalResiduals, netShapeChange } from "../forensics/metrics";
import { centroidAt } from "../forensics/centroid";
import { detectPeriodicity } from "../forensics/periodicity";
import type {
  PointCloudSequence,
  ReferenceForensicsReport,
  ReferenceSceneSegment,
} from "../forensics/types";
import { visualIdentityResidual } from "./visualIdentity";

const VISUAL_CLASSES = new Set([
  "STATIC_FORMATION",
  "GLOBAL_TRANSLATION",
  "GLOBAL_ROTATION",
  "RIGID_MOTION",
  "DYNAMIC_DEFORMATION",
  "FORMATION_TRANSITION",
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
  const episodes: { members: ReferenceSceneSegment[]; anchor: number; confirmed: boolean }[] = [];
  let current: (typeof episodes)[number] | undefined;
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
      current = { members: [segment], anchor, confirmed: true };
      episodes.push(current);
    } else {
      // Upstream short-run absorption can put the end of a pulse into the
      // following morph run. Recover only the prefix proved against an already
      // confirmed, fixed anchor; never infer a new visual from a moving anchor.
      if (current?.confirmed && last && segment.startTime <= last.endTime) {
        let compatibleEnd = start - 1;
        for (let sample = start; sample <= end; sample++) {
          const residual = visualIdentityResidual(sequence, current.anchor, sample);
          if (!Number.isFinite(residual) || residual > tolerance) break;
          compatibleEnd = sample;
        }
        const prefixEndTime = sequence.times[compatibleEnd];
        if (prefixEndTime !== undefined && prefixEndTime > last.endTime) {
          current.members.push({
            ...segment,
            endTime: prefixEndTime,
            duration: prefixEndTime - segment.startTime,
          });
        }
      }
      // A real/uncertain transition is a barrier, not an episode to absorb.
      current = undefined;
      if (segment.classification !== "FORMATION_TRANSITION") {
        episodes.push({ members: [segment], anchor, confirmed: false });
      }
    }
  }
  return episodes
    .flatMap(({ members, confirmed }) => {
      const first = members[0];
      const last = members.at(-1);
      if (!first || !last) return [];
      const duration = last.endTime - first.startTime;
      // Duration alone cannot discard a bounded visual episode. The motion
      // pipeline has already performed its configured short-window cleanup.
      if (duration <= 0) return [];
      if (!confirmed && duration < minimumSceneSeconds) return [];
      if (members.length === 1 && first.classification !== "FORMATION_TRANSITION") return [first];
      const start = sampleAt(sequence, first.startTime);
      const end = sampleAt(sequence, last.endTime);
      const residuals = intervalResiduals(sequence, start, end);
      const dynamic = members.some((s) => s.classification !== "STATIC_FORMATION");
      const periodicity = detectPeriodicity(
        residuals.projectionSeries,
        residuals.stepSeconds,
        report.thresholds.periodicityMinConfidence,
      );
      const average = (key: keyof ReferenceSceneSegment["metrics"]) =>
        members.reduce((sum, s) => sum + s.metrics[key] * s.duration, 0) /
        members.reduce((sum, s) => sum + s.duration, 0);
      const from = centroidAt(sequence, start);
      const to = centroidAt(sequence, end);
      const activeDroneIds = sequence.droneIds.filter(
        (_, index) => (residuals.mean[index] ?? 0) > report.thresholds.activeDroneResidualMeters,
      );
      return [
        {
          ...first,
          endTime: last.endTime,
          duration,
          classification: dynamic
            ? ("DYNAMIC_DEFORMATION" as const)
            : ("STATIC_FORMATION" as const),
          periodicity,
          activeDroneIds,
          clusters: [],
          metrics: {
            centroidTravelMeters: Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]),
            meanCentroidSpeedMps: average("meanCentroidSpeedMps"),
            maxRotationDeg: Math.max(0, ...residuals.rotationSeries),
            totalRotationDeg: members.reduce((sum, s) => sum + s.metrics.totalRotationDeg, 0),
            meanScale: average("meanScale"),
            rigidRmsMeters:
              residuals.rmsSeries.reduce((sum, v) => sum + v, 0) /
              Math.max(1, residuals.rmsSeries.length),
            deformationRmsMeters: average("deformationRmsMeters"),
            maxDeformationMeters: Math.max(...members.map((s) => s.metrics.maxDeformationMeters)),
            medianDeformationMeters: average("medianDeformationMeters"),
            netShapeChangeMeters: netShapeChange(sequence, start, end),
            activeFraction: activeDroneIds.length / Math.max(1, sequence.droneCount),
            meanAltitudeMeters: average("meanAltitudeMeters"),
            altitudeChangeMeters: to[1] - from[1],
            lightingChangeEnergy: average("lightingChangeEnergy"),
          },
          label: first.label,
        },
      ];
    })
    .filter((segment) => {
      const takeoff = report.takeoffInterval;
      const landing = report.landingInterval;
      if (takeoff && segment.endTime <= takeoff.endTime) return false;
      if (landing && segment.startTime >= landing.startTime) return false;
      return true;
    });
}
