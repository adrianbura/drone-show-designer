/**
 * PROJECT PLANNING ROUND-TRIP.
 *
 * The planning section is not a UI preference: it decides assignments and the
 * applied transition overrides, and therefore the flown trajectory. These tests
 * pin down that save -> open (and autosave -> recovery) reproduce identical
 * planning output, and that legacy v1 files migrate to safe defaults.
 */
import { describe, expect, it } from "vitest";

import { toStudioProject } from "../../adapters/export";
import { MemoryKeyValueStore } from "../../library/repository";
import { createDefaultProject, createDemoProject } from "../../show/defaultProject";
import { buildShowPlan } from "../../show/trajectory/schedule";
import { sampleTrajectorySet } from "../../show/trajectory/sampler";
import type { ClipTransitionOverride } from "../../show/trajectory/schedule";
import {
  parseProjectFile,
  projectFileToJson,
  PROJECT_FILE_KIND,
  readAutosave,
  serializeProject,
  writeAutosave,
  ProjectFileError,
  type ProjectPlanningState,
} from "../index";

const SAMPLE_RATE = 10;

function optimizableClipId(project: ReturnType<typeof createDemoProject>): string {
  const clip = project.timeline.find((c) => (c.phase ?? "SHOW") === "SHOW" && c.transition > 0);
  return (clip ?? project.timeline[1] ?? project.timeline[0]!).id;
}

/** Deterministic, structurally valid override (reversed target mapping). */
function makeOverride(project: ReturnType<typeof createDemoProject>, clipId: string): ClipTransitionOverride {
  const clip = project.timeline.find((c) => c.id === clipId)!;
  const points = project.formations.find((f) => f.id === clip.formationId)!.points;
  const n = project.droneCount;
  return {
    targetPointIndex: Array.from({ length: n }, (_, i) => (points.length - 1 - i + points.length * 2) % points.length),
    startOffsets: Array.from({ length: n }, (_, i) => (i % 4) * 0.05),
    laneOffsets: Array.from({ length: n }, (_, i) => ((i % 3) - 1) * 0.5),
    strategy: "optimalDistance+optimized",
  };
}

function planningFor(project: ReturnType<typeof createDemoProject>): ProjectPlanningState {
  const clipId = optimizableClipId(project);
  return {
    assignmentStrategy: "optimalDistance",
    transitionOverrides: { [clipId]: makeOverride(project, clipId) },
  };
}

