import { describe, expect, it } from "vitest";

import {
  describeLightingAuthoringTargets,
  lightingTargetsFromSceneSelection,
} from "../authoring";
import {
  IDENTITY_INSTANCE_TRANSFORM,
  SCENE_SCHEMA_VERSION,
  type FormationScene,
} from "../../scene/types";

const scene: FormationScene = {
  id: "clip-1",
  name: "Scene",
  schemaVersion: SCENE_SCHEMA_VERSION,
  transform: IDENTITY_INSTANCE_TRANSFORM,
  objects: [
    {
      id: "body",
      name: "Body",
      source: { kind: "STATIC", formationId: "f-body" },
      transform: IDENTITY_INSTANCE_TRANSFORM,
    },
    {
      id: "left-wing",
      name: "Left wing",
      source: { kind: "STATIC", formationId: "f-left" },
      transform: IDENTITY_INSTANCE_TRANSFORM,
    },
    {
      id: "right-wing",
      name: "Right wing",
      source: { kind: "DYNAMIC", dynamicFormationId: "d-right" },
      transform: IDENTITY_INSTANCE_TRANSFORM,
    },
  ],
};

describe("lightingTargetsFromSceneSelection", () => {
  it("targets the whole scene when there is no object selection", () => {
    expect(lightingTargetsFromSceneSelection("clip-1", scene, [])).toEqual({
      scope: "SCENE",
      objectIds: [],
      targets: [{ kind: "SCENE", clipId: "clip-1" }],
    });
  });

  it("targets selected objects in scene order, not click order", () => {
    expect(
      lightingTargetsFromSceneSelection("clip-1", scene, ["right-wing", "body"]),
    ).toEqual({
      scope: "SELECTION",
      objectIds: ["body", "right-wing"],
      targets: [
        { kind: "SCENE_OBJECT", clipId: "clip-1", instanceId: "body" },
        { kind: "SCENE_OBJECT", clipId: "clip-1", instanceId: "right-wing" },
      ],
    });
  });

  it("ignores duplicates and stale ids", () => {
    const resolved = lightingTargetsFromSceneSelection("clip-1", scene, [
      "left-wing",
      "missing",
      "left-wing",
    ]);
    expect(resolved.objectIds).toEqual(["left-wing"]);
    expect(resolved.targets).toEqual([
      { kind: "SCENE_OBJECT", clipId: "clip-1", instanceId: "left-wing" },
    ]);
  });

  it("falls back to SCENE when the selection is entirely stale", () => {
    expect(lightingTargetsFromSceneSelection("clip-1", scene, ["missing"]).scope).toBe("SCENE");
  });

  it("does not collapse all selected objects to SCENE", () => {
    const resolved = lightingTargetsFromSceneSelection(
      "clip-1",
      scene,
      scene.objects.map((object) => object.id),
    );
    expect(resolved.scope).toBe("SELECTION");
    expect(resolved.targets).toHaveLength(3);
    expect(resolved.targets.every((target) => target.kind === "SCENE_OBJECT")).toBe(true);
  });

  it("works without an authored scene by targeting the clip scene as a whole", () => {
    expect(lightingTargetsFromSceneSelection("legacy-clip", null, ["stale"])).toEqual({
      scope: "SCENE",
      objectIds: [],
      targets: [{ kind: "SCENE", clipId: "legacy-clip" }],
    });
  });

  it("provides presentation-neutral summary data", () => {
    const resolved = lightingTargetsFromSceneSelection("clip-1", scene, ["body", "left-wing"]);
    expect(describeLightingAuthoringTargets(resolved)).toEqual({
      scope: "SELECTION",
      targetCount: 2,
    });
  });
});
