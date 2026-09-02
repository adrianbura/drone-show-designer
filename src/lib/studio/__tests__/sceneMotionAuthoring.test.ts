import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../../show/defaultProject";
import { addObject, emptyScene, upsertScene } from "../../show/scene";
import { authorSceneMotion } from "../sceneMotionAuthoring";
import type { ShowProject } from "../../show/types";

function fixture() {
  const base = createDefaultProject(24);
  const clip = {
    id: "motion-clip",
    formationId: "f-sphere",
    start: 0,
    transition: 8,
    hold: 8,
    easing: "minJerk" as const,
    color: [255, 255, 255] as const,
    effect: "solid" as const,
    phase: "SHOW" as const,
  };
  let project: ShowProject = { ...base, timeline: [clip] };
  const first = addObject(project, emptyScene(clip.id, "Motion"), {
    source: { kind: "STATIC", formationId: "f-sphere" },
    name: "SVG",
    requestedDroneCount: 12,
  });
  const second = addObject(project, first.scene, {
    source: { kind: "STATIC", formationId: "f-sphere" },
    name: "Underline",
    requestedDroneCount: 12,
  });
  project = upsertScene(project, second.scene);
  return { project, clipId: clip.id, firstId: first.objectId, secondId: second.objectId };
}

describe("scene motion authoring", () => {
  it("promotes and animates multiple selected objects in one pure revision", () => {
    const { project, clipId, firstId, secondId } = fixture();
    let nextId = 0;
    const result = authorSceneMotion(project, {
      clipId,
      objectIds: [firstId, secondId],
      primaryObjectId: secondId,
      selectedPointIds: [],
      preset: "WAVE",
      createId: () => `dynamic-${++nextId}`,
    });
    expect(result.project).not.toBe(project);
    expect(project.dynamicFormations ?? []).toHaveLength(0);
    expect(result.dynamicFormationIds).toEqual(["dynamic-1", "dynamic-2"]);
    expect(result.project.dynamicFormations).toHaveLength(2);
    expect(
      result.project.scenes![0]!.objects.every((object) => object.source.kind === "DYNAMIC"),
    ).toBe(true);
    expect(result.project.dynamicFormations!.every((dynamic) => dynamic.groups.length > 0)).toBe(
      true,
    );
  });

  it("targets only selected points and preserves unrelated objects", () => {
    const { project, clipId, firstId, secondId } = fixture();
    const result = authorSceneMotion(project, {
      clipId,
      objectIds: [firstId, secondId],
      primaryObjectId: firstId,
      selectedPointIds: [`${firstId}#0`, `${firstId}#2`],
      preset: "PULSE",
      createId: () => "dynamic-selection",
    });
    const [first, second] = result.project.scenes![0]!.objects;
    expect(first!.source).toEqual({
      kind: "DYNAMIC",
      dynamicFormationId: "dynamic-selection",
    });
    expect(second!.source.kind).toBe("STATIC");
    const group = result.project.dynamicFormations![0]!.groups[0]!;
    expect(group.pointIds).toEqual(["FP-001", "FP-003"]);
    expect(group.keyframes.some((keyframe) => keyframe.scale > 1)).toBe(true);
  });

  it("adds another selected-point motion to the same canonical dynamic asset", () => {
    const { project, clipId, firstId } = fixture();
    const first = authorSceneMotion(project, {
      clipId,
      objectIds: [firstId],
      primaryObjectId: firstId,
      selectedPointIds: [`${firstId}#0`],
      preset: "PULSE",
      createId: () => "dynamic-selection",
    });
    const second = authorSceneMotion(first.project, {
      clipId,
      objectIds: [firstId],
      primaryObjectId: firstId,
      selectedPointIds: [`${firstId}#FP-002`],
      preset: "WAVE",
      createId: () => "unused",
    });
    expect(second.project.dynamicFormations).toHaveLength(1);
    expect(second.project.dynamicFormations![0]!.groups).toHaveLength(2);
  });
});
