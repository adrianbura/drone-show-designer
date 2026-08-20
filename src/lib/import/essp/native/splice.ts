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

/**
 * Playback samples for the viewport/inspector: reference-owned intervals return
 * the imported positions with a finite-difference velocity, and NO acceleration
 * or jerk — the imported layer carries no derivative profile, and inventing one
 * would fake dynamics the source never stated. Planner-owned intervals return
 * the planned samples untouched.
 */
export function splicedTrajectorySamples<
  T extends { readonly position: Vector3Tuple; readonly velocity: Vector3Tuple },
>(
  show: ReferenceShow | null,
  layer: ReferenceTrajectoryLayer | null,
  time: number,
  planned: readonly T[],
): { samples: T[]; owner: "REFERENCE" | "PLANNER" } {
  if (!show || !layer) return { samples: [...planned], owner: "PLANNER" };
  const interval = intervalAtTime(layer, time);
  if (!interval || interval.owner !== "REFERENCE") {
    return { samples: [...planned], owner: "PLANNER" };
  }
  const dt = 1 / Math.max(1, show.timing.positionRateHz);
  const samples = planned.map((sample, i) => {
    const drone = show.drones[i];
    if (!drone) return sample;
    const here = sampleReferenceDrone(drone, time, show.timing).position;
    const ahead = sampleReferenceDrone(drone, time + dt, show.timing).position;
    const behind = sampleReferenceDrone(drone, Math.max(0, time - dt), show.timing).position;
    const span = time <= 0 ? dt : 2 * dt;
    return {
      ...sample,
      position: here as Vector3Tuple,
      velocity: [
        (ahead[0] - behind[0]) / span,
        (ahead[1] - behind[1]) / span,
        (ahead[2] - behind[2]) / span,
      ] as Vector3Tuple,
      acceleration: [0, 0, 0] as Vector3Tuple,
      jerk: [0, 0, 0] as Vector3Tuple,
    };
  });
  return { samples, owner: "REFERENCE" };
}

/**
 * LED AUTHORITY of one instant, as a fleet colour array: the imported RGB bytes
 * while the owning interval is still reference-owned, `null` when the authored
 * lighting engine owns time `time`. ONE implementation, shared by the viewport
 * preview and by every export path, so preview and file can never disagree.
 */
export function referenceColorsAt(
  show: ReferenceShow | null,
  layer: ReferenceTrajectoryLayer | null,
  time: number,
  fleetSize: number,
): RGB[] | null {
  if (!show || !layer) return null;
  if (intervalAtTime(layer, time)?.owner !== "REFERENCE") return null;
  return referenceLightStates(show, time, fleetSize).map((s) => [s.r, s.g, s.b] as RGB);
}

/** LED output of a reference-owned instant: the original RGB bytes. */
export function referenceLightStates(
  show: ReferenceShow,
  time: number,
  fleetSize: number,
): { r: number; g: number; b: number; intensity: number }[] {
  const out: { r: number; g: number; b: number; intensity: number }[] = [];
  for (let i = 0; i < fleetSize; i += 1) {
    const drone = show.drones[i];
    if (!drone) {
      out.push({ r: 0, g: 0, b: 0, intensity: 0 });
      continue;
    }
    const c = sampleReferenceDrone(drone, time, show.timing).color;
    out.push({ r: c[0], g: c[1], b: c[2], intensity: 1 });
  }
  return out;
}
