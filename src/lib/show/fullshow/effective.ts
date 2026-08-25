/**
 * EFFECTIVE TRAJECTORY AUTHORITY — the ONE trajectory the whole studio judges.
 *
 * A project that carries an imported ESSP layer has two authorities:
 *
 *   REFERENCE-owned intervals -> the imported samples (positions verbatim,
 *      derivatives finite-differenced on the SOURCE clock, LEDs = original RGB)
 *   PLANNER-owned intervals   -> the composed planner output
 *
 * `sampleEffectiveTrajectorySet()` produces a single canonical `TrajectorySet`
 * that follows exactly that ownership, and EVERY downstream consumer
 * (full-show validation, conflicts, safety, continuity, metrics, simulation,
 * export) reads that set. There is no blending: at any instant exactly one
 * authority produced the sample.
 *
 * SAMPLE GRID. The effective rate is the smallest multiple of the imported
 * position rate that is >= the requested rate, and the grid start is aligned to
 * that rate. Every original position timestamp is therefore ON the grid, so a
 * reference-owned sample is the decoded source sample (no resampling loss) while
 * the grid stays uniform — which is what the continuity validator requires.
 */
import { resolveReferenceIntervals } from "../../import/essp/native/intervals";
import { referenceKinematicsAt } from "../../import/essp/native/derivatives";
import {
  SPLICE_TOLERANCE_METERS,
  type ReferenceIntervalOwner,
  type ReferenceTrajectoryLayer,
  type ResolvedReferenceInterval,
} from "../../import/essp/native/types";
import type { ReferenceShow } from "../../import/essp/types";
import { sampleTrajectorySet, type SamplablePlan } from "../trajectory/sampler";
import { sampleScheduleBoundaryAt } from "../trajectory/schedule";
import type { DroneTrajectory, TrajectorySample, TrajectorySet } from "../trajectory/types";
import type { Vector3Tuple } from "../types";

export const EFFECTIVE_AUTHORITY_VERSION = "1.0.0";

/** Velocity agreement required where ownership changes (m/s). */
export const SPLICE_VELOCITY_TOLERANCE_MPS = 0.75;

export interface ReferenceAuthorityInput {
  readonly show: ReferenceShow;
  readonly layer: ReferenceTrajectoryLayer;
}

export interface EffectiveTrajectoryAuthority {
  readonly kind: "PLANNER_ONLY" | "SPLICED";
  readonly version: string;
  /** Identity of the imported archive that owns the reference intervals. */
  readonly referenceShowHash: string | null;
  readonly positionRateHz: number | null;
  /** Rate of the effective set (a multiple of `positionRateHz` when spliced). */
  readonly sampleRate: number;
  readonly requestedSampleRate: number;
  readonly startTime: number;
  readonly referenceSeconds: number;
  readonly plannerSeconds: number;
  readonly referenceIntervalCount: number;
  readonly plannerIntervalCount: number;
  readonly promotedClipIds: readonly string[];
  /** Samples produced by each authority, across the whole fleet. */
  readonly referenceSampleCount: number;
  readonly plannerSampleCount: number;
  readonly intervals: readonly ResolvedReferenceInterval[];
}

export interface SpliceBoundaryContinuity {
  readonly time: number;
  readonly leftClipId: string;
  readonly rightClipId: string;
  readonly leftOwner: ReferenceIntervalOwner;
  readonly rightOwner: ReferenceIntervalOwner;
  readonly maxPositionDeltaMeters: number;
  readonly worstPositionDroneIndex: number;
  readonly maxVelocityDeltaMps: number;
  readonly worstVelocityDroneIndex: number;
  readonly ok: boolean;
}

export interface SpliceContinuityReport {
  readonly ok: boolean;
  readonly positionToleranceMeters: number;
  readonly velocityToleranceMps: number;
  readonly boundaries: readonly SpliceBoundaryContinuity[];
  readonly worstPositionDeltaMeters: number;
  readonly worstVelocityDeltaMps: number;
}

export interface EffectiveSampleOptions {
  readonly sampleRate: number;
  readonly startTime: number;
  /** Last show time to cover (inclusive of the final grid step). */
  readonly endTime: number;
  readonly reference?: ReferenceAuthorityInput | null;
  readonly positionToleranceMeters?: number;
  readonly velocityToleranceMps?: number;
}

export interface EffectiveTrajectoryResult {
  /** The canonical set every consumer must read. */
  readonly set: TrajectorySet;
  /** The pure planner output on the same grid (diagnostics / splice checks). */
  readonly plannerSet: TrajectorySet;
  readonly authority: EffectiveTrajectoryAuthority;
  readonly splice: SpliceContinuityReport | null;
}

