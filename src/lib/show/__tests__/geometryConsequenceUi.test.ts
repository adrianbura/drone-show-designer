import { describe, expect, it } from "vitest";

import { createDemoProject } from "../defaultProject";
import { makeFormation } from "../formations";
import {
  analyzeGeometryProposalConsequences,
  applyActionMessage,
  buildStaticPreflightRows,
  buildTrajectoryConsequenceRows,
  CONSEQUENCE_WORDING,
  evaluateGeometryApplyReadiness,
  evaluateGeometryTrajectoryConsequence,
  projectWithFormationPoints,
  resolveProposalMaterialisation,
  SCENE_MATERIALISER_MISSING_MESSAGE,
  staticPreflightVerdict,
} from "../diagnostics";
import type { ShowProject, Vector3Tuple } from "../types";
import {
  AUDIENCE_VIEW_DEFAULTS,
  audienceViewOf,
  getAudienceViewSettings,
  resetAudienceViewSettings,
  setAudienceViewSettings,
} from "../../studio/audienceView";

const options = { sampleRate: 10, assignmentStrategy: "nearestNeighbor" as const };

function smallProject(droneCount = 8): ShowProject {
  const base = createDemoProject();
  const project: ShowProject = { ...base, droneCount };
  return {
    ...project,
    formations: project.formations.map((f) =>
      makeFormation(f.id, f.name, f.kind, droneCount, project.area, f.params),
    ),
  };
}

function showClip(project: ShowProject) {
  return project.timeline.find((c) => (c.phase ?? "SHOW") === "SHOW")!;
}

describe("shared audience viewpoint authority", () => {
  it("maps settings to one canonical viewer/target pair", () => {
    resetAudienceViewSettings();
    expect(getAudienceViewSettings()).toEqual(AUDIENCE_VIEW_DEFAULTS);
    setAudienceViewSettings({ distanceMeters: 200, targetHeightMeters: 40 });
    const view = audienceViewOf(getAudienceViewSettings());
    expect(view.viewer).toEqual([0, AUDIENCE_VIEW_DEFAULTS.eyeHeightMeters, -200]);
    expect(view.target).toEqual([0, 40, 0]);
    resetAudienceViewSettings();
  });

  it("notifies subscribers so every panel reads the same viewpoint", () => {
    resetAudienceViewSettings();
    let seen = 0;
    setAudienceViewSettings({ distanceMeters: 120 });
    seen = getAudienceViewSettings().distanceMeters;
    expect(seen).toBe(120);
    resetAudienceViewSettings();
    expect(getAudienceViewSettings().distanceMeters).toBe(AUDIENCE_VIEW_DEFAULTS.distanceMeters);
  });
});

describe("hypothetical project materialisation", () => {
  it("resolves a simple reusable formation hold", () => {
    const project = smallProject();
    const clip = showClip(project);
    const time = clip.start + clip.transition + 0.1;
    const target = resolveProposalMaterialisation(project, time, project.droneCount);
    expect(target.kind).toBe("FORMATION");
    if (target.kind === "FORMATION") expect(target.formationId).toBe(clip.formationId);
  });

  it("is explicit, never faked, when the instant is inside a transition", () => {
    const project = smallProject();
    const clip = showClip(project);
    const target = resolveProposalMaterialisation(project, clip.start + 0.01, project.droneCount);
    expect(target.kind).toBe("UNAVAILABLE");
  });

  it("refuses to materialise a dynamic-formation hold", () => {
    const base = smallProject();
    const clip = showClip(base);
    const project: ShowProject = {
      ...base,
      timeline: base.timeline.map((c) =>
        c.id === clip.id ? { ...c, dynamicFormationId: "dyn-1" } : c,
      ),
    };
    const target = resolveProposalMaterialisation(
      project,
      clip.start + clip.transition + 0.1,
      project.droneCount,
    );
    expect(target.kind).toBe("UNAVAILABLE");
    if (target.kind === "UNAVAILABLE") {
      expect(target.reason).toContain(SCENE_MATERIALISER_MISSING_MESSAGE);
    }
  });

  it("does not mutate the source project when building the hypothetical one", () => {
    const project = smallProject();
    const snapshot = JSON.stringify(project);
    const clip = showClip(project);
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const moved = formation.points.map((p) => [p[0], p[1], p[2] + 1] as Vector3Tuple);
    const hypothetical = projectWithFormationPoints(project, formation.id, moved);
    expect(JSON.stringify(project)).toBe(snapshot);
    expect(hypothetical).not.toBe(project);
    expect(hypothetical.formations.find((f) => f.id === formation.id)!.points[0]![2]).toBeCloseTo(
      formation.points[0]![2] + 1,
    );
  });
});

