import { describe, expect, it } from "vitest";

import { createDemoProject } from "../defaultProject";
import { makeFormation } from "../formations";
import {
  evaluateGeometryTrajectoryConsequence,
  projectWithFormationPoints,
} from "../diagnostics/geometryTrajectoryConsequence";
import type { ShowProject, Vector3Tuple } from "../types";

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

function showFormationId(project: ShowProject): string {
  return project.timeline.find((clip) => (clip.phase ?? "SHOW") === "SHOW")!.formationId;
}

describe("geometry trajectory consequence evaluation", () => {
  it("runs identical inputs through the same canonical pipeline with zero deltas", () => {
    const project = smallProject();
    const report = evaluateGeometryTrajectoryConsequence(project, project, options);
    expect(report.before.analysisRevision).toBe(report.after.analysisRevision);
    expect(report.delta.minimumDynamicSeparation).toBe(0);
    expect(report.delta.maximumVelocity).toBe(0);
    expect(report.delta.maximumAcceleration).toBe(0);
    expect(report.delta.maximumJerk).toBe(0);
    expect(report.delta.totalConflictCount).toBe(0);
    expect(report.delta.continuityIssueCount).toBe(0);
    expect(report.candidateGeometryExercisedByPlanner).toBe(true);
  });

  it("detects canonical full-show consequences of an extreme proposed formation move", () => {
    const project = smallProject();
    const id = showFormationId(project);
    const formation = project.formations.find((f) => f.id === id)!;
    const moved = formation.points.map(
      (p) => [p[0] + 1000, p[1], p[2]] as Vector3Tuple,
    );
    const candidate = projectWithFormationPoints(project, id, moved);
    const report = evaluateGeometryTrajectoryConsequence(project, candidate, options);
    expect(report.before.analysisRevision).not.toBe(report.after.analysisRevision);
    expect(report.after.status).toBe("FAIL");
    expect(report.after.exportReadiness).toBe("BLOCKED");
    expect(report.canonicalProfilePass).toBe(false);
    expect(report.after.blockingIssueCount).toBeGreaterThan(0);
  });

  it("materialises formation points without mutating the source project", () => {
    const project = smallProject();
    const before = JSON.stringify(project);
    const id = showFormationId(project);
    const formation = project.formations.find((f) => f.id === id)!;
    const points = formation.points.map(
      (p, i) => [p[0], p[1], p[2] + i * 0.1] as Vector3Tuple,
    );
    const candidate = projectWithFormationPoints(project, id, points);
    expect(JSON.stringify(project)).toBe(before);
    expect(candidate).not.toBe(project);
    expect(candidate.formations.find((f) => f.id === id)!.points).toEqual(points);
  });

  it("rejects point-count changes because assignment identity would be ambiguous", () => {
    const project = smallProject();
    const id = showFormationId(project);
    expect(() => projectWithFormationPoints(project, id, [[0, 0, 0]])).toThrow(/point-count mismatch/);
  });

  it("rejects missing formation ids", () => {
    expect(() => projectWithFormationPoints(smallProject(), "missing", [])).toThrow(/formation not found/);
  });
});
