import { describe, expect, it } from "vitest";

import {
  analyzeAudienceProjection,
  audienceViewBasis,
  projectPointForAudience,
  AudienceProjectionError,
} from "../diagnostics/audienceProjection";
import type { Vector3Tuple } from "../types";

const P = (x: number, y: number, z: number): Vector3Tuple => [x, y, z];
const VIEW = { viewer: P(0, 0, -100), target: P(0, 0, 0), up: P(0, 1, 0) };

describe("audience projection basis", () => {
  it("keeps +X screen-right and +Y screen-up for the canonical front view", () => {
    const b = audienceViewBasis(VIEW);
    expect(b.forward[0]).toBeCloseTo(0, 12);
    expect(b.forward[1]).toBeCloseTo(0, 12);
    expect(b.forward[2]).toBeCloseTo(1, 12);
    expect(b.right[0]).toBeCloseTo(1, 12);
    expect(b.up[1]).toBeCloseTo(1, 12);
    expect(b.targetDistance).toBeCloseTo(100, 12);
  });

  it("rejects degenerate viewer/target and parallel up vectors", () => {
    expect(() => audienceViewBasis({ viewer: P(1, 2, 3), target: P(1, 2, 3) })).toThrow(
      AudienceProjectionError,
    );
    expect(() =>
      audienceViewBasis({ viewer: P(0, 0, 0), target: P(0, 1, 0), up: P(0, 1, 0) }),
    ).toThrow(AudienceProjectionError);
  });
});

describe("audience perspective projection", () => {
  it("matches orthographic coordinates exactly on the target plane", () => {
    const points = [P(-20, -10, 0), P(20, -10, 0), P(20, 10, 0), P(-20, 10, 0)];
    const r = analyzeAudienceProjection(points, VIEW);
    expect(r.projectedCount).toBe(4);
    expect(r.depthExtent).toBeCloseTo(0, 12);
    expect(r.maxApparentDeviation).toBeCloseTo(0, 12);
    expect(r.rmsApparentDeviation).toBeCloseTo(0, 12);
    expect(r.perspectiveExtent[0]).toBeCloseTo(40, 12);
    expect(r.perspectiveExtent[1]).toBeCloseTo(20, 12);
    expect(r.orthographicExtent).toEqual(r.perspectiveExtent);
  });

  it("makes nearer points appear larger and farther points appear smaller", () => {
    const near = projectPointForAudience(P(10, 0, -20), VIEW)!;
    const target = projectPointForAudience(P(10, 0, 0), VIEW)!;
    const far = projectPointForAudience(P(10, 0, 20), VIEW)!;
    expect(near.perspectiveScale).toBeGreaterThan(1);
    expect(target.perspectiveScale).toBeCloseTo(1, 12);
    expect(far.perspectiveScale).toBeLessThan(1);
    expect(near.perspective[0]).toBeGreaterThan(target.perspective[0]);
    expect(far.perspective[0]).toBeLessThan(target.perspective[0]);
  });

  it("reports apparent deviation caused by depth staggering without changing geometry", () => {
    const points = [P(-20, 0, -10), P(20, 0, 10)];
    const before = JSON.stringify(points);
    const r = analyzeAudienceProjection(points, VIEW);
    expect(r.depthExtent).toBeCloseTo(20, 12);
    expect(r.maxApparentDeviation).toBeGreaterThan(0);
    expect(r.minPerspectiveScale).toBeLessThan(1);
    expect(r.maxPerspectiveScale).toBeGreaterThan(1);
    expect(JSON.stringify(points)).toBe(before);
  });

  it("is invariant when viewer, target and geometry are translated together", () => {
    const points = [P(-5, 3, -7), P(12, -4, 11), P(0, 8, 3)];
    const shift = P(37, 22, -19);
    const moved = (p: Vector3Tuple): Vector3Tuple => [
      p[0] + shift[0],
      p[1] + shift[1],
      p[2] + shift[2],
    ];
    const a = analyzeAudienceProjection(points, VIEW);
    const b = analyzeAudienceProjection(points.map(moved), {
      viewer: moved(VIEW.viewer),
      target: moved(VIEW.target),
      up: VIEW.up,
    });
    expect(b.depthExtent).toBeCloseTo(a.depthExtent, 10);
    expect(b.rmsApparentDeviation).toBeCloseTo(a.rmsApparentDeviation, 10);
    expect(b.maxApparentDeviation).toBeCloseTo(a.maxApparentDeviation, 10);
    expect(b.perspectiveExtent[0]).toBeCloseTo(a.perspectiveExtent[0], 10);
    expect(b.perspectiveExtent[1]).toBeCloseTo(a.perspectiveExtent[1], 10);
  });

  it("excludes points at or behind the viewer and reports them as invalid", () => {
    const r = analyzeAudienceProjection([P(0, 0, -100), P(0, 0, -120), P(0, 0, 0)], VIEW);
    expect(r.pointCount).toBe(3);
    expect(r.projectedCount).toBe(1);
    expect(r.invalidCount).toBe(2);
  });

  it("keeps deterministic input ordering and max-deviation identity", () => {
    const points = [P(1, 0, 0), P(20, 0, -30), P(-5, 0, 20)];
    const a = analyzeAudienceProjection(points, VIEW);
    const b = analyzeAudienceProjection([...points], VIEW);
    expect(a.points.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(a.points).toEqual(b.points);
    expect(a.maxDeviationIndex).toBe(b.maxDeviationIndex);
  });
});