/** Smallest multiple of the source position rate that is >= `requested`. */
export function effectiveSampleRate(requested: number, positionRateHz: number): number {
  if (!Number.isFinite(positionRateHz) || positionRateHz <= 0) return requested;
  const factor = Math.max(1, Math.ceil(requested / positionRateHz));
  return Number((positionRateHz * factor).toFixed(6));
}

/** Aligns the grid start so every k / rate timestamp (t = 0 included) is hit. */
export function alignedStartTime(startTime: number, rate: number): number {
  if (startTime >= 0) return Number((Math.floor(startTime * rate) / rate).toFixed(9));
  return Number((-Math.ceil(-startTime * rate) / rate).toFixed(9));
}

function ownerAt(
  intervals: readonly ResolvedReferenceInterval[],
  t: number,
): ResolvedReferenceInterval | null {
  for (const interval of intervals) {
    if (t >= interval.start && t < interval.end) return interval;
  }
  const last = intervals[intervals.length - 1];
  if (last && t >= last.end && t <= last.end + 1e-6) return last;
  return null;
}

const dist = (a: Vector3Tuple, b: Vector3Tuple) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function plannerOnly(set: TrajectorySet, requestedSampleRate: number): EffectiveTrajectoryResult {
  const count = set.drones.reduce((n, d) => n + d.samples.length, 0);
  return {
    set,
    plannerSet: set,
    authority: {
      kind: "PLANNER_ONLY",
      version: EFFECTIVE_AUTHORITY_VERSION,
      referenceShowHash: null,
      positionRateHz: null,
      sampleRate: set.sampleRate,
      requestedSampleRate,
      startTime: set.startTime ?? 0,
      referenceSeconds: 0,
      plannerSeconds: set.duration,
      referenceIntervalCount: 0,
      plannerIntervalCount: 0,
      promotedClipIds: [],
      referenceSampleCount: 0,
      plannerSampleCount: count,
      intervals: [],
    },
    splice: null,
  };
}

/**
 * Samples the planner and, when an imported layer is present, splices the
 * imported authority into it — producing the single effective trajectory set.
 */
export function sampleEffectiveTrajectorySet(
  plan: SamplablePlan,
  options: EffectiveSampleOptions,
): EffectiveTrajectoryResult {
  const reference = options.reference ?? null;
  const requested = options.sampleRate;
  const rate = reference
    ? effectiveSampleRate(requested, reference.layer.positionRateHz)
    : requested;
  const startTime = reference ? alignedStartTime(options.startTime, rate) : options.startTime;
  const plannerSet = sampleTrajectorySet(plan, {
    sampleRate: rate,
    startTime,
    duration: Math.max(0, options.endTime - startTime),
  });
  if (!reference) return plannerOnly(plannerSet, requested);

  const { show, layer } = reference;
  const intervals = resolveReferenceIntervals(layer);
  const positionTolerance = options.positionToleranceMeters ?? SPLICE_TOLERANCE_METERS;
  const velocityTolerance = options.velocityToleranceMps ?? SPLICE_VELOCITY_TOLERANCE_MPS;

  // Ownership is a property of TIME, so it is resolved once for the shared grid.
  const frameCount = plannerSet.drones[0]?.samples.length ?? 0;
  const referenceOwned: boolean[] = new Array(frameCount);
  for (let k = 0; k < frameCount; k += 1) {
    const t = startTime + k / rate;
    referenceOwned[k] = ownerAt(intervals, t)?.owner === "REFERENCE";
  }

  let referenceSampleCount = 0;
  let plannerSampleCount = 0;
  const drones: DroneTrajectory[] = plannerSet.drones.map((drone, index) => {
    const source = show.drones[index];
    if (!source) {
      plannerSampleCount += drone.samples.length;
      return drone;
    }
    const samples: TrajectorySample[] = drone.samples.map((sample, k) => {
      if (!referenceOwned[k]) {
        plannerSampleCount += 1;
        return sample;
      }
      referenceSampleCount += 1;
      const k9 = referenceKinematicsAt(source, sample.t, show.timing);
      return {
        t: sample.t,
        position: k9.position,
        velocity: k9.velocity,
        acceleration: k9.acceleration,
        jerk: k9.jerk,
        // The imported payload carries no heading: reported as unknown (0).
        yaw: 0,
        yawRate: 0,
      };
    });
    return { droneId: drone.droneId, samples };
  });

  const set: TrajectorySet = {
    droneCount: plannerSet.droneCount,
    duration: plannerSet.duration,
    ...(plannerSet.startTime !== undefined ? { startTime: plannerSet.startTime } : {}),
    sampleRate: plannerSet.sampleRate,
    drones,
    algorithmVersion: `${plannerSet.algorithmVersion}+essp-splice/${EFFECTIVE_AUTHORITY_VERSION}`,
  };

  let referenceSeconds = 0;
  let plannerSeconds = 0;
  let referenceIntervalCount = 0;
  let plannerIntervalCount = 0;
  for (const interval of intervals) {
    const span = Math.max(0, interval.end - interval.start);
    if (interval.owner === "REFERENCE") {
      referenceSeconds += span;
      referenceIntervalCount += 1;
    } else {
      plannerSeconds += span;
      plannerIntervalCount += 1;
    }
  }

  const authority: EffectiveTrajectoryAuthority = {
    kind: "SPLICED",
    version: EFFECTIVE_AUTHORITY_VERSION,
    referenceShowHash: layer.showHash,
    positionRateHz: layer.positionRateHz,
    sampleRate: rate,
    requestedSampleRate: requested,
    startTime,
    referenceSeconds,
    plannerSeconds,
    referenceIntervalCount,
    plannerIntervalCount,
    promotedClipIds: layer.bindings.filter((b) => b.owner === "PLANNER").map((b) => b.clipId),
    referenceSampleCount,
    plannerSampleCount,
    intervals,
  };

  const splice = verifySpliceContinuity(
    { show, layer },
    plannerSet,
    positionTolerance,
    velocityTolerance,
    (time, side) => {
      const constrained = plan.schedules.some((schedule) =>
        schedule.segments.some(
          (segment) =>
            segment.planned.plannerId.includes("boundary-velocity") &&
            Math.abs((side === "left" ? segment.end : segment.start) - time) <= 1e-6,
        ),
      );
      if (!constrained) return undefined;
      return plan.schedules.map((schedule, index) =>
        sampleScheduleBoundaryAt(
          schedule,
          plan.drones[index]?.homePosition ?? ([0, 0, 0] as Vector3Tuple),
          time,
          side,
        ),
      );
    },
  );

  return { set, plannerSet, authority, splice };
}

