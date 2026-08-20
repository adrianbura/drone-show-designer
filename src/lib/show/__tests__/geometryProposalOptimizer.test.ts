import { describe, expect, it } from "vitest";
import {
  optimizeProjectionPreservingStackProposal,
  type AudienceView,
  projectPointForAudience,
} from "../diagnostics";
import type { Vector3Tuple } from "../types";

const V = (x: number, y: number, z: number): Vector3Tuple => [x, y, z];
const VIEW: AudienceView = { viewer: [0, 1.7, -100], target: [0, 20, 0] };

describe("geometry proposal optimizer", () => {
  it("returns no proposal when there is no vertical-stack candidate", () => {
    const r = optimizeProjectionPreservingStackProposal([V(-10, 10, 0), V(10, 20, 0)], VIEW);
    expect(r.before.candidatePairCount).toBe(0);
    expect(r.best).toBeNull();
    expect(r.improved).toBe(false);
  });

  it("deterministically proposes depth offsets for a vertical column", () => {
    const points = [V(0, 10, 0), V(0, 20, 0), V(0, 30, 0)];
    const a = optimizeProjectionPreservingStackProposal(points, VIEW, {
      amplitudesMeters: [0.5, 1, 2],
      maxDisplacementMeters: 5,
    });
    const b = optimizeProjectionPreservingStackProposal(points, VIEW, {
      amplitudesMeters: [0.5, 1, 2],
      maxDisplacementMeters: 5,
    });
    expect(a.best?.depthDeltas).toEqual(b.best?.depthDeltas);
    expect(a.best?.proposal.moves.map((m) => m.proposed)).toEqual(
      b.best?.proposal.moves.map((m) => m.proposed),
    );
  });

  it("preserves the exact audience projection for every proposed point", () => {
    const points = [V(0, 10, 0), V(0.4, 20, 0), V(-0.3, 30, 0)];
    const r = optimizeProjectionPreservingStackProposal(points, VIEW, {
      amplitudesMeters: [1, 2],
      maxDisplacementMeters: 10,
    });
    expect(r.best).not.toBeNull();
    for (const move of r.best!.proposal.moves) {
      const before = projectPointForAudience(move.original, VIEW)!;
      const after = projectPointForAudience(move.proposed, VIEW)!;
      expect(after.perspective[0]).toBeCloseTo(before.perspective[0], 9);
      expect(after.perspective[1]).toBeCloseTo(before.perspective[1], 9);
    }
    expect(r.best!.proposal.maxApparentError).toBeLessThan(1e-8);
  });

  it("never mutates the input points", () => {
    const points = [V(0, 10, 0), V(0, 20, 0)];
    const before = JSON.stringify(points);
    optimizeProjectionPreservingStackProposal(points, VIEW);
    expect(JSON.stringify(points)).toBe(before);
  });

  it("respects the proposal displacement cap", () => {
    const points = [V(0, 10, 0), V(0, 20, 0)];
    const r = optimizeProjectionPreservingStackProposal(points, VIEW, {
      amplitudesMeters: [5, 10],
      maxDisplacementMeters: 0.01,
    });
    expect(r.best).toBeNull();
    expect(r.candidates.every((c) => !c.acceptedByDisplacementCap)).toBe(true);
  });

  it("prefers fewer remaining stack candidates before smaller displacement", () => {
    const points = [V(0, 10, 0), V(0, 20, 0), V(0, 30, 0), V(0, 40, 0)];
    const r = optimizeProjectionPreservingStackProposal(points, VIEW, {
      amplitudesMeters: [0.2, 1, 3],
      maxDisplacementMeters: 10,
      horizontalThresholdMeters: 0.5,
    });
    expect(r.best).not.toBeNull();
    const eligibleCounts = r.candidates
      .filter((c) => c.acceptedByDisplacementCap)
      .map((c) => c.after.candidatePairCount);
    expect(r.best!.after.candidatePairCount).toBe(Math.min(...eligibleCounts));
  });

  it("ignores invalid and duplicate amplitude candidates deterministically", () => {
    const points = [V(0, 10, 0), V(0, 20, 0)];
    const r = optimizeProjectionPreservingStackProposal(points, VIEW, {
      amplitudesMeters: [2, 1, 1, 0, -2, Number.NaN],
      maxDisplacementMeters: 10,
    });
    expect(r.candidates.map((c) => c.amplitudeMeters)).toEqual([1, 2]);
  });
});
