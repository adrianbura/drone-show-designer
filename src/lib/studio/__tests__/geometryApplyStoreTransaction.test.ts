import { describe, expect, it } from "vitest";

import { createDemoProject } from "../../show/defaultProject";
import type { GeometryApplyPreparationSuccess } from "../geometryApplyCommand";
import { installPreparedGeometryApply } from "../geometryApplyStoreTransaction";
import type { TimelineHistorySnapshot } from "../planningIntegrity";

function prepared(): GeometryApplyPreparationSuccess {
  const beforeProject = createDemoProject();
  const afterProject = {
    ...beforeProject,
    name: `${beforeProject.name} — geometry applied`,
  };
  return {
    ok: true,
    before: {
      project: beforeProject,
      transitionOverrides: {
        clipA: {
          targetPointIndex: [0, 1, 2],
          startOffsets: [0, 0, 0],
          laneOffsets: [0, 0, 0],
          strategy: "test",
        },
      },
      transitionDesigns: {},
      referenceLayer: null,
    },
    after: {
      project: afterProject,
      transitionOverrides: {},
      transitionDesigns: {},
      referenceLayer: null,
    },
    invalidatedTransitionOverrideClipIds: ["clipA"],
    promotedReferenceClipIds: ["scene-2"],
    note: "prepared",
  };
}

describe("geometry apply store transaction", () => {
  it("installs the prepared after snapshot and pushes exactly one undo snapshot", () => {
    const tx = prepared();
    const existing: TimelineHistorySnapshot = {
      project: { ...tx.before.project, name: "older" },
      transitionOverrides: {},
      referenceLayer: null,
    };
    const result = installPreparedGeometryApply(tx, { past: [existing], future: [] });

    expect(result.project).toBe(tx.after.project);
    expect(result.transitionOverrides).toBe(tx.after.transitionOverrides);
    expect(result.referenceLayer).toBeNull();
    expect(result.history.past).toEqual([existing, tx.before]);
    expect(result.history.future).toEqual([]);
    expect(result.invalidateDerivedAnalysis).toBe(true);
  });

  it("cuts the redo branch on a new apply command", () => {
    const tx = prepared();
    const future: TimelineHistorySnapshot = {
      project: tx.before.project,
      transitionOverrides: {},
      referenceLayer: null,
    };
    const result = installPreparedGeometryApply(tx, { past: [], future: [future] });
    expect(result.history.future).toEqual([]);
  });

  it("preserves the canonical invalidation and imported-promotion report", () => {
    const tx = prepared();
    const result = installPreparedGeometryApply(tx, { past: [], future: [] });
    expect(result.invalidatedTransitionOverrideClipIds).toEqual(["clipA"]);
    expect(result.promotedReferenceClipIds).toEqual(["scene-2"]);
  });

  it("bounds history without changing the prepared before snapshot", () => {
    const tx = prepared();
    const p1: TimelineHistorySnapshot = {
      project: { ...tx.before.project, name: "p1" },
      transitionOverrides: {},
    };
    const p2: TimelineHistorySnapshot = {
      project: { ...tx.before.project, name: "p2" },
      transitionOverrides: {},
    };
    const result = installPreparedGeometryApply(tx, { past: [p1, p2], future: [] }, { maxHistoryEntries: 2 });
    expect(result.history.past).toEqual([p2, tx.before]);
  });
});
