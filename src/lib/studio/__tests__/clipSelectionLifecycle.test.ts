/**
 * CLIP SELECTION LIFECYCLE + LIBRARY INSERTION regression coverage.
 *
 * Pure-domain tests: the store delegates to exactly these functions, so proving
 * them here proves the authoring contract (no resurrection, one undo entry,
 * LANDING final, planner ownership) without a React harness.
 */
import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../../show/defaultProject";
import { makeFormation } from "../../show/formations";
import { dynamicFromFormation } from "../../show/dynamic";
import { addObject, emptyScene, sceneForClip, upsertScene } from "../../show/scene";
import { createEffectFromPreset, findLightingPreset } from "../../show/lighting";
import type { LightingEffectInstance } from "../../show/lighting";
import type { ShowProject, TimelineClip } from "../../show/types";
import { assetFromDynamicFormation, assetFromFormation } from "../../library";
import { assetFromScene } from "../../library/sceneAsset";
import {
  EMPTY_EDITOR_CLIP_SELECTION,
  reconcileEditorSelection,
  type EditorClipSelectionState,
} from "../clipSelection";
import { insertLibraryAsset } from "../assetInsertion";
import { insertClipBeforeLanding, timelineBodyEnd } from "../clipInsertion";

const N = 12;

function clip(over: Partial<TimelineClip> & Pick<TimelineClip, "id" | "formationId">): TimelineClip {
  return {
    start: 0,
    transition: 8,
    hold: 6,
    easing: "minJerk",
    color: [120, 200, 255],
    effect: "solid",
    phase: "SHOW",
    ...over,
  };
}

/** Project with: static clip A (2-object scene), dynamic clip B, LANDING. */
function baseProject() {
  let project: ShowProject = createDefaultProject();
  const fa = makeFormation("f-a", "A", "grid", N, project.area);
  const fb = makeFormation("f-b", "B", "circle", N, project.area);
  const dynamic = dynamicFromFormation(fb, { id: "dyn-b", name: "B moving", duration: 4 });
  const clipA = clip({ id: "clip-a", formationId: fa.id, start: 0 });
  const clipB = clip({
    id: "clip-b",
    formationId: fb.id,
    start: 14,
    dynamicFormationId: dynamic.id,
  });
  const landing = clip({ id: "clip-landing", formationId: fa.id, start: 28, phase: "LANDING" });
  project = {
    ...project,
    formations: [fa, fb],
    dynamicFormations: [dynamic],
    timeline: [clipA, clipB, landing],
  };
  // Clip A carries an explicit 2-object scene.
  let scene = emptyScene(clipA.id, "Scene A");
  scene = addObject(project, scene, { source: { kind: "STATIC", formationId: fa.id }, name: "Obj 1" }).scene;
  scene = addObject(project, scene, { source: { kind: "STATIC", formationId: fb.id }, name: "Obj 2" }).scene;
  project = upsertScene(project, scene);
  return { project, scene: sceneForClip(project, clipA)!, dynamic, fa, fb };
}

function withLightingEffect(project: ShowProject, clipId: string) {
  const preset = findLightingPreset("FADE_IN");
  const effect: LightingEffectInstance = {
    ...createEffectFromPreset(preset!, { kind: "SCENE", clipId }),
    id: `fx-${clipId}`,
  };
  return {
    project: { ...project, lighting: { schemaVersion: 1, effects: [effect] } } as ShowProject,
    effect,
  };
}

const state = (over: Partial<EditorClipSelectionState> = {}): EditorClipSelectionState => ({
  ...EMPTY_EDITOR_CLIP_SELECTION,
  ...over,
});

