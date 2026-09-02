import { describe, expect, it } from "vitest";

import { dynamicFromFormation } from "../../show/dynamic";
import { createDefaultProject } from "../../show/defaultProject";
import { addObject, emptyScene, upsertScene } from "../../show/scene";
import type { ShowProject } from "../../show/types";
import {
  duplicateObjectMotion,
  dynamicUsageCount,
  removeObjectMotion,
  sceneMotionState,
} from "../sceneMotionInspector";

function sceneProject(shared = false): {
  project: ShowProject;
  clipId: string;
  objectId: string;
  otherId: string | null;
  dynamicId: string;
} {
  const base = createDefaultProject(40);
  const formation = base.formations.find((candidate) => candidate.id === "f-sphere")!;
  const dynamic = dynamicFromFormation(formation, { id: "dyn-1", duration: 4 });
  const clip = {
    id: "clip",
    formationId: formation.id,
    start: 0,
    transition: 4,
    hold: 8,
    easing: "minJerk" as const,
    color: [255, 255, 255] as const,
    effect: "solid" as const,
    phase: "SHOW" as const,
  };
  const withClip = { ...base, timeline: [clip], dynamicFormations: [dynamic] };
  const first = addObject(withClip, emptyScene(clip.id, "Scene"), {
    source: { kind: "DYNAMIC", dynamicFormationId: dynamic.id },
    name: "SUPER RALY",
  });
  let scene = first.scene;
  let otherId: string | null = null;
  if (shared) {
    const second = addObject(withClip, scene, {
      source: { kind: "DYNAMIC", dynamicFormationId: dynamic.id },
      name: "Underline",
    });
    scene = second.scene;
    otherId = second.objectId;
  }
  return {
    project: upsertScene(withClip, scene),
    clipId: clip.id,
    objectId: first.objectId,
    otherId,
    dynamicId: dynamic.id,
  };
}

describe("scene motion state", () => {
  it("projects canonical playback data for the selected dynamic object", () => {
    const { project, clipId, objectId } = sceneProject();
    const state = sceneMotionState({
      clipId,
      scene: project.scenes![0]!,
      dynamics: project.dynamicFormations!,
      formationIds: project.formations.map((f) => f.id),
      primaryObjectId: objectId,
      selectionMode: "OBJECT",
      selectedPointIds: [],
    })!;
    expect(state.objectName).toBe("SUPER RALY");
    expect(state.cycleDuration).toBe(4);
    expect(state.playbackRate).toBe(1);
    expect(state.scope).toBe("OBJECT");
    expect(state.sharedBy).toBe(1);
    expect(state.canRestoreStatic).toBe(true);
  });

  it("returns nothing for static or missing selections", () => {
    const { project, clipId } = sceneProject();
    expect(
      sceneMotionState({
        clipId,
        scene: project.scenes![0]!,
        dynamics: [],
        formationIds: [],
        primaryObjectId: null,
        selectionMode: "OBJECT",
        selectedPointIds: [],
      }),
    ).toBeNull();
  });
});

describe("motion removal semantics", () => {
  it("restores the static source and drops the unused asset", () => {
    const { project, clipId, objectId, dynamicId } = sceneProject();
    const next = removeObjectMotion(project, clipId, objectId);
    expect(next.scenes![0]!.objects[0]!.source).toEqual({
      kind: "STATIC",
      formationId: "f-sphere",
    });
    expect(next.dynamicFormations ?? []).toHaveLength(0);
    expect(dynamicUsageCount(next.scenes![0]!, dynamicId)).toBe(0);
  });

  it("never deletes a shared asset still used by another object", () => {
    const { project, clipId, objectId, otherId, dynamicId } = sceneProject(true);
    const next = removeObjectMotion(project, clipId, objectId);
    expect(next.dynamicFormations).toHaveLength(1);
    const other = next.scenes![0]!.objects.find((o) => o.id === otherId)!;
    expect(other.source).toEqual({ kind: "DYNAMIC", dynamicFormationId: dynamicId });
  });
});

describe("motion duplication semantics", () => {
  it("creates an independent asset attached only to the selected object", () => {
    const { project, clipId, objectId, otherId, dynamicId } = sceneProject(true);
    const next = duplicateObjectMotion(project, clipId, objectId, "dyn-copy");
    expect(next.dynamicFormations).toHaveLength(2);
    const copy = next.dynamicFormations!.find((d) => d.id === "dyn-copy")!;
    expect(copy.points).toHaveLength(project.dynamicFormations![0]!.points.length);
    expect(copy.groups).not.toBe(project.dynamicFormations![0]!.groups);
    expect(next.scenes![0]!.objects.find((o) => o.id === objectId)!.source).toEqual({
      kind: "DYNAMIC",
      dynamicFormationId: "dyn-copy",
    });
    expect(next.scenes![0]!.objects.find((o) => o.id === otherId)!.source).toEqual({
      kind: "DYNAMIC",
      dynamicFormationId: dynamicId,
    });
  });
});