describe("project planning round-trip", () => {
  it("round-trips the assignment strategy", () => {
    const project = createDemoProject(24);
    const text = projectFileToJson(
      serializeProject(project, {
        planning: { assignmentStrategy: "optimalDistance", transitionOverrides: {} },
      }),
    );
    expect(parseProjectFile(text).planning?.assignmentStrategy).toBe("optimalDistance");
  });

  it("round-trips an applied transition override exactly", () => {
    const project = createDemoProject(24);
    const planning = planningFor(project);
    const clipId = Object.keys(planning.transitionOverrides)[0]!;
    const reopened = parseProjectFile(projectFileToJson(serializeProject(project, { planning })));

    const before = buildShowPlan(project, planning);
    const after = buildShowPlan(reopened.project, {
      assignmentStrategy: reopened.planning!.assignmentStrategy,
      transitionOverrides: reopened.planning!.transitionOverrides,
    });

    expect(before.optimizedClipIds).toContain(clipId);
    expect(after.optimizedClipIds).toEqual(before.optimizedClipIds);
    expect(reopened.planning!.transitionOverrides[clipId]).toEqual(planning.transitionOverrides[clipId]);
  });

  it("reproduces identical sampled trajectories after save -> open", () => {
    const project = createDemoProject(24);
    const planning = planningFor(project);
    const reopened = parseProjectFile(projectFileToJson(serializeProject(project, { planning })));

    const before = sampleTrajectorySet(buildShowPlan(project, planning), { sampleRate: SAMPLE_RATE });
    const after = sampleTrajectorySet(
      buildShowPlan(reopened.project, {
        assignmentStrategy: reopened.planning!.assignmentStrategy,
        transitionOverrides: reopened.planning!.transitionOverrides,
      }),
      { sampleRate: SAMPLE_RATE },
    );

    expect(after.drones.length).toBe(before.drones.length);
    for (let d = 0; d < before.drones.length; d++) {
      const a = before.drones[d]!.samples;
      const b = after.drones[d]!.samples;
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        for (let axis = 0; axis < 3; axis++) {
          expect(b[i]!.position[axis]!).toBeCloseTo(a[i]!.position[axis]!, 9);
        }
      }
    }
  });

  it("does NOT silently revert to unoptimized planning", () => {
    const project = createDemoProject(24);
    const planning = planningFor(project);
    const reopened = parseProjectFile(projectFileToJson(serializeProject(project, { planning })));
    const unoptimized = sampleTrajectorySet(buildShowPlan(project, {}), { sampleRate: SAMPLE_RATE });
    const restored = sampleTrajectorySet(
      buildShowPlan(reopened.project, {
        assignmentStrategy: reopened.planning!.assignmentStrategy,
        transitionOverrides: reopened.planning!.transitionOverrides,
      }),
      { sampleRate: SAMPLE_RATE },
    );
    const differs = restored.drones.some((drone, d) =>
      drone.samples.some((s, i) =>
        s.position.some(
          (v, axis) => Math.abs(v - unoptimized.drones[d]!.samples[i]!.position[axis]!) > 1e-6,
        ),
      ),
    );
    expect(differs).toBe(true);
  });

  it("persists and restores editor preferences", () => {
    const project = createDemoProject(16);
    const selected = project.timeline[1]?.id ?? project.timeline[0]!.id;
    const file = parseProjectFile(
      projectFileToJson(serializeProject(project, { editor: { selectedClipId: selected, sampleRate: 25 } })),
    );
    expect(file.editor?.selectedClipId).toBe(selected);
    expect(file.editor?.sampleRate).toBe(25);
    // A stale selection is not a hard error: the reader keeps it and the store
    // falls back deterministically to the first clip.
    const stale = parseProjectFile(
      projectFileToJson(serializeProject(project, { editor: { selectedClipId: "missing-clip" } })),
    );
    expect(stale.project.timeline.some((c) => c.id === stale.editor?.selectedClipId)).toBe(false);
    expect(stale.project.timeline[0]!.id).toBeTruthy();
  });

  it("preserves planning state through autosave and recovery", async () => {
    const project = createDemoProject(20);
    const planning = planningFor(project);
    const store = new MemoryKeyValueStore();
    await writeAutosave(store, {
      savedAt: "2026-01-01T00:00:00.000Z",
      fileName: "show.droneshow.json",
      file: serializeProject(project, { planning, editor: { sampleRate: 25, selectedClipId: null } }),
    });
    const snapshot = await readAutosave(store);
    expect(snapshot?.file.planning).toEqual(planning);
    expect(snapshot?.file.editor?.sampleRate).toBe(25);
  });

  function legacyV1(project: ReturnType<typeof createDemoProject>, editor: Record<string, unknown>) {
    return JSON.stringify({
      kind: PROJECT_FILE_KIND,
      schemaVersion: 1,
      savedAt: "2025-01-01T00:00:00.000Z",
      app: { name: "Drone Show Studio", schemaVersion: "1.0" },
      project,
      editor,
    });
  }

  it("migrates a legacy v1 assignment strategy into planning", () => {
    const file = parseProjectFile(
      legacyV1(createDemoProject(12), { sampleRate: 10, assignmentStrategy: "optimalDistance" }),
    );
    expect(file.schemaVersion).toBe(3);
    expect(file.planning).toEqual({ assignmentStrategy: "optimalDistance", transitionOverrides: {} });
  });

  it("falls back to the default for an unknown legacy strategy", () => {
    const unknown = parseProjectFile(legacyV1(createDemoProject(12), { assignmentStrategy: "warpDrive" }));
    expect(unknown.planning?.assignmentStrategy).toBe("nearestNeighbor");
    const none = parseProjectFile(legacyV1(createDemoProject(12), { sampleRate: 10 }));
    expect(none.planning?.assignmentStrategy).toBe("nearestNeighbor");
  });

  it("does not let editor.assignmentStrategy override v2 planning", () => {
    const project = createDemoProject(12);
    const base = serializeProject(project, {
      planning: { assignmentStrategy: "nearestNeighbor", transitionOverrides: {} },
      editor: { assignmentStrategy: "optimalDistance" },
    });
    expect(parseProjectFile(projectFileToJson(base)).planning?.assignmentStrategy).toBe("nearestNeighbor");
  });

  it("degrades an unknown v2 strategy and rejects a structurally malformed override", () => {
    const project = createDemoProject(12);
    const base = serializeProject(project);
    const unknown = parseProjectFile(
      JSON.stringify({ ...base, planning: { assignmentStrategy: "warpDrive", transitionOverrides: {} } }),
    );
    expect(unknown.planning?.assignmentStrategy).toBe("nearestNeighbor");

    expect(() =>
      parseProjectFile(
        JSON.stringify({
          ...base,
          planning: { assignmentStrategy: "nearestNeighbor", transitionOverrides: { c1: { strategy: 3 } } },
        }),
      ),
    ).toThrowError(ProjectFileError);
  });

  describe("override semantic integrity", () => {
    const project = createDemoProject(24);
    const planning = planningFor(project);
    const clipId = Object.keys(planning.transitionOverrides)[0]!;
    const good = planning.transitionOverrides[clipId]!;

    function open(overrides: Record<string, unknown>) {
      return parseProjectFile(
        JSON.stringify({
          ...serializeProject(project),
          planning: { assignmentStrategy: "optimalDistance", transitionOverrides: overrides },
        }),
      );
    }

    function expectRejected(overrides: Record<string, unknown>) {
      let error: unknown;
      try {
        open(overrides);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ProjectFileError);
      expect((error as ProjectFileError).code).toBe("MALFORMED_PLANNING");
    }

    it("accepts a valid override", () => {
      expect(open({ [clipId]: good }).planning?.transitionOverrides[clipId]).toEqual(good);
    });

    it("rejects a wrong targetPointIndex length", () => {
      expectRejected({ [clipId]: { ...good, targetPointIndex: good.targetPointIndex.slice(0, 5) } });
    });

    it("rejects wrong startOffsets / laneOffsets lengths", () => {
      expectRejected({ [clipId]: { ...good, startOffsets: good.startOffsets.slice(0, 3) } });
      expectRejected({ [clipId]: { ...good, laneOffsets: [...good.laneOffsets, 0] } });
    });

    it("rejects a fractional target index", () => {
      const targetPointIndex = [...good.targetPointIndex];
      targetPointIndex[0] = 1.5;
      expectRejected({ [clipId]: { ...good, targetPointIndex } });
    });

    it("rejects an unknown clip id", () => {
      expectRejected({ "clip-that-does-not-exist": good });
    });

    it("rejects an override on a non-SHOW clip", () => {
      const nonShow = project.timeline.find((c) => (c.phase ?? "SHOW") !== "SHOW");
      if (!nonShow) return;
      expectRejected({ [nonShow.id]: good });
    });

    it("rejects an out-of-range target index", () => {
      const targetPointIndex = [...good.targetPointIndex];
      targetPointIndex[1] = 10_000;
      expectRejected({ [clipId]: { ...good, targetPointIndex } });
      const negative = [...good.targetPointIndex];
      negative[2] = -1;
      expectRejected({ [clipId]: { ...good, targetPointIndex: negative } });
    });
  });

  it("Inspector studio-project export carries the same planning state as Save", () => {
    const project = createDemoProject(18);
    const planning = planningFor(project);
    const editor = { selectedClipId: project.timeline[0]!.id, sampleRate: 25 };
    const save = projectFileToJson(serializeProject(project, { planning, editor }));
    const inspector = toStudioProject(project, { planning, editor });
    const a = parseProjectFile(save);
    const b = parseProjectFile(inspector);
    expect(b.planning).toEqual(a.planning);
    expect(b.editor).toEqual(a.editor);
  });
});