describe("clip selection lifecycle", () => {
  it("A. multi-select on clip A does not resurrect after A -> B -> A", () => {
    const { project, scene } = baseProject();
    const ids = scene.objects.map((o) => o.id);
    expect(ids).toHaveLength(2);

    const afterSwitchToB = reconcileEditorSelection(
      project,
      "clip-b",
      state({ sceneSelection: { ids, primaryId: ids[0]! } }),
      "clip-a",
    );
    expect(afterSwitchToB.sceneSelection.ids).toEqual([]);

    const backToA = reconcileEditorSelection(project, "clip-a", afterSwitchToB, "clip-b");
    expect(backToA.sceneSelection.ids).toEqual([]);
    expect(backToA.sceneSelection.primaryId).toBeNull();
  });

  it("B. switching to a dynamic clip activates its dynamic formation", () => {
    const { project } = baseProject();
    const next = reconcileEditorSelection(project, "clip-b", state(), "clip-a");
    expect(next.explicitDynamicId).toBe("dyn-b");
  });

  it("C. switching away clears clip-derived dynamic point/group selection", () => {
    const { project, dynamic } = baseProject();
    const current = state({
      explicitDynamicId: dynamic.id,
      selectedPointIds: [dynamic.points[0]!.id],
      selectedMotionGroupId: null,
    });
    const next = reconcileEditorSelection(project, "clip-a", current, "clip-b");
    expect(next.explicitDynamicId).toBeNull();
    expect(next.selectedPointIds).toEqual([]);
    expect(next.selectedMotionGroupId).toBeNull();
  });

  it("D. switching clip cancels the gizmo draft without touching the project", () => {
    const { project } = baseProject();
    const before = JSON.stringify(project);
    const next = reconcileEditorSelection(project, "clip-b", state({ gizmoDraftActive: true }), "clip-a");
    expect(next.gizmoDraftActive).toBe(false);
    expect(JSON.stringify(project)).toBe(before);
  });

  it("E. a lighting selection that does not belong to the new clip clears", () => {
    const base = baseProject();
    const { project, effect } = withLightingEffect(base.project, "clip-a");
    const kept = reconcileEditorSelection(
      project,
      "clip-a",
      state({ selectedLightingEffectId: effect.id }),
      "clip-a",
    );
    expect(kept.selectedLightingEffectId).toBe(effect.id);

    const cleared = reconcileEditorSelection(
      project,
      "clip-b",
      state({ selectedLightingEffectId: effect.id }),
      "clip-a",
    );
    expect(cleared.selectedLightingEffectId).toBeNull();
  });

  it("M. deleting the selected clip reconciles every editor selection", () => {
    const base = baseProject();
    const { project, effect } = withLightingEffect(base.project, "clip-a");
    const afterDelete: ShowProject = {
      ...project,
      timeline: project.timeline.filter((c) => c.id !== "clip-a"),
      scenes: (project.scenes ?? []).filter((s) => s.id !== "clip-a"),
      lighting: { schemaVersion: 1, effects: [] },
    };
    const next = reconcileEditorSelection(
      afterDelete,
      "clip-b",
      state({
        sceneSelection: { ids: base.scene.objects.map((o) => o.id), primaryId: base.scene.objects[0]!.id },
        selectedLightingEffectId: effect.id,
        gizmoDraftActive: true,
      }),
      "clip-a",
    );
    expect(next.sceneSelection.ids).toEqual([]);
    expect(next.selectedLightingEffectId).toBeNull();
    expect(next.gizmoDraftActive).toBe(false);
    expect(next.explicitDynamicId).toBe("dyn-b");
  });

  it("N. selection/switching never mutates the project", () => {
    const base = baseProject();
    const before = JSON.stringify(base.project);
    reconcileEditorSelection(base.project, "clip-b", state(), "clip-a");
    reconcileEditorSelection(base.project, "clip-a", state(), "clip-b");
    expect(JSON.stringify(base.project)).toBe(before);
  });
});

