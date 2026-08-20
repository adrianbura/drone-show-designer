import { describe, expect, it } from "vitest";
import {
  VERTICAL_STACK_ANALYSIS_DEFAULTS,
  analyzePointCloudGeometry,
  analyzeTrajectoryVerticalStackRisk,
  analyzeVerticalStackRisk,
} from "../diagnostics";
import type { Vector3Tuple } from "../types";
import type { TrajectorySet, TrajectorySample } from "../trajectory/types";

const P = (x: number, y: number, z: number): Vector3Tuple => [x, y, z];

describe("vertical stack risk — pair metric", () => {
  it("detects an exact vertical column", () => {
    const r = analyzeVerticalStackRisk([P(0, 10, 0), P(0, 20, 0)]);
    expect(r.candidatePairCount).toBe(1);
    expect(r.worstPair!.horizontalDistanceXZ).toBe(0);
    expect(r.worstPair!.verticalDistance).toBe(10);
    expect(r.worstPair!.distance3D).toBe(10);
    expect(r.worstPair!.upperIndex).toBe(1);
  });

  it("detects a near column inside the horizontal threshold", () => {
    const r = analyzeVerticalStackRisk([P(0, 10, 0), P(1.2, 16, 0.5)], {
      horizontalThresholdMeters: 2,
    });
    expect(r.candidatePairCount).toBe(1);
    expect(r.worstPair!.horizontalDistanceXZ).toBeCloseTo(Math.hypot(1.2, 0.5), 9);
  });

  it("does not flag a horizontally separated pair", () => {
    const r = analyzeVerticalStackRisk([P(0, 10, 0), P(20, 30, 0)]);
    expect(r.candidatePairCount).toBe(0);
    expect(r.worstPair).toBeNull();
    expect(r.minHorizontalAmongVerticallySeparated).toBeCloseTo(20, 9);
  });

  it("does not classify a same-altitude pair as a vertical stack", () => {
    const r = analyzeVerticalStackRisk([P(0, 10, 0), P(0.3, 10, 0)]);
    expect(r.candidatePairCount).toBe(0);
    expect(r.minHorizontalAmongVerticallySeparated).toBe(Infinity);
  });

  it("orders candidates deterministically (tightest horizontal first)", () => {
    const pts = [P(0, 0, 0), P(1.5, 5, 0), P(0.2, 9, 0), P(0.9, 14, 0)];
    const a = analyzeVerticalStackRisk(pts);
    const b = analyzeVerticalStackRisk([...pts]);
    const key = (r: typeof a) => r.candidates.map((c) => `${c.indexA}-${c.indexB}`).join("|");
    expect(key(a)).toBe(key(b));
    const h = a.candidates.map((c) => c.horizontalDistanceXZ);
    expect([...h].sort((x, y) => x - y)).toEqual(h);
  });

  it("is translation invariant", () => {
    const pts = [P(0, 10, 0), P(1, 18, 0.4), P(9, 12, 3)];
    const moved = pts.map((p) => P(p[0] + 137, p[1] + 41, p[2] - 77));
    const a = analyzeVerticalStackRisk(pts);
    const b = analyzeVerticalStackRisk(moved);
    expect(b.candidatePairCount).toBe(a.candidatePairCount);
    expect(b.worstPair!.horizontalDistanceXZ).toBeCloseTo(a.worstPair!.horizontalDistanceXZ, 9);
    expect(b.worstPair!.verticalDistance).toBeCloseTo(a.worstPair!.verticalDistance, 9);
  });

  it("documents the rotation caveat: world vertical Y is intentional", () => {
    // A column along +Y is a stack; the SAME pair rotated onto the X axis is not.
    const column = analyzeVerticalStackRisk([P(0, 0, 0), P(0, 8, 0)]);
    const rotated = analyzeVerticalStackRisk([P(0, 0, 0), P(8, 0, 0)]);
    expect(column.candidatePairCount).toBe(1);
    expect(rotated.candidatePairCount).toBe(0);
  });

  it("never mutates its input", () => {
    const pts = [P(0, 10, 0), P(0, 20, 0), P(5, 30, 5)];
    const snapshot = JSON.stringify(pts);
    analyzeVerticalStackRisk(pts);
    analyzePointCloudGeometry(pts);
    expect(JSON.stringify(pts)).toBe(snapshot);
  });

  it("exposes analysis defaults as labelled analysis values only", () => {
    expect(VERTICAL_STACK_ANALYSIS_DEFAULTS.horizontalThresholdMeters).toBeGreaterThan(0);
    const r = analyzeVerticalStackRisk([]);
    expect(r.note).toMatch(/not a safety limit/i);
  });
});

