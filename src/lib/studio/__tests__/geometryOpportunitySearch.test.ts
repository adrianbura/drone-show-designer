import { describe, expect, it } from "vitest";

import { createDepthStaggerDemoProject } from "../../show/stories/depthStaggerDemo";
import { findGeometryProposalOpportunities, type AudienceView } from "../../show/diagnostics";
import { AUDIENCE_VIEW_DEFAULTS, audienceViewOf } from "../audienceView";
import {
  NO_OPPORTUNITY_MESSAGE,
  buildOpportunityRows,
  isOpportunitySearchStale,
  opportunitySearchKey,
  type OpportunitySearchState,
} from "../geometryOpportunitySearch";
import type { ShowProject, Vector3Tuple } from "../../show/types";

const VIEW: AudienceView = audienceViewOf(AUDIENCE_VIEW_DEFAULTS);

const INPUTS = {
  analysisRevision: "rev-1",
  audience: AUDIENCE_VIEW_DEFAULTS,
  horizontalThresholdMeters: 3,
  minVerticalDifferenceMeters: 2,
  maxDisplacementMeters: 4,
};

function holdPoints(project: ShowProject, time: number): readonly Vector3Tuple[] {
  const clip = project.timeline.find((candidate) => {
    const holdStart = candidate.start + candidate.transition;
    return time >= holdStart - 1e-9 && time <= holdStart + candidate.hold + 1e-9;
  });
  if (!clip) return [];
  return project.formations.find((f) => f.id === clip.formationId)?.points ?? [];
}

describe("geometry opportunity search helpers", () => {
  it("maps the real depth-stagger demo opportunity to operator rows", () => {
    const project = createDepthStaggerDemoProject();
    const report = findGeometryProposalOpportunities(
      project,
      (time) => holdPoints(project, time),
      VIEW,
    );
    expect(report.best).not.toBeNull();
    const rows = buildOpportunityRows(report.best!, "Depth Stagger · Vertical Columns");
    const map = new Map(rows.map((r) => [r.label, r.value]));
    expect(map.get("clip")).toBe("Depth Stagger · Vertical Columns");
    expect(map.get("time")).toBe(`${report.best!.time.toFixed(2)} s`);
    expect(map.get("pairs before")).toBe(
      String(report.best!.optimization.before.candidatePairCount),
    );
    expect(map.get("pairs after")).toBe(
      String(report.best!.optimization.best!.after.candidatePairCount),
    );
    expect(map.get("materialisation")).toBe("FORMATION");
    expect(map.get("amplitude")).toMatch(/ m$/);
  });

  it("has an explicit no-opportunity message that never claims safety", () => {
    expect(NO_OPPORTUNITY_MESSAGE).toContain("No materialisable SHOW hold");
    expect(NO_OPPORTUNITY_MESSAGE.toLowerCase()).not.toContain("safe");
  });

  it("keys a fresh search as current and never treats null state as stale", () => {
    const key = opportunitySearchKey(INPUTS);
    const state: OpportunitySearchState = { key, clipId: "c", time: 3, rows: [] };
    expect(isOpportunitySearchStale(state, key)).toBe(false);
    expect(isOpportunitySearchStale(null, key)).toBe(false);
  });

  it("invalidates the search when diagnostic settings change", () => {
    const base = opportunitySearchKey(INPUTS);
    const state: OpportunitySearchState = { key: base, clipId: "c", time: 3, rows: [] };
    const variants = [
      { ...INPUTS, horizontalThresholdMeters: 5 },
      { ...INPUTS, minVerticalDifferenceMeters: 5 },
      { ...INPUTS, maxDisplacementMeters: 9 },
      { ...INPUTS, audience: { ...AUDIENCE_VIEW_DEFAULTS, distanceMeters: 90 } },
      { ...INPUTS, audience: { ...AUDIENCE_VIEW_DEFAULTS, eyeHeightMeters: 2.2 } },
      { ...INPUTS, audience: { ...AUDIENCE_VIEW_DEFAULTS, targetHeightMeters: 30 } },
    ];
    for (const variant of variants) {
      expect(isOpportunitySearchStale(state, opportunitySearchKey(variant))).toBe(true);
    }
  });

  it("invalidates the search when the project revision changes", () => {
    const state: OpportunitySearchState = {
      key: opportunitySearchKey(INPUTS),
      clipId: "c",
      time: 3,
      rows: [],
    };
    expect(
      isOpportunitySearchStale(state, opportunitySearchKey({ ...INPUTS, analysisRevision: "rev-2" })),
    ).toBe(true);
  });

  it("searches only SHOW hold midpoints, once per explicit invocation", () => {
    const project = createDepthStaggerDemoProject();
    const sampled: number[] = [];
    const report = findGeometryProposalOpportunities(
      project,
      (time) => {
        sampled.push(time);
        return holdPoints(project, time);
      },
      VIEW,
    );
    expect(sampled.length).toBe(report.checkedHoldCount);
    expect(new Set(sampled).size).toBe(sampled.length);
    for (const time of sampled) {
      const clip = project.timeline.find((candidate) => {
        const holdStart = candidate.start + candidate.transition;
        return time >= holdStart - 1e-9 && time <= holdStart + candidate.hold + 1e-9;
      });
      expect(clip).toBeDefined();
    }
  });
});
