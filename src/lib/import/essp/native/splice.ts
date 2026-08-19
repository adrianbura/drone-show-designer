/**
 * SPLICED PLAYBACK — reference-owned intervals play the imported layer,
 * planner-owned intervals play the computed plan.
 *
 * There is no cross-fade and no blending: at any instant exactly one authority
 * produces the output, decided by `intervalAtTime`. Blending would invent
 * positions that neither the imported show nor the planner ever produced.
 *
 * Drone identity is index-based and stable: reference drone i is fleet drone i
 * (the importer orders drones by their numeric source id). Fleet drones beyond
 * the imported count always come from the planner.
 */
import type { DroneSample, RGB, Vector3Tuple } from "../../../show/types";
import { sampleReferenceDrone } from "../playback";
import type { ReferenceShow } from "../types";
import { intervalAtTime, resolveReferenceIntervals } from "./intervals";
import {
  SPLICE_TOLERANCE_METERS,
  type ReferenceTrajectoryLayer,
  type SpliceBoundaryCheck,
  type SpliceVerificationReport,
} from "./types";

export interface SplicedSampleResult {
  readonly samples: DroneSample[];
  readonly owner: "REFERENCE" | "PLANNER";
  readonly clipId: string | null;
}

/** Reference samples for the whole fleet at `time`, padded from the plan. */
export function referenceFleetSamples(
  show: ReferenceShow,
  time: number,
  fleetSize: number,
  planned: readonly DroneSample[],
): DroneSample[] {
  const out: DroneSample[] = [];
  for (let i = 0; i < fleetSize; i += 1) {
    const drone = show.drones[i];
    if (!drone) {
      const fallback = planned[i];
      out.push(
        fallback ?? { position: [0, 0, 0] as Vector3Tuple, color: [0, 0, 0] as RGB },
      );
      continue;
    }
    const sample = sampleReferenceDrone(drone, time, show.timing);
    out.push({ position: sample.position as Vector3Tuple, color: sample.color as RGB });
  }
  return out;
}

/**
 * Resolves playback at `time`: the imported layer while the owning interval is
 * still reference-owned, otherwise the planner output passed in.
 */
export function splicedSamplesAt(
  show: ReferenceShow | null,
  layer: ReferenceTrajectoryLayer | null,
  time: number,
  planned: readonly DroneSample[],
  fleetSize = planned.length,
): SplicedSampleResult {
  if (!show || !layer) {
    return { samples: [...planned], owner: "PLANNER", clipId: null };
  }
  const interval = intervalAtTime(layer, time);
  if (!interval || interval.owner !== "REFERENCE") {
    return { samples: [...planned], owner: "PLANNER", clipId: interval?.clipId ?? null };
  }
  return {
    samples: referenceFleetSamples(show, time, fleetSize, planned),
    owner: "REFERENCE",
    clipId: interval.clipId,
  };
}

function maxDelta(
  a: readonly Vector3Tuple[],
  b: readonly Vector3Tuple[],
): { delta: number; index: number } {
  let delta = 0;
  let index = -1;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const p = a[i]!;
    const q = b[i]!;
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (d > delta) {
      delta = d;
      index = i;
    }
  }
  return { delta, index };
}

/**
 * Verifies every boundary where ownership changes. A boundary is safe when the
 * two authorities agree on the position at the switch instant, which is what
 * makes the splice continuous rather than a teleport.
 */
export function verifySpliceBoundaries(
  show: ReferenceShow,
  layer: ReferenceTrajectoryLayer,
  plannedPositionsAt: (time: number) => readonly Vector3Tuple[],
  toleranceMeters = SPLICE_TOLERANCE_METERS,
): SpliceVerificationReport {
  const intervals = resolveReferenceIntervals(layer);
  const boundaries: SpliceBoundaryCheck[] = [];
  let worst = 0;
  for (let i = 1; i < intervals.length; i += 1) {
    const left = intervals[i - 1]!;
    const right = intervals[i]!;
    if (left.owner === right.owner) continue;
    const time = right.start;
    const fleetSize = show.drones.length;
    const reference = referenceFleetSamples(show, time, fleetSize, []).map(
      (s) => s.position as Vector3Tuple,
    );
    const planned = plannedPositionsAt(time);
    const { delta, index } = maxDelta(reference, planned);
    worst = Math.max(worst, delta);
    boundaries.push({
      time,
      leftClipId: left.clipId,
      rightClipId: right.clipId,
      maxDeltaMeters: delta,
      worstDroneIndex: index,
      ok: delta <= toleranceMeters,
    });
  }
  return {
    toleranceMeters,
    boundaries,
    ok: boundaries.every((b) => b.ok),
    worstDeltaMeters: worst,
  };
}
