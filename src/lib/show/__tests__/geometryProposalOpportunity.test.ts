import { describe, expect, it } from "vitest";

import { createDemoProject } from "../defaultProject";
import {
  findGeometryProposalOpportunities,
  type AudienceView,
} from "../diagnostics";
import type { ShowProject, Vector3Tuple } from "../types";
import { clipPhase } from "../types";

const VIEW: AudienceView = {
  viewer: [0, 1.7, -150],
  target: [0, 60, 0],
};

const STACKED: Vector3Tuple[] = [
  [0, 30, 0],
  [0.2, 34, 0.1],
  [12, 30, 0],
  [12.25, 35, 0.15],
];

const PLANAR: Vector3Tuple[] = [
  [-9, 30, 0],
  [-3, 30, 0],
  [3, 30, 0],
  [9, 30, 0],
];

function fixture(): { project: ShowProject; targetTime: number; targetClipId: string } {
  const base = createDemoProject();
  const showClips = base.timeline.filter((clip) => clipPhase(clip) === "SHOW");
  const target = showClips[0]!;
  const targetTime = target.start + target.transition + target.hold * 0.5;
  const formations = base.formations.map((formation) =>
    formation.id === target.formationId ? { ...formation, points: STACKED } : formation,
  );
  return {
    project: { ...base, formations },
    targetTime,
    targetClipId: target.id,
  };
}

describe("geometry proposal opportunity finder", () => {
  it("finds a materialisable SHOW hold instead of an arbitrary risky frame", () => {
    const { project, targetTime, targetClipId } = fixture();
    const report = findGeometryProposalOpportunities(
      project,
      (time) => (Math.abs(time - targetTime) < 1e-6 ? STACKED : PLANAR),
      VIEW,
    );

    expect(report.checkedHoldCount).toBeGreaterThan(0);
    expect(report.materialisableHoldCount).toBeGreaterThan(0);
    expect(report.best).not.toBeNull();
    expect(report.best!.clipId).toBe(targetClipId);
    expect(report.best!.time).toBeCloseTo(targetTime, 9);
    expect(report.best!.optimization.before.candidatePairCount).toBeGreaterThan(0);
    expect(report.best!.optimization.best).not.toBeNull();
    expect(report.best!.optimization.improved).toBe(true);
    expect(report.best!.materialisation.kind).toBe("FORMATION");
  });

  it("returns no opportunity when materialisable holds have no vertical-stack candidates", () => {
    const { project } = fixture();
    const report = findGeometryProposalOpportunities(project, () => PLANAR, VIEW);

    expect(report.best).toBeNull();
    expect(report.opportunities).toEqual([]);
    expect(report.checkedHoldCount).toBeGreaterThan(0);
  });

  it("does not mutate project state while searching", () => {
    const { project, targetTime } = fixture();
    const before = JSON.stringify(project);
    findGeometryProposalOpportunities(
      project,
      (time) => (Math.abs(time - targetTime) < 1e-6 ? STACKED : PLANAR),
      VIEW,
    );
    expect(JSON.stringify(project)).toBe(before);
  });
});