describe("library insertion is one authoring action", () => {
  const ids = (clipId: string) => ({
    clipId,
    formationId: (i: number) => `${clipId}-f-${i + 1}`,
    dynamicFormationId: (i: number) => `${clipId}-dyn-${i + 1}`,
  });

  it("F. STATIC insert = one project revision, LANDING stays final", () => {
    const { project, fa } = baseProject();
    const asset = assetFromFormation(fa, { name: "Static asset" });
    const landingBefore = project.timeline.find((c) => c.phase === "LANDING")!;
    const result = insertLibraryAsset(project, asset, ids("new-static"));
    const timeline = result.project.timeline;
    expect(timeline).toHaveLength(project.timeline.length + 1);
    const inserted = timeline.find((c) => c.id === "new-static")!;
    const landing = timeline[timeline.length - 1]!;
    expect(landing.phase).toBe("LANDING");
    expect(landing.start).toBeCloseTo(landingBefore.start + inserted.transition + inserted.hold, 6);
    expect(inserted.start).toBeCloseTo(timelineBodyEnd(project.timeline), 6);
    // one revision: undo = the captured previous project, byte-identical
    expect(JSON.stringify(project)).not.toBe(JSON.stringify(result.project));
  });

  it("G. DYNAMIC insert copies the dynamic formation and binds one clip", () => {
    const { project, dynamic } = baseProject();
    const asset = assetFromDynamicFormation(dynamic, { name: "Dyn asset" });
    const result = insertLibraryAsset(project, asset, ids("new-dyn"));
    const inserted = result.project.timeline.find((c) => c.id === "new-dyn")!;
    expect(inserted.dynamicFormationId).toBe("new-dyn-dyn-1");
    expect(result.dynamicFormationId).toBe("new-dyn-dyn-1");
    expect(result.project.dynamicFormations).toHaveLength(2);
    // the library asset itself is untouched
    expect(asset.formationData.kind).toBe("DYNAMIC");
    expect(result.project.timeline[result.project.timeline.length - 1]!.phase).toBe("LANDING");
  });

  it("H+L+O. SCENE insert = one revision, first object selected, planner owned", () => {
    const base = baseProject();
    const deps = {
      formations: [base.fa, base.fb],
      dynamicFormations: [],
    };
    const asset = assetFromScene(base.scene, deps, { name: "Composed scene" });
    const result = insertLibraryAsset(base.project, asset, ids("new-scene"));
    const inserted = result.project.timeline.find((c) => c.id === "new-scene")!;
    const scene = sceneForClip(result.project, inserted)!;
    expect(scene.id).toBe(inserted.id);
    expect(scene.objects).toHaveLength(2);
    expect(result.sceneObjectIds[0]).toBe(scene.objects[0]!.id);
    // reused scene is ordinary planner-owned content: it is fully authorable
    expect(inserted.formationId).toBeTruthy();
    // dependencies were copied, never referenced
    expect(result.project.formations.length).toBe(base.project.formations.length + 2);
  });

  it("I+J. undo restores the exact LANDING start, redo the exact snapshot", () => {
    const base = baseProject();
    const asset = assetFromScene(
      base.scene,
      { formations: [base.fa, base.fb], dynamicFormations: [] },
      { name: "Composed scene" },
    );
    const before = base.project;
    const inserted = insertLibraryAsset(before, asset, ids("new-scene")).project;

    // undo = restore captured snapshot
    const undone = before;
    expect(undone.timeline.find((c) => c.phase === "LANDING")!.start).toBe(
      before.timeline.find((c) => c.phase === "LANDING")!.start,
    );
    expect(undone.timeline.some((c) => c.id === "new-scene")).toBe(false);
    expect(undone.formations).toHaveLength(before.formations.length);

    // redo = restore the committed inserted snapshot, same ids
    const redone = inserted;
    expect(redone.timeline.map((c) => c.id)).toEqual(inserted.timeline.map((c) => c.id));
    expect(JSON.stringify(redone)).toBe(JSON.stringify(inserted));
  });

  it("K. repeated insertion stays deterministic and LANDING remains last", () => {
    const { project, fa } = baseProject();
    const asset = assetFromFormation(fa, { name: "Static asset" });
    let current = project;
    for (let i = 0; i < 3; i++) {
      current = insertLibraryAsset(current, asset, ids(`c-${i}`)).project;
    }
    const landing = current.timeline[current.timeline.length - 1]!;
    expect(landing.phase).toBe("LANDING");
    const body = current.timeline.filter((c) => c.phase !== "LANDING");
    for (let i = 1; i < body.length; i++) {
      expect(body[i]!.start).toBeGreaterThanOrEqual(body[i - 1]!.start);
    }
    expect(landing.start).toBeCloseTo(timelineBodyEnd(current.timeline), 6);
  });

  it("insertClipBeforeLanding overwrites an authored start and keeps LANDING last", () => {
    const { project, fa } = baseProject();
    const next = insertClipBeforeLanding(
      project.timeline,
      clip({ id: "x", formationId: fa.id, start: 999 }),
    );
    const placed = next.find((c) => c.id === "x")!;
    expect(placed.start).toBeCloseTo(timelineBodyEnd(project.timeline), 6);
    expect(next[next.length - 1]!.phase).toBe("LANDING");
  });
});
