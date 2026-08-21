import { describe, expect, it } from "vitest";

import { createDemoProject } from "../../show/defaultProject";
import type { GeometryApplyReadinessReport } from "../../show/diagnostics/geometryApplyReadiness";
import type { ClipTransitionOverride } from "../../show/trajectory";
import type { Vector3Tuple } from "../../show/types";
import { prepareGeometryApplyCommand } from "../geometryApplyCommand";

const ready = (status: "READY" | "WARNING" = "READY"): GeometryApplyReadinessReport => ({
  status,
  canApply: true,
  blockers: [],
  warnings: status === "WARNING" ? ["warning"] : [],
  newlyPromotedClipIds: [],
  note: "test",
});

function changedProject() {
  const project = createDemoProject();
  const clip = project.timeline.find((candidate) => (candidate.phase ?? "SHOW") === "SHOW")!;
  const formation = project.formations.find((candidate) => candidate.id === clip.formationId)!;
  const after = {
    ...project,
    formations: project.formations.map((candidate) =>
      candidate.id === formation.id
        ? {
            ...candidate,
            points: candidate.points.map(
              (point, index) =>
                [point[0], point[1], point[2] + (index % 2 === 0 ? 0.75 : -0.75)] as Vector3Tuple,
            ),
          }
        : candidate,
    ),
  };
  return { project, after, clip };
}

function identityOverride(count: number): ClipTransitionOverride {
  return {
    targetPointIndex: Array.from({ length: count }, (_, index) => index),
    startOffsets: Array.from({ length: count }, () => 0),
    laneOffsets: Array.from({ length: count }, () => 0),
    strategy: "test",
  };
}

describe("geometry apply command preparation", () => {
  it("refuses to prepare a command when canonical readiness is blocked", () => {
    const { project, after } = changedProject();
    const result = prepareGeometryApplyCommand({
      beforeProject: project,
      afterProject: after,
      readiness: {
        ...ready(),
        status: "BLOCKED",
        canApply: false,
        blockers: ["blocked by canonical evidence"],
      },
      transitionOverrides: {},
      assignmentStrategy: "nearestNeighbor",
      promotedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result).toEqual({
      ok: false,
      blocker: "READINESS_BLOCKED",
      note: "blocked by canonical evidence",
    });
  });

  it("builds before/after snapshots without mutating either project", () => {
    const { project, after } = changedProject();
    const beforeJson = JSON.stringify(project);
    const afterJson = JSON.stringify(after);
    const result = prepareGeometryApplyCommand({
      beforeProject: project,
      afterProject: after,
      readiness: ready("WARNING"),
      transitionOverrides: {},
      transitionDesigns: {},
      referenceLayer: null,
      assignmentStrategy: "nearestNeighbor",
      promotedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.before.project).toBe(project);
    expect(result.after.project).toBe(after);
    expect(result.before.referenceLayer).toBeNull();
    expect(result.after.referenceLayer).toBeNull();
    expect(JSON.stringify(project)).toBe(beforeJson);
    expect(JSON.stringify(after)).toBe(afterJson);
  });

  it("invalidates a transition override whose canonical geometry basis changed", () => {
    const { project, after, clip } = changedProject();
    const override = identityOverride(project.droneCount);
    const result = prepareGeometryApplyCommand({
      beforeProject: project,
      afterProject: after,
      readiness: ready(),
      transitionOverrides: { [clip.id]: override },
      assignmentStrategy: "nearestNeighbor",
      promotedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invalidatedTransitionOverrideClipIds).toContain(clip.id);
    expect(result.before.transitionOverrides[clip.id]).toBe(override);
    expect(result.after.transitionOverrides[clip.id]).toBeUndefined();
  });

  it("preserves an unrelated override when its canonical basis is unchanged", () => {
    const { project, after, clip } = changedProject();
    const other = project.timeline.find(
      (candidate) => (candidate.phase ?? "SHOW") === "SHOW" && candidate.id !== clip.id,
    );
    if (!other) return;
    const override = identityOverride(project.droneCount);
    const result = prepareGeometryApplyCommand({
      beforeProject: project,
      afterProject: after,
      readiness: ready(),
      transitionOverrides: { [other.id]: override },
      assignmentStrategy: "nearestNeighbor",
      promotedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invalidatedTransitionOverrideClipIds).not.toContain(other.id);
    expect(result.after.transitionOverrides[other.id]).toBe(override);
  });

  it("rejects cross-project replacement so Apply cannot silently switch project identity", () => {
    const { project, after } = changedProject();
    const result = prepareGeometryApplyCommand({
      beforeProject: project,
      afterProject: { ...after, id: `${after.id}-other` },
      readiness: ready(),
      transitionOverrides: {},
      assignmentStrategy: "nearestNeighbor",
      promotedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocker).toBe("PROJECT_ID_MISMATCH");
  });
});
