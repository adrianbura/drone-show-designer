import { describe, expect, it } from "vitest";

import type { DroneDefinition } from "../drones";
import { detectConflicts } from "../conflicts";
import {
  analyzeTransition,
  assessDurationFeasibility,
  estimateMinimumDuration,
  optimizeTransition,
  type TransitionInput,
} from "../transition";
import type { SafetyLimits, Vector3Tuple } from "../types";

const LIMITS: SafetyLimits = {
  maxVelocity: 12,
  maxAcceleration: 6,
  maxJerk: 12,
  maxYawRate: 120,
  minSeparation: 2.5,
  minAltitude: 5,
  maxAltitude: 95,
};

function drones(n: number): DroneDefinition[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `DRN-${String(i + 1).padStart(3, "0")}`,
    index: i,
    homePosition: [i * 3, 0, 0] as Vector3Tuple,
  }));
}

/** Ring of n drones, all facing the diametrically opposite slot: worst case. */
function ring(n: number, radius: number, y: number): Vector3Tuple[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * radius, y, Math.sin(a) * radius] as Vector3Tuple;
  });
}

function crossingInput(n = 16, duration = 10): TransitionInput {
  const source = ring(n, 30, 30);
  // Target is the same ring rotated by half a step -> maximum path crossing.
  const target = source.map((_, i) => {
    const a = ((i + n / 2) / n) * Math.PI * 2;
    return [Math.cos(a) * 30, 30, Math.sin(a) * 30] as Vector3Tuple;
  });
  return {
    drones: drones(n),
    source,
    target,
    duration,
    limits: LIMITS,
    strategy: "optimalDistance",
    easing: "minJerk",
    sampleRate: 25,
    startTime: 0,
    clipId: "c-test",
  };
}

describe("duration feasibility", () => {
  it("flags an impossible duration and names the limiting metric", () => {
    const estimate = estimateMinimumDuration(200, LIMITS);
    expect(estimate.duration).toBeGreaterThan(0);
    const result = assessDurationFeasibility(
      [{ droneId: "DRN-001", distance: 200 }],
      1,
      LIMITS,
    );
    expect(result.feasible).toBe(false);
    expect(result.worstDroneId).toBe("DRN-001");
    expect(["velocity", "acceleration", "jerk"]).toContain(result.limitingMetric);
    expect(result.minimumEstimatedDuration).toBeGreaterThan(1);
  });

  it("accepts a generous duration", () => {
    const result = assessDurationFeasibility([{ droneId: "DRN-001", distance: 20 }], 60, LIMITS);
    expect(result.feasible).toBe(true);
    expect(result.limitingMetric).toBe("none");
  });
});

describe("transition analysis", () => {
  it("reports conflicts for a fully crossing ring transition", () => {
    const analysis = analyzeTransition(crossingInput());
    expect(analysis.metrics.droneCount).toBe(16);
    expect(analysis.metrics.conflictCount).toBeGreaterThan(0);
    expect(analysis.metrics.potentialGeometricCrossings).toBeGreaterThan(0);
    expect(analysis.timeBase).toBe("transition-relative");
  });

  it("is deterministic: identical input yields identical metrics", () => {
    const a = analyzeTransition(crossingInput());
    const b = analyzeTransition(crossingInput());
    expect(b.metrics.score).toBe(a.metrics.score);
    expect(b.metrics.totalTravelDistance).toBe(a.metrics.totalTravelDistance);
    expect(b.dronePlans.map((p) => p.targetPointIndex)).toEqual(
      a.dronePlans.map((p) => p.targetPointIndex),
    );
  });
});

describe("transition optimizer", () => {
  it("never worsens the score and reports resolved only at zero conflicts", () => {
    const result = optimizeTransition(crossingInput());
    expect(result.final.metrics.score).toBeLessThanOrEqual(result.initial.metrics.score + 1e-9);
    if (result.status === "resolved") {
      expect(result.final.metrics.conflictCount).toBe(0);
    } else {
      expect(result.final.metrics.conflictCount).toBeGreaterThan(0);
    }
    expect(result.iterations).toBeLessThanOrEqual(result.settings.maxIterations);
  });

  it("reduces critical conflicts on a crossing transition", () => {
    const result = optimizeTransition(crossingInput(24, 12));
    expect(result.final.metrics.criticalConflictCount).toBeLessThanOrEqual(
      result.initial.metrics.criticalConflictCount,
    );
  });

  it("independently re-detects the reported final conflict count", () => {
    const result = optimizeTransition(crossingInput());
    const recheck = detectConflicts(result.final.trajectorySet, {
      minSeparation: LIMITS.minSeparation,
    });
    expect(recheck.conflictCount).toBe(result.final.metrics.conflictCount);
  });

  it("is deterministic across repeated runs", () => {
    const a = optimizeTransition(crossingInput());
    const b = optimizeTransition(crossingInput());
    expect(b.status).toBe(a.status);
    expect(b.iterations).toBe(a.iterations);
    expect(b.final.metrics.score).toBe(a.final.metrics.score);
    expect(b.appliedStrategies).toEqual(a.appliedStrategies);
  });

  it("respects the cancellation probe", () => {
    const result = optimizeTransition(crossingInput(), undefined, { isCancelled: () => true });
    expect(result.status).toBe("cancelled");
  });

  it("keeps stagger and lane offsets bounded", () => {
    const input = crossingInput();
    const result = optimizeTransition(input);
    for (const p of result.final.dronePlans) {
      expect(p.startOffset).toBeGreaterThanOrEqual(0);
      expect(p.startOffset).toBeLessThanOrEqual(input.duration * 0.5 + 1e-9);
      expect(Math.abs(p.lane.offsetMetres)).toBeLessThanOrEqual(
        result.settings.maxLaneIndex * result.settings.laneSpacing + 1e-9,
      );
      expect(p.to[1] + p.lane.offsetMetres).toBeLessThanOrEqual(LIMITS.maxAltitude + 1e-6);
    }
  });

  it("handles a 200-drone transition within a bounded budget", () => {
    const result = optimizeTransition(crossingInput(200, 14));
    expect(result.final.metrics.droneCount).toBe(200);
    expect(result.totalMs).toBeLessThan(60000);
  }, 120000);
});
