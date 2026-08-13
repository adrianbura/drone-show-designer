/**
 * CONTINUITY VALIDATOR — proves the composed show is one physically coherent
 * trajectory per drone rather than a set of clips glued together.
 *
 * Checks: monotonic and uniformly spaced timestamps, no duplicate or missing
 * samples, no position teleports between samples or across clip boundaries,
 * every drone present exactly once, and every drone landed on its own pad.
 */
import type { DroneDefinition } from "../drones";
import type { TrajectorySet } from "../trajectory/types";
import type { SafetyLimits, Vector3Tuple } from "../types";
import type { ContinuityIssue, ContinuityReport, FullShowPlan } from "./types";

const dist = (a: Vector3Tuple, b: Vector3Tuple) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface ContinuityOptions {
  readonly limits: SafetyLimits;
  readonly drones: readonly DroneDefinition[];
  /** Absolute clip boundary times used for boundary-specific reporting. */
  readonly boundaries?: readonly number[];
  /** Additional slack over maxVelocity * dt (metres). Default 0.25. */
  readonly positionMargin?: number;
  readonly maxIssues?: number;
}

export function validateContinuity(
  set: TrajectorySet,
  options: ContinuityOptions,
): ContinuityReport {
  const maxIssues = options.maxIssues ?? 500;
  const issues: ContinuityIssue[] = [];
  const dt = 1 / Math.max(1e-9, set.sampleRate);
  // A sample step may legitimately reach maxVelocity * dt; anything beyond that
  // plus a small numeric margin is a discontinuity, not motion.
  const tolerance = options.limits.maxVelocity * dt * 1.5 + (options.positionMargin ?? 0.25);
  const boundaries = options.boundaries ?? [];
  const boundarySet = new Set(boundaries.map((b) => Math.round(b * set.sampleRate)));

  let checkedSamples = 0;
  let maxJump = 0;
  let maxBoundaryGap = 0;
  let landedCount = 0;
  let wrongPadCount = 0;

  const push = (issue: ContinuityIssue) => {
    if (issues.length < maxIssues) issues.push(issue);
  };

  const seenIds = new Set<string>();
  for (const [index, drone] of set.drones.entries()) {
    const expectedId = options.drones[index]?.id;
    if (expectedId && drone.droneId !== expectedId) {
      push({
        droneId: drone.droneId,
        droneIndex: index,
        time: 0,
        type: "DRONE_ID_MISMATCH",
        magnitude: 0,
        tolerance: 0,
      });
    }
    if (seenIds.has(drone.droneId)) {
      push({
        droneId: drone.droneId,
        droneIndex: index,
        time: 0,
        type: "MISSING_DRONE",
        magnitude: 0,
        tolerance: 0,
      });
    }
    seenIds.add(drone.droneId);

    const samples = drone.samples;
    checkedSamples += samples.length;
    if (samples.length === 0) {
      push({
        droneId: drone.droneId,
        droneIndex: index,
        time: 0,
        type: "MISSING_DRONE",
        magnitude: 0,
        tolerance: 0,
      });
      continue;
    }

    for (let k = 1; k < samples.length; k++) {
      const prev = samples[k - 1]!;
      const cur = samples[k]!;
      const gap = cur.t - prev.t;
      if (gap <= 0) {
        push({
          droneId: drone.droneId,
          droneIndex: index,
          time: cur.t,
          type: gap === 0 ? "DUPLICATE_TIMESTAMP" : "NON_MONOTONIC_TIME",
          magnitude: gap,
          tolerance: dt,
        });
      } else if (Math.abs(gap - dt) > dt * 1e-3) {
        push({
          droneId: drone.droneId,
          droneIndex: index,
          time: cur.t,
          type: gap > dt ? "TIME_GAP" : "TIME_OVERLAP",
          magnitude: gap,
          tolerance: dt,
        });
      }

      const jump = dist(prev.position, cur.position);
      if (jump > maxJump) maxJump = jump;
      const onBoundary = boundarySet.has(k) || boundarySet.has(k - 1);
      if (onBoundary && jump > maxBoundaryGap) maxBoundaryGap = jump;
      if (jump > tolerance) {
        push({
          droneId: drone.droneId,
          droneIndex: index,
          time: cur.t,
          type: "POSITION_DISCONTINUITY",
          magnitude: jump,
          tolerance,
        });
      }
    }

    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    if (Math.abs(first.t) > dt * 0.5) {
      push({
        droneId: drone.droneId,
        droneIndex: index,
        time: first.t,
        type: "COVERAGE_GAP",
        magnitude: first.t,
        tolerance: dt,
      });
    }
    if (last.t < set.duration - dt * 1.5) {
      push({
        droneId: drone.droneId,
        droneIndex: index,
        time: last.t,
        type: "COVERAGE_GAP",
        magnitude: set.duration - last.t,
        tolerance: dt,
      });
    }

    const home = options.drones[index]?.homePosition;
    const landed = last.position[1] <= 0.35;
    if (landed) landedCount++;
    else {
      push({
        droneId: drone.droneId,
        droneIndex: index,
        time: last.t,
        type: "NOT_LANDED",
        magnitude: last.position[1],
        tolerance: 0.35,
      });
    }
    if (home) {
      const padError = Math.hypot(last.position[0] - home[0], last.position[2] - home[2]);
      if (padError > 1) {
        wrongPadCount++;
        push({
          droneId: drone.droneId,
          droneIndex: index,
          time: last.t,
          type: "WRONG_HOME_PAD",
          magnitude: padError,
          tolerance: 1,
        });
      }
    }
  }

  if (set.drones.length !== options.drones.length) {
    push({
      droneId: "-",
      droneIndex: -1,
      time: 0,
      type: "MISSING_DRONE",
      magnitude: Math.abs(set.drones.length - options.drones.length),
      tolerance: 0,
    });
  }

  return {
    ok: issues.length === 0,
    checkedDrones: set.drones.length,
    checkedSamples,
    maxPositionDiscontinuity: maxJump,
    maxSegmentBoundaryGap: maxBoundaryGap,
    issues,
    landedCount,
    wrongPadCount,
    positionTolerance: tolerance,
  };
}

/** Clip/segment boundary times of a composed plan (for boundary reporting). */
export function segmentBoundaries(plan: FullShowPlan): number[] {
  const set = new Set<number>();
  for (const seg of plan.segments) {
    set.add(seg.start);
    set.add(seg.end);
  }
  return [...set].sort((a, b) => a - b);
}
