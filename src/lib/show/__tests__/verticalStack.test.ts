import { describe, expect, it } from "vitest";

import type { TrajectorySet } from "../trajectory/types";
import type { Vector3Tuple } from "../types";
import {
  analyzeVerticalStackRisk,
  analyzeVerticalStackTrajectory,
  sceneGeometryExtent,
} from "../verticalStack";

const v = (x: number, y: number, z: number): Vector3Tuple => [x, y, z];

function setOf(frames: readonly Vector3Tuple[][]): TrajectorySet {
  const sampleRate = 2;
  const drones = frames[0]!.map((_, droneIndex) => ({
    droneId: `D${droneIndex + 1}`,
    samples: frames.map((frame, k) => ({
      t: k / sampleRate,
      position: frame[droneIndex]!,
      velocity: v(0, 0, 0),
      acceleration: v(0, 0, 0),
      jerk: v(0, 0, 0),
      yaw: 0,
      yawRate: 0,
    })),
  }));
  return {
    droneCount: drones.length,
    duration: Math.max(0, (frames.length - 1) / sampleRate),
    sampleRate,
    drones,
    algorithmVersion: "test",
  };
}

describe("vertical stack static analysis", () => {
  it("detects an exact vertical column", () => {
    const report = analyzeVerticalStackRisk([v(0, 10, 0), v(0, 12, 0)]);
    expect(report.candidateCount).toBe(1);
    expect(report.worst?.horizontalDistance).toBe(0);
    expect(report.worst?.verticalDistance).toBe(2);
    expect(report.worst?.distance3d).toBe(2);
  });

  it("detects a near column within the horizontal analysis threshold", () => {
    const report = analyzeVerticalStackRisk([v(0, 10, 0), v(0.6, 12, 0.2)], {
      maxHorizontalDistance: 0.8,
      minVerticalDistance: 0.5,
    });
    expect(report.candidateCount).toBe(1);
    expect(report.worst?.horizontalDistance).toBeCloseTo(Math.hypot(0.6, 0.2));
  });

  it("does not classify a horizontally separated pair", () => {
    expect(analyzeVerticalStackRisk([v(0, 10, 0), v(2, 12, 0)]).candidateCount).toBe(0);
  });

  it("does not classify same-altitude neighbours as vertical stacking", () => {
    expect(analyzeVerticalStackRisk([v(0, 10, 0), v(0.2, 10, 0.1)]).candidateCount).toBe(0);
  });

  it("is deterministic and translation invariant", () => {
    const a = [v(0, 10, 0), v(0.4, 13, 0.1), v(0.2, 15, 0.2)];
    const shifted = a.map(([x, y, z]) => v(x + 100, y - 7, z + 50));
    const one = analyzeVerticalStackRisk(a);
    const two = analyzeVerticalStackRisk(shifted);
    expect(one.candidates.map((p) => [p.indexA, p.indexB])).toEqual(
      two.candidates.map((p) => [p.indexA, p.indexB]),
    );
    expect(one.candidates.map((p) => p.horizontalDistance)).toEqual(
      two.candidates.map((p) => p.horizontalDistance),
    );
  });

  it("never mutates input positions", () => {
    const points = [v(0, 10, 0), v(0, 12, 0)];
    const before = JSON.stringify(points);
    analyzeVerticalStackRisk(points);
    expect(JSON.stringify(points)).toBe(before);
  });
});

describe("scene geometry evidence", () => {
  it("reports depth extent and altitude-depth correlation", () => {
    const points = [v(-1, 10, 0), v(0, 11, 1), v(2, 12, 2)];
    const report = sceneGeometryExtent(points);
    expect(report.extentX).toBe(3);
    expect(report.extentY).toBe(2);
    expect(report.extentZ).toBe(2);
    expect(report.depthAltitudeCorrelation).toBeCloseTo(1);
  });

  it("returns null correlation for a flat-altitude or flat-depth scene", () => {
    expect(sceneGeometryExtent([v(0, 10, 0), v(1, 10, 2)]).depthAltitudeCorrelation).toBeNull();
  });
});

describe("vertical stack trajectory analysis", () => {
  it("reports sampled risk times and affected pairs", () => {
    const set = setOf([
      [v(0, 10, 0), v(2, 12, 0)],
      [v(0, 10, 0), v(0.2, 12, 0.1)],
      [v(0, 10, 0), v(0.1, 12, 0.1)],
      [v(0, 10, 0), v(2, 12, 0)],
    ]);
    const report = analyzeVerticalStackTrajectory(set);
    expect(report.framesChecked).toBe(4);
    expect(report.framesWithCandidates).toBe(2);
    expect(report.frameFractionWithCandidates).toBe(0.5);
    expect(report.firstRiskTime).toBe(0.5);
    expect(report.lastRiskTime).toBe(1);
    expect(report.affectedPairs).toEqual([[0, 1]]);
    expect(report.limitation).toBe("SAMPLED_TIMES_ONLY");
  });
});
