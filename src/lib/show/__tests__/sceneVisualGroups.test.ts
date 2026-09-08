import { describe, expect, it } from "vitest";

import { parseProjectFile, serializeProject } from "../../project/serialize";
import { createDefaultProject } from "../defaultProject";
import {
  addObject,
  addSceneVisualStateCue,
  addSceneVisualGroup,
  applySceneVisualState,
  captureSceneVisualState,
  createSceneEvaluator,
  emptyScene,
  patchSceneVisualStateCue,
  removeObject,
  removeSceneVisualGroup,
  renameSceneVisualGroup,
  renameSceneVisualState,
  resolveSceneAt,
  sceneAtVisualStateTime,
  sanitizeScenes,
} from "../scene";

function fixture() {
  const project = createDefaultProject(30);
  let scene = emptyScene("clip-visual", "Visual scene");
  const ids: string[] = [];
  for (const formation of project.formations.slice(0, 3)) {
    const added = addObject(project, scene, {
      source: { kind: "STATIC", formationId: formation.id },
      name: formation.name,
    });
    scene = added.scene;
    ids.push(added.objectId);
  }
  return { project, scene, ids };
}

describe("scene visual groups", () => {
  it("groups objects without changing resolved flight geometry", () => {
    const { project, scene, ids } = fixture();
    const before = resolveSceneAt(project, scene, 0);
    const result = addSceneVisualGroup(scene, "Ring with sparkle", ids.slice(0, 2));
    expect(result.groupId).toBe("clip-visual-visual-1");
    expect(result.scene.visualGroups?.[0]?.objectIds).toEqual(ids.slice(0, 2));
    expect(resolveSceneAt(project, result.scene, 0)).toEqual(before);
  });

  it("regroups deterministically and never leaves one-object containers", () => {
    const { project, scene, ids } = fixture();
    const first = addSceneVisualGroup(scene, "First", ids.slice(0, 2)).scene;
    const second = addSceneVisualGroup(first, "Second", ids.slice(1, 3)).scene;
    expect(second.visualGroups).toHaveLength(1);
    expect(second.visualGroups?.[0]?.objectIds).toEqual(ids.slice(1, 3));
  });

  it("renames and ungroups without removing visual objects", () => {
    const { scene, ids } = fixture();
    const created = addSceneVisualGroup(scene, "Visual", ids.slice(0, 2));
    const renamed = renameSceneVisualGroup(created.scene, created.groupId!, "Engagement ring");
    expect(renamed.visualGroups?.[0]?.name).toBe("Engagement ring");
    const ungrouped = removeSceneVisualGroup(renamed, created.groupId!);
    expect(ungrouped.visualGroups).toEqual([]);
    expect(ungrouped.objects).toEqual(scene.objects);
  });

  it("cleans memberships on object deletion and persisted input", () => {
    const { scene, ids } = fixture();
    const grouped = addSceneVisualGroup(scene, "All", ids).scene;
    expect(removeObject(grouped, ids[0]!).visualGroups?.[0]?.objectIds).toEqual(ids.slice(1));
    const sanitized = sanitizeScenes([
      {
        ...grouped,
        visualGroups: [
          { id: "valid", name: "Valid", objectIds: [ids[0], ids[1], "missing", ids[1]] },
          { id: "invalid", name: "Invalid", objectIds: [ids[0], "missing"] },
        ],
      },
    ]);
    expect(sanitized[0]?.visualGroups).toEqual([
      { id: "valid", name: "Valid", objectIds: ids.slice(0, 2) },
    ]);
  });

  it("survives project save and reopen", () => {
    const { project, scene, ids } = fixture();
    const grouped = addSceneVisualGroup(scene, "Reusable visual", ids.slice(0, 2)).scene;
    const envelope = serializeProject({ ...project, scenes: [grouped] });
    const reopened = parseProjectFile(JSON.stringify(envelope)).project;
    expect(reopened.scenes?.[0]?.visualGroups).toEqual(grouped.visualGroups);
  });

  it("captures and restores a complete visual state without duplicating assets", () => {
    const { project, scene, ids } = fixture();
    const grouped = addSceneVisualGroup(scene, "Logo", ids.slice(0, 2)).scene;
    const captured = captureSceneVisualState(grouped, grouped.visualGroups![0]!.id, "Normal");
    expect(captured.stateId).toBeTruthy();
    const changed = {
      ...captured.scene,
      objects: captured.scene.objects.map((object, index) =>
        index < 2
          ? {
              ...object,
              visible: false,
              transform: { ...object.transform, position: [99, 99, 99] as const },
            }
          : object,
      ),
    };
    const restored = applySceneVisualState(changed, captured.stateId!);
    expect(restored.objects.slice(0, 2)).toEqual(scene.objects.slice(0, 2));
    expect(restored.objects.map((object) => object.source)).toEqual(
      scene.objects.map((object) => object.source),
    );
    expect(resolveSceneAt(project, restored, 0)).toEqual(resolveSceneAt(project, scene, 0));
  });

  it("persists states and removes them with their visual group", () => {
    const { project, scene, ids } = fixture();
    const grouped = addSceneVisualGroup(scene, "Logo", ids.slice(0, 2)).scene;
    const captured = captureSceneVisualState(grouped, grouped.visualGroups![0]!.id, "Draft");
    const renamed = renameSceneVisualState(captured.scene, captured.stateId!, "Final");
    const cued = addSceneVisualStateCue(renamed, captured.stateId!, 3, 1);
    expect(cued.ok).toBe(true);
    if (!cued.ok) return;
    const envelope = serializeProject({ ...project, scenes: [cued.scene] });
    const reopened = parseProjectFile(JSON.stringify(envelope)).project.scenes![0]!;
    expect(reopened.visualStates?.[0]?.name).toBe("Final");
    expect(reopened.visualStateCues?.[0]).toMatchObject({ time: 3, transitionDuration: 1 });
    expect(removeSceneVisualGroup(reopened, reopened.visualGroups![0]!.id).visualStates).toEqual(
      [],
    );
  });

  it("never restores an object after it leaves the captured group", () => {
    const { scene, ids } = fixture();
    const grouped = addSceneVisualGroup(scene, "Original", ids).scene;
    const captured = captureSceneVisualState(grouped, grouped.visualGroups![0]!.id, "Before");
    const regrouped = addSceneVisualGroup(captured.scene, "Other", ids.slice(1, 3)).scene;
    expect(regrouped.visualStates).toEqual([]);
    expect(applySceneVisualState(regrouped, captured.stateId!)).toBe(regrouped);
  });

  it("interpolates a compatible saved state on the canonical scene timeline", () => {
    const { project, scene, ids } = fixture();
    const grouped = addSceneVisualGroup(scene, "Logo", ids.slice(0, 2)).scene;
    const moved = {
      ...grouped,
      objects: grouped.objects.map((object, index) =>
        index < 2
          ? { ...object, transform: { ...object.transform, position: [10, 0, 0] as const } }
          : object,
      ),
    };
    const captured = captureSceneVisualState(moved, moved.visualGroups![0]!.id, "Right");
    const base = { ...captured.scene, objects: grouped.objects };
    const cued = addSceneVisualStateCue(base, captured.stateId!, 4, 2);
    expect(cued.ok).toBe(true);
    if (!cued.ok) return;
    expect(sceneAtVisualStateTime(cued.scene, 2).objects[0]!.transform.position).toEqual([0, 0, 0]);
    expect(sceneAtVisualStateTime(cued.scene, 3).objects[0]!.transform.position).toEqual([5, 0, 0]);
    expect(sceneAtVisualStateTime(cued.scene, 4).objects[0]!.transform.position).toEqual([
      10, 0, 0,
    ]);
    const evaluator = createSceneEvaluator(project, cued.scene);
    expect(evaluator.animated).toBe(true);
    expect(evaluator.positionsAt(3)).not.toEqual(evaluator.positionsAt(2));
  });

  it("rejects timed states that would change the scene drone topology", () => {
    const { scene, ids } = fixture();
    const grouped = addSceneVisualGroup(scene, "Logo", ids.slice(0, 2)).scene;
    const captured = captureSceneVisualState(grouped, grouped.visualGroups![0]!.id, "100 drones");
    const changed = {
      ...captured.scene,
      objects: captured.scene.objects.map((object, index) =>
        index === 0 ? { ...object, requestedDroneCount: 5 } : object,
      ),
    };
    const result = addSceneVisualStateCue(changed, captured.stateId!, 4, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("drone allocation");
  });

  it("clamps cue transitions to the hold boundary and prevents overlap", () => {
    const { scene, ids } = fixture();
    const grouped = addSceneVisualGroup(scene, "Logo", ids.slice(0, 2)).scene;
    const captured = captureSceneVisualState(grouped, grouped.visualGroups![0]!.id, "Pose");
    const first = addSceneVisualStateCue(captured.scene, captured.stateId!, 4, 3);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = addSceneVisualStateCue(first.scene, captured.stateId!, 5, 4);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.scene.visualStateCues?.map((cue) => cue.transitionDuration)).toEqual([3, 1]);
    const moved = patchSceneVisualStateCue(second.scene, second.cueId, {
      time: 2,
      transitionDuration: 8,
    });
    expect(moved.visualStateCues?.map((cue) => [cue.time, cue.transitionDuration])).toEqual([
      [2, 2],
      [4, 2],
    ]);
  });
});
