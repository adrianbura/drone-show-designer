import { describe, expect, it } from "vitest";
import {
  movePointPreservingAudienceProjection,
  projectPointForAudience,
  proposeProjectionPreservingDepthDeltas,
  worldPointForAudienceImage,
  ProjectionPreservingGeometryError,
} from "../diagnostics";
import type { AudienceView } from "../diagnostics";
import type { Vector3Tuple } from "../types";

const VIEW: AudienceView = {
  viewer: [0, 2, -100],
  target: [0, 20, 0],
};

const P = (x: number, y: number, z: number): Vector3Tuple => [x, y, z];

describe("projection-preserving geometry proposal", () => {
  it("reconstructs a world point for an audience image coordinate", () => {
    const p = worldPointForAudienceImage([10, 5], 120, VIEW);
    const projected = projectPointForAudience(p, VIEW)!;
    expect(projected.perspective[0]).toBeCloseTo(10, 9);
    expect(projected.perspective[1]).toBeCloseTo(5, 9);
    expect(projected.distanceAlongView).toBeCloseTo(120, 9);
  });

  it("moves a point in depth while preserving its perspective coordinate", () => {
    const original = P(12, 28, 4);
    const before = projectPointForAudience(original, VIEW)!;
    const move = movePointPreservingAudienceProjection(
      original,
      before.distanceAlongView + 15,
      VIEW,
    );
    const after = projectPointForAudience(move.proposed, VIEW)!;
    expect(after.perspective[0]).toBeCloseTo(before.perspective[0], 9);
    expect(after.perspective[1]).toBeCloseTo(before.perspective[1], 9);
    expect(move.depthDelta).toBeCloseTo(15, 9);
    expect(move.displacement3D).toBeGreaterThan(0);
    expect(move.apparentError).toBeLessThan(1e-9);
  });

  it("zero delta is identity up to floating-point noise", () => {
    const original = P(-7, 31, 12);
    const before = projectPointForAudience(original, VIEW)!;
    const move = movePointPreservingAudienceProjection(original, before.distanceAlongView, VIEW);
    expect(move.proposed[0]).toBeCloseTo(original[0], 9);
    expect(move.proposed[1]).toBeCloseTo(original[1], 9);
    expect(move.proposed[2]).toBeCloseTo(original[2], 9);
  });

  it("applies explicit per-point deltas deterministically without mutating inputs", () => {
    const points = [P(-10, 20, 0), P(0, 25, 0), P(10, 30, 0)];
    const before = JSON.stringify(points);
    const a = proposeProjectionPreservingDepthDeltas(points, [-3, 0, 3], VIEW);
    const b = proposeProjectionPreservingDepthDeltas(points, [-3, 0, 3], VIEW);
    expect(JSON.stringify(points)).toBe(before);
    expect(a).toEqual(b);
    expect(a.moves.map((m) => m.depthDelta)).toEqual([-3, 0, 3]);
    expect(a.maxApparentError).toBeLessThan(1e-9);
  });

  it("preserves the audience silhouette for a depth-stagger proposal", () => {
    const points = [P(-15, 18, 0), P(0, 24, 0), P(15, 30, 0)];
    const before = points.map((p) => projectPointForAudience(p, VIEW)!.perspective);
    const proposal = proposeProjectionPreservingDepthDeltas(points, [-5, 0, 5], VIEW);
    proposal.moves.forEach((move, i) => {
      const after = projectPointForAudience(move.proposed, VIEW)!.perspective;
      expect(after[0]).toBeCloseTo(before[i]![0], 9);
      expect(after[1]).toBeCloseTo(before[i]![1], 9);
    });
  });

  it("rejects mismatched point and delta counts", () => {
    expect(() => proposeProjectionPreservingDepthDeltas([P(0, 10, 0)], [], VIEW)).toThrow(
      ProjectionPreservingGeometryError,
    );
  });

  it("rejects a requested depth at or behind the viewer", () => {
    expect(() => worldPointForAudienceImage([0, 0], 0, VIEW)).toThrow(
      ProjectionPreservingGeometryError,
    );
  });
});
