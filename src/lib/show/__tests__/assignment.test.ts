import { describe, expect, it } from "vitest";

import {
  applyAssignment,
  compareAssignmentStrategies,
  runAssignment,
  type AssignmentInput,
} from "../assignment";
import { solveLinearAssignment } from "../hungarian";
import type { DroneDefinition } from "../drones";
import type { Vector3Tuple } from "../types";

function drones(n: number): DroneDefinition[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `DRN-${String(i + 1).padStart(3, "0")}`,
    index: i,
    homePosition: [i * 3, 0, 0] as Vector3Tuple,
  }));
}

/** Deterministic pseudo-random cloud (no Math.random anywhere in tests). */
function cloud(n: number, seed: number, spread = 60): Vector3Tuple[] {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  return Array.from(
    { length: n },
    () => [next() * spread, 20 + next() * spread, next() * spread] as Vector3Tuple,
  );
}

function totalDistance(source: readonly Vector3Tuple[], target: readonly Vector3Tuple[]): number {
  return source.reduce((sum, a, i) => {
    const b = target[i]!;
    return sum + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }, 0);
}

describe("hungarian solver", () => {
  it("finds the known optimum of a small hand-checked cost matrix", () => {
    // Optimal assignment is 0->1, 1->0, 2->2 with total cost 5.
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const result = solveLinearAssignment(cost);
    expect(result.totalCost).toBe(5);
    expect(result.assignment).toEqual([1, 0, 2]);
  });

  it("never exceeds the greedy total cost on random matrices", () => {
    for (const seed of [1, 7, 42]) {
      const n = 12;
      const source = cloud(n, seed);
      const target = cloud(n, seed + 1000);
      const cost = source.map((a) =>
        target.map((b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])),
      );
      const optimal = solveLinearAssignment(cost);
      // greedy row-by-row
      const taken = new Set<number>();
      let greedyCost = 0;
      for (let i = 0; i < n; i++) {
        let best = -1;
        let bestC = Infinity;
        for (let j = 0; j < n; j++) {
          if (taken.has(j)) continue;
          if (cost[i]![j]! < bestC) {
            bestC = cost[i]![j]!;
            best = j;
          }
        }
        taken.add(best);
        greedyCost += bestC;
      }
      expect(optimal.totalCost).toBeLessThanOrEqual(greedyCost + 1e-9);
      expect(new Set(optimal.assignment).size).toBe(n);
    }
  });

  it("is deterministic across repeated runs", () => {
    const source = cloud(40, 5);
    const target = cloud(40, 6);
    const cost = source.map((a) => target.map((b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
    const a = solveLinearAssignment(cost);
    const b = solveLinearAssignment(cost);
    expect(a.assignment).toEqual(b.assignment);
  });
});

describe("assignment strategies", () => {
  const n = 60;
  const input: AssignmentInput = {
    source: cloud(n, 11),
    target: cloud(n, 12),
    drones: drones(n),
  };

  it("produces a bijective assignment", () => {
    const result = runAssignment("optimalDistance", input);
    expect(result.assignments).toHaveLength(n);
    expect(new Set(result.assignments.map((a) => a.targetPointIndex)).size).toBe(n);
  });

  it("optimal total distance is never worse than greedy", () => {
    const comparison = compareAssignmentStrategies(input);
    expect(comparison.optimalDistance.metrics.totalDistance).toBeLessThanOrEqual(
      comparison.nearestNeighbor.metrics.totalDistance + 1e-6,
    );
    expect(comparison.totalDistanceImprovement).toBeGreaterThanOrEqual(0);
  });

  it("applyAssignment reproduces the reported total distance", () => {
    const result = runAssignment("optimalDistance", input);
    const targets = applyAssignment(result.assignments, input.target);
    expect(totalDistance(input.source, targets)).toBeCloseTo(result.metrics.totalDistance, 6);
  });

  it("solves 200 drones well under one second", () => {
    const big: AssignmentInput = { source: cloud(200, 21), target: cloud(200, 22), drones: drones(200) };
    const result = runAssignment("optimalDistance", big);
    expect(result.assignments).toHaveLength(200);
    expect(result.solverMs).toBeLessThan(1000);
  });
});
