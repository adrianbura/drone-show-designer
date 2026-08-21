import { describe, expect, it } from "vitest";

import { audienceViewOf, AUDIENCE_VIEW_DEFAULTS } from "../../studio/audienceView";
import { findGeometryProposalOpportunities } from "../diagnostics";
import { createDepthStaggerDemoProject } from "../stories/depthStaggerDemo";
import type { Vector3Tuple } from "../types";

function pointsAtHold(project: ReturnType<typeof createDepthStaggerDemoProject>, time: number): readonly Vector3Tuple[] {
  const clip = project.timeline.find((candidate) => {
    const holdStart = candidate.start + candidate.transition;
    return time >= holdStart - 1e-9 && time <= holdStart + candidate.hold + 1e-9;
  });
  if (!clip) return [];
  return project.formations.find((formation) => formation.id === clip.formationId)?.points ?? [];
}

describe("depth stagger demo", () => {
  it("contains a materialisable improving geometry-proposal opportunity", () => {
    const project = createDepthStaggerDemoProject();
    const report = findGeometryProposalOpportunities(
      project,
      (time) => pointsAtHold(project, time),
      audienceViewOf(AUDIENCE_VIEW_DEFAULTS),
    );

    expect(report.best).not.toBeNull();
    expect(report.best!.clipId).toBe("c-ds-stack");
    expect(report.best!.materialisation.kind).toBe("FORMATION");
    expect(report.best!.optimization.before.candidatePairCount).toBeGreaterThan(0);
    expect(report.best!.optimization.best).not.toBeNull();
    expect(report.best!.optimization.improved).toBe(true);
  });

  it("keeps the intentionally stacked pairs physically separated in 3D", () => {
    const project = createDepthStaggerDemoProject();
    const points = project.formations.find((formation) => formation.id === "f-ds-stack")!.points;
    const distance = (a: Vector3Tuple, b: Vector3Tuple) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    expect(distance(points[0]!, points[1]!)).toBeGreaterThan(project.limits.minSeparation);
    expect(distance(points[2]!, points[3]!)).toBeGreaterThan(project.limits.minSeparation);
  });
});
