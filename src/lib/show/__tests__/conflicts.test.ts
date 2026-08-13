import { describe, expect, it } from "vitest";

import {
  buildConflictGroups,
  closestApproachOnInterval,
  detectConflicts,
  detectConflictsBruteForce,
} from "../conflicts";
import type { TrajectorySample, TrajectorySet } from "../trajectory";
import type { Vector3Tuple } from "../types";

const ZERO: Vector3Tuple = [0, 0, 0];

function sample(t: number, position: Vector3Tuple): TrajectorySample {
  return { t, position, velocity: ZERO, acceleration: ZERO, jerk: ZERO, yaw: 0, yawRate: 0 };
}

/** Builds a set from per-drone position functions sampled at `rate` Hz. */
function buildSet(
  paths: ((t: number) => Vector3Tuple)[],
  duration: number,
  rate: number,
): TrajectorySet {
  const frames = Math.round(duration * rate) + 1;
  return {
    droneCount: paths.length,
    duration,
    sampleRate: rate,
    algorithmVersion: "test",
    drones: paths.map((p, i) => ({
      droneId: `DRN-${i + 1}`,
      samples: Array.from({ length: frames }, (_, k) => {
        const t = k / rate;
        return sample(t, p(t));
      }),
    })),
  };
}

describe("closestApproachOnInterval", () => {
  it("finds a between-sample crossing that endpoint checks miss", () => {
    // Two drones swap positions along X over 1 s: at both endpoints they are
    // 10 m apart, but at t = 0.5 s they occupy the same point.
    const a0: Vector3Tuple = [-5, 20, 0];
    const a1: Vector3Tuple = [5, 20, 0];
    const b0: Vector3Tuple = [5, 20, 0];
    const b1: Vector3Tuple = [-5, 20, 0];
    const ca = closestApproachOnInterval(a0, a1, b0, b1, 0, 1);
    expect(ca.distance).toBeCloseTo(0, 6);
    expect(ca.t).toBeCloseTo(0.5, 6);
  });

  it("returns the endpoint distance for parallel motion", () => {
    const ca = closestApproachOnInterval([0, 20, 0], [10, 20, 0], [0, 20, 4], [10, 20, 4], 3, 1);
    expect(ca.distance).toBeCloseTo(4, 6);
    expect(ca.t).toBeGreaterThanOrEqual(3);
  });
});

describe("detectConflicts", () => {
  it("detects a head-on swap even at a coarse sample rate", () => {
    const set = buildSet(
      [(t) => [-5 + 10 * t, 20, 0], (t) => [5 - 10 * t, 20, 0]],
      1,
      2, // 2 Hz: no sample is closer than 5 m
    );
    const report = detectConflicts(set, { minSeparation: 2.5 });
    expect(report.conflictCount).toBeGreaterThan(0);
    expect(report.conflicts[0]!.minDistance).toBeLessThan(2.5);
    expect(report.metrics.minimumSeparation).toBeLessThan(2.5);
  });

  it("reports no conflict for well-separated parallel paths", () => {
    const set = buildSet([(t) => [t * 10, 20, 0], (t) => [t * 10, 20, 12]], 4, 10);
    expect(detectConflicts(set, { minSeparation: 2.5 }).conflictCount).toBe(0);
  });

  it("matches the brute-force detector exactly", () => {
    const paths = Array.from({ length: 24 }, (_, i) => (t: number): Vector3Tuple => {
      const angle = (i / 24) * Math.PI * 2;
      const r = 30 - 25 * t; // everyone converges on the centre
      return [Math.cos(angle) * r, 25, Math.sin(angle) * r];
    });
    const set = buildSet(paths, 1, 20);
    const fast = detectConflicts(set, { minSeparation: 3 });
    const slow = detectConflictsBruteForce(set, { minSeparation: 3 });
    expect(fast.conflictCount).toBe(slow.conflictCount);
    expect(fast.criticalCount).toBe(slow.criticalCount);
    expect(fast.metrics.minimumSeparation).toBeCloseTo(slow.metrics.minimumSeparation, 6);
  });

  it("groups transitively conflicting drones", () => {
    const groups = buildConflictGroups([
      {
        id: "a",
        droneA: "DRN-1",
        droneB: "DRN-2",
        indexA: 0,
        indexB: 1,
        startTime: 0,
        endTime: 1,
        timeOfClosestApproach: 0.5,
        minDistance: 1,
        requiredDistance: 3,
        severity: "critical",
        positionA: ZERO,
        positionB: ZERO,
      },
      {
        id: "b",
        droneA: "DRN-2",
        droneB: "DRN-3",
        indexA: 1,
        indexB: 2,
        startTime: 0,
        endTime: 1,
        timeOfClosestApproach: 0.5,
        minDistance: 1,
        requiredDistance: 3,
        severity: "warning",
        positionA: ZERO,
        positionB: ZERO,
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.indices).toEqual([0, 1, 2]);
  });
});
