import { describe, expect, it } from "vitest";

import {
  GEOMETRY_PROPOSAL_WORDING,
  buildGeometryProposalPreview,
  buildGeometryProposalSummary,
  compareGeometryProposal,
  explainProposalCandidates,
  optimizeProjectionPreservingStackProposal,
  proposedPointsOf,
  type AudienceView,
} from "@/lib/show/diagnostics";
import type { Vector3Tuple } from "@/lib/show/types";

const VIEW: AudienceView = { viewer: [0, 1.7, -150], target: [0, 60, 0] };

/** Two near-vertical columns => stack candidates exist. */
const STACKED: Vector3Tuple[] = [
  [0, 50, 0],
  [0.5, 60, 0],
  [10, 50, 0],
  [10.4, 62, 0],
];

/** Widely separated, no candidates. */
const SPREAD: Vector3Tuple[] = [
  [-40, 50, 0],
  [0, 50, 0],
  [40, 50, 0],
];

function run(points: Vector3Tuple[], cap = 4) {
  return optimizeProjectionPreservingStackProposal(points, VIEW, {
    horizontalThresholdMeters: 2,
    minVerticalDifferenceMeters: 1,
    maxDisplacementMeters: cap,
  });
}

describe("geometry proposal presentation", () => {
  it("reports no proposal when there are no stack candidates", () => {
    const result = run(SPREAD);
    expect(result.best).toBeNull();
    const rows = buildGeometryProposalSummary(result, null);
    expect(rows.find((r) => r.label === "proposal available")?.value).toBe("no");
    expect(rows.find((r) => r.label === "candidate pairs before")?.value).toBe("0");
  });

  it("maps the proposal summary and before/after values", () => {
    const result = run(STACKED);
    expect(result.best).not.toBeNull();
    const comparison = compareGeometryProposal(STACKED, VIEW, result.best!);
    const rows = buildGeometryProposalSummary(result, comparison);
    const get = (label: string) => rows.find((r) => r.label === label)?.value;
    expect(get("proposal available")).toBe("yes");
    expect(get("chosen amplitude")).toBe(`${result.best!.amplitudeMeters.toFixed(2)} m`);
    expect(get("candidate pairs before")).toBe(String(comparison.candidatePairsBefore));
    expect(get("candidate pairs after")).toBe(String(comparison.candidatePairsAfter));
    expect(get("pair reduction")).toBe(String(comparison.candidatePairReduction));
    expect(get("min horizontal before")).toBe(`${comparison.minHorizontalBefore.toFixed(2)} m`);
    expect(get("max 3D displacement")).toBe(`${comparison.maxDisplacementMeters.toFixed(2)} m`);
    expect(get("displacement cap accepted")).toBe("yes");
  });

  it("overlay mapping keeps before/after in the same shared box and shows tiny drift", () => {
    const result = run(STACKED);
    const proposed = proposedPointsOf(result.best!);
    const preview = buildGeometryProposalPreview(STACKED, proposed, VIEW);
    expect(preview.points).toHaveLength(STACKED.length);
    expect(preview.box.width).toBeGreaterThan(0);
    expect(preview.maxDriftMeters).toBeLessThan(1e-6);
    expect(preview.driftIsNonTrivial).toBe(false);
    preview.points.forEach((p) => {
      expect(p.before[0]).toBeCloseTo(p.after[0], 6);
      expect(p.before[1]).toBeCloseTo(p.after[1], 6);
    });
  });

  it("ghost preview uses proposal positions only and never mutates the input", () => {
    const snapshot = JSON.stringify(STACKED);
    const result = run(STACKED);
    const proposed = proposedPointsOf(result.best!);
    expect(JSON.stringify(STACKED)).toBe(snapshot);
    expect(proposed).toHaveLength(STACKED.length);
    result.best!.proposal.moves.forEach((mv, i) => {
      expect(proposed[i]).toEqual([...mv.proposed]);
    });
    // proposed geometry actually differs in depth from the original
    expect(proposed.some((p, i) => Math.abs(p[2]! - STACKED[i]![2]) > 0.1)).toBe(true);
  });

  it("honours the design displacement cap from the UI", () => {
    const tight = run(STACKED, 0.1);
    expect(tight.best).toBeNull();
    const loose = run(STACKED, 10);
    expect(loose.best).not.toBeNull();
  });

  it("depends on the audience viewpoint", () => {
    const near = optimizeProjectionPreservingStackProposal(STACKED, VIEW, {
      horizontalThresholdMeters: 2,
      minVerticalDifferenceMeters: 1,
    });
    const far = optimizeProjectionPreservingStackProposal(
      STACKED,
      { viewer: [0, 1.7, -600], target: [0, 60, 0] },
      { horizontalThresholdMeters: 2, minVerticalDifferenceMeters: 1 },
    );
    const nearPoints = proposedPointsOf(near.best!);
    const farPoints = proposedPointsOf(far.best!);
    expect(nearPoints).not.toEqual(farPoints);
  });

  it("explains why the winning amplitude won without opaque score tuples", () => {
    const result = run(STACKED);
    const rows = explainProposalCandidates(result);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.filter((r) => r.selected)).toHaveLength(1);
    rows.forEach((r) => expect(r.reason.length).toBeGreaterThan(10));
    expect(rows.find((r) => r.selected)!.reason).toContain("fewest stack candidates");
  });

  it("wording never claims safety and apply is explicitly gated", () => {
    const all = Object.values(GEOMETRY_PROPOSAL_WORDING).join(" ").toLowerCase();
    expect(all).not.toContain("safer");
    expect(all).not.toContain("collision-proof");
    expect(GEOMETRY_PROPOSAL_WORDING.stackClaim).toBe(
      "Vertical-stack diagnostic candidates reduced",
    );
    expect(GEOMETRY_PROPOSAL_WORDING.applyDisabled).toContain("requires trajectory + safety");
  });
});
