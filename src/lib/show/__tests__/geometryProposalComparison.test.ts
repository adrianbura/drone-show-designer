import { describe, expect, it } from "vitest";
import {
  compareGeometryProposal,
  optimizeProjectionPreservingStackProposal,
  type AudienceView,
} from "../diagnostics";
import type { Vector3Tuple } from "../types";

const view: AudienceView = {
  viewer: [0, 1.7, -100],
  target: [0, 20, 0],
};

const points: Vector3Tuple[] = [
  [0, 10, 0],
  [0.2, 15, 0.1],
  [12, 10, 0],
  [12.2, 16, 0.1],
];

describe("geometry proposal comparison", () => {
  it("reports preserved audience projection and deterministic before/after evidence", () => {
    const result = optimizeProjectionPreservingStackProposal(points, view, {
      amplitudesMeters: [1, 2],
      maxDisplacementMeters: 4,
    });
    expect(result.best).not.toBeNull();
    const comparison = compareGeometryProposal(points, view, result.best!);
    expect(comparison.pointCount).toBe(points.length);
    expect(comparison.candidatePairsBefore).toBeGreaterThan(0);
    expect(comparison.maxAudienceImageDriftMeters).toBeLessThan(1e-8);
    expect(comparison.rmsAudienceImageDriftMeters).toBeLessThan(1e-8);
    expect(comparison.maxDisplacementMeters).toBeLessThanOrEqual(4 + 1e-9);
  });

  it("does not mutate the original point cloud", () => {
    const before = JSON.stringify(points);
    const result = optimizeProjectionPreservingStackProposal(points, view, { amplitudesMeters: [1] });
    expect(result.best).not.toBeNull();
    compareGeometryProposal(points, view, result.best!);
    expect(JSON.stringify(points)).toBe(before);
  });

  it("rejects mismatched proposal/original counts", () => {
    const result = optimizeProjectionPreservingStackProposal(points, view, { amplitudesMeters: [1] });
    const candidate = result.best!;
    const bad = {
      ...candidate,
      proposal: { ...candidate.proposal, moves: candidate.proposal.moves.slice(1) },
    };
    expect(() => compareGeometryProposal(points, view, bad)).toThrow(/count mismatch/);
  });
});