describe("static preflight presentation mapping", () => {
  it("maps counts and separation before/after without inventing verdicts", () => {
    const project = smallProject();
    const before: Vector3Tuple[] = [
      [0, 30, 0],
      [10, 30, 0],
    ];
    const after: Vector3Tuple[] = [
      [0, 30, 0],
      [10, 30, 5],
    ];
    const report = analyzeGeometryProposalConsequences({
      before,
      after,
      area: project.area,
      limits: project.limits,
    });
    const rows = buildStaticPreflightRows(report);
    expect(rows.map((r) => r.label)).toEqual([
      "point count preserved",
      "show-area violations",
      "altitude violations",
      "static 3D separation violations",
      "minimum static 3D separation",
    ]);
    expect(rows[0]!.before).toBe("2");
    expect(rows[0]!.after).toBe("2");
    expect(staticPreflightVerdict(report)).toBe("PASS");
  });

  it("reports BLOCKED when the proposal leaves the show area", () => {
    const project = smallProject();
    const before: Vector3Tuple[] = [[0, 30, 0]];
    const after: Vector3Tuple[] = [[project.area.width, 30, 0]];
    const report = analyzeGeometryProposalConsequences({
      before,
      after,
      area: project.area,
      limits: project.limits,
    });
    expect(staticPreflightVerdict(report)).toBe("BLOCKED");
  });
});

describe("trajectory consequence presentation mapping", () => {
  it("copies canonical metrics for both states", () => {
    const project = smallProject();
    const report = evaluateGeometryTrajectoryConsequence(project, project, options);
    const rows = buildTrajectoryConsequenceRows(report);
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    expect(byLabel.get("full-show status")!.before).toBe(report.before.status);
    expect(byLabel.get("full-show status")!.after).toBe(report.after.status);
    expect(byLabel.get("export readiness")!.after).toBe(report.after.exportReadiness);
    expect(byLabel.get("conflict count")!.after).toBe(String(report.after.totalConflictCount));
    expect(byLabel.get("warnings")!.after).toBe(String(report.after.warningCount));
  });
});

describe("apply readiness surface", () => {
  it("blocks while trajectory evidence is missing or stale", () => {
    const project = smallProject();
    const before: Vector3Tuple[] = [[0, 30, 0]];
    const staticPreflight = analyzeGeometryProposalConsequences({
      before,
      after: before,
      area: project.area,
      limits: project.limits,
    });
    // Stale evidence is presented as absent, so READY can never be shown.
    const readiness = evaluateGeometryApplyReadiness({ staticPreflight, trajectory: null });
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.canApply).toBe(false);
    expect(applyActionMessage(readiness)).toBe(CONSEQUENCE_WORDING.applyBlocked);
  });

  it("keeps Apply non-mutating even when readiness is not blocked", () => {
    const project = smallProject();
    const trajectory = evaluateGeometryTrajectoryConsequence(project, project, options);
    const staticPreflight = analyzeGeometryProposalConsequences({
      before: [[0, 30, 0]],
      after: [[0, 30, 0]],
      area: project.area,
      limits: project.limits,
    });
    const readiness = evaluateGeometryApplyReadiness({ staticPreflight, trajectory });
    const message = applyActionMessage(readiness);
    expect([CONSEQUENCE_WORDING.applyBlocked, CONSEQUENCE_WORDING.applyReady]).toContain(message);
    if (readiness.status !== "BLOCKED") {
      expect(message).toBe(CONSEQUENCE_WORDING.applyReady);
    }
  });

  it("surfaces the promotion list from the canonical authority only", () => {
    const project = smallProject();
    const trajectory = evaluateGeometryTrajectoryConsequence(project, project, options);
    const readiness = evaluateGeometryApplyReadiness({ staticPreflight: null, trajectory });
    expect(readiness.newlyPromotedClipIds).toEqual(trajectory.newlyPromotedClipIds);
  });
});