/**
 * Checks every instant where ownership changes. A splice is honest only when the
 * two authorities agree there on BOTH position and velocity; otherwise the show
 * would teleport or snap speed at the switch, and the analysis must block it.
 */
export function verifySpliceContinuity(
  reference: ReferenceAuthorityInput,
  plannerSet: TrajectorySet,
  positionToleranceMeters = SPLICE_TOLERANCE_METERS,
  velocityToleranceMps = SPLICE_VELOCITY_TOLERANCE_MPS,
  plannerBoundarySamples?: (
    time: number,
    side: "left" | "right",
  ) => readonly TrajectorySample[] | undefined,
): SpliceContinuityReport {
  const { show, layer } = reference;
  const intervals = resolveReferenceIntervals(layer);
  const rate = plannerSet.sampleRate;
  const start = plannerSet.startTime ?? 0;
  const boundaries: SpliceBoundaryContinuity[] = [];
  let worstPosition = 0;
  let worstVelocity = 0;

  for (let i = 1; i < intervals.length; i += 1) {
    const left = intervals[i - 1]!;
    const right = intervals[i]!;
    if (left.owner === right.owner) continue;
    const time = right.start;
    const frame = Math.round((time - start) * rate);
    const boundarySamples = plannerBoundarySamples?.(
      time,
      left.owner === "PLANNER" ? "left" : "right",
    );
    let maxPosition = 0;
    let maxVelocity = 0;
    let worstPositionDrone = -1;
    let worstVelocityDrone = -1;
    const droneCount = Math.min(show.drones.length, plannerSet.drones.length);
    for (let d = 0; d < droneCount; d += 1) {
      const planned = boundarySamples?.[d] ?? plannerSet.drones[d]?.samples[frame];
      const source = show.drones[d];
      if (!planned || !source) continue;
      const k9 = referenceKinematicsAt(source, time, show.timing);
      const dp = dist(k9.position, planned.position);
      const dv = dist(k9.velocity, planned.velocity);
      if (dp > maxPosition) {
        maxPosition = dp;
        worstPositionDrone = d;
      }
      if (dv > maxVelocity) {
        maxVelocity = dv;
        worstVelocityDrone = d;
      }
    }
    worstPosition = Math.max(worstPosition, maxPosition);
    worstVelocity = Math.max(worstVelocity, maxVelocity);
    boundaries.push({
      time,
      leftClipId: left.clipId,
      rightClipId: right.clipId,
      leftOwner: left.owner,
      rightOwner: right.owner,
      maxPositionDeltaMeters: maxPosition,
      worstPositionDroneIndex: worstPositionDrone,
      maxVelocityDeltaMps: maxVelocity,
      worstVelocityDroneIndex: worstVelocityDrone,
      ok: maxPosition <= positionToleranceMeters && maxVelocity <= velocityToleranceMps,
    });
  }

  return {
    ok: boundaries.every((b) => b.ok),
    positionToleranceMeters,
    velocityToleranceMps,
    boundaries,
    worstPositionDeltaMeters: worstPosition,
    worstVelocityDeltaMps: worstVelocity,
  };
}