describe("point cloud geometry — depth / tilt evidence", () => {
  it("measures scene depth extent without flattening Z", () => {
    const pts = [P(-10, 20, -6), P(10, 20, 6), P(0, 25, 0)];
    const g = analyzePointCloudGeometry(pts);
    expect(g.extentX).toBe(20);
    expect(g.extentZ).toBe(12);
    expect(g.extentY).toBe(5);
    expect(g.depthSpread).toBeGreaterThan(0);
  });

  it("finds a level plane for a flat vertical wall facing the audience", () => {
    const pts: Vector3Tuple[] = [];
    for (let x = -5; x <= 5; x++) for (let y = 10; y <= 20; y += 2) pts.push(P(x, y, 0));
    const g = analyzePointCloudGeometry(pts);
    expect(Math.abs(g.depthHeightCorrelation)).toBeLessThan(1e-6);
    expect(g.planeNormal).not.toBeNull();
    expect(g.planeResidualRms!).toBeLessThan(1e-9);
  });

  it("detects a tilted formation plane through depth-height correlation", () => {
    const pts: Vector3Tuple[] = [];
    for (let x = -5; x <= 5; x++)
      for (let k = 0; k <= 5; k++) pts.push(P(x, 20 + k, k * 0.5)); // leaning back
    const g = analyzePointCloudGeometry(pts);
    expect(g.depthHeightCorrelation).toBeGreaterThan(0.9);
    expect(g.planeTiltDegrees!).toBeGreaterThan(1);
  });
});

function makeSet(tracks: Vector3Tuple[][], rate = 1): TrajectorySet {
  const zero: Vector3Tuple = [0, 0, 0];
  return {
    droneCount: tracks.length,
    duration: (tracks[0]!.length - 1) / rate,
    startTime: 0,
    sampleRate: rate,
    algorithmVersion: "test",
    drones: tracks.map((positions, i) => ({
      droneId: `d${i}`,
      samples: positions.map<TrajectorySample>((position, k) => ({
        t: k / rate,
        position,
        velocity: zero,
        acceleration: zero,
        jerk: zero,
        yaw: 0,
        yawRate: 0,
      })),
    })),
  };
}

describe("trajectory sampled vertical stack analysis", () => {
  it("reports first/last/worst risk times and affected pairs", () => {
    const a = [P(0, 10, 0), P(0, 10, 0), P(0, 10, 0), P(0, 10, 0)];
    const b = [P(30, 30, 0), P(0.5, 30, 0), P(0, 30, 0), P(30, 30, 0)];
    const set = makeSet([a, b], 1);
    const r = analyzeTrajectoryVerticalStackRisk(set, { analysisSampleRateHz: 1 });
    expect(r.framesAnalyzed).toBe(4);
    expect(r.framesWithCandidates).toBe(2);
    expect(r.firstRiskTime).toBe(1);
    expect(r.lastRiskTime).toBe(2);
    expect(r.worstTime).toBe(2);
    expect(r.affectedPairCount).toBe(1);
    expect(r.framePercentWithCandidates).toBeCloseTo(50, 9);
    expect(r.limitation).toMatch(/SAMPLED-TIME/);
  });

  it("returns no risk times for a horizontally spread show", () => {
    const set = makeSet([
      [P(0, 10, 0), P(0, 12, 0)],
      [P(40, 20, 0), P(40, 22, 0)],
    ]);
    const r = analyzeTrajectoryVerticalStackRisk(set, { analysisSampleRateHz: 1 });
    expect(r.firstRiskTime).toBeNull();
    expect(r.worstPair).toBeNull();
  });

  it("never mutates the trajectory set", () => {
    const set = makeSet([
      [P(0, 10, 0), P(0, 10, 0)],
      [P(0, 20, 0), P(0, 20, 0)],
    ]);
    const snapshot = JSON.stringify(set);
    analyzeTrajectoryVerticalStackRisk(set);
    expect(JSON.stringify(set)).toBe(snapshot);
  });
});
