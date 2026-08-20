import { describe, expect, it } from "vitest";

import { IDENTITY_INSTANCE_TRANSFORM, SCENE_SCHEMA_VERSION, type FormationScene } from "../../scene/types";
import {
  createEffectsFromPresetForTargets,
  findLightingPreset,
  lightingTargetsForSceneSelection,
} from "../index";

const scene: FormationScene = {
  id: "clip-1",
  name: "Bird",
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
      source: { kind: "STATIC", formationId: "f-right" },
      transform: IDENTITY_INSTANCE_TRANSFORM,
    },
  ],
};

describe("lighting authoring targets", () => {
  it("targets the whole scene for an empty selection", () => {
    expect(lightingTargetsForSceneSelection("clip-1", scene, [])).toEqual([
      { kind: "SCENE", clipId: "clip-1" },
    ]);
  });

  it("resolves selected objects in canonical scene order and ignores duplicates/stale ids", () => {
    expect(
      lightingTargetsForSceneSelection("clip-1", scene, [
        "right-wing",
        "stale",
        "left-wing",
        "right-wing",
      ]),
    ).toEqual([
      { kind: "SCENE_OBJECT", clipId: "clip-1", instanceId: "left-wing" },
      { kind: "SCENE_OBJECT", clipId: "clip-1", instanceId: "right-wing" },
    ]);
  });

  it("does not collapse an all-object selection to SCENE", () => {
    const targets = lightingTargetsForSceneSelection("clip-1", scene, [
      "body",
      "left-wing",
      "right-wing",
    ]);
    expect(targets).toHaveLength(3);
    expect(targets.every((target) => target.kind === "SCENE_OBJECT")).toBe(true);
  });

  it("falls back safely to the scene if selection contains only stale ids", () => {
    expect(lightingTargetsForSceneSelection("clip-1", scene, ["missing"])).toEqual([
      { kind: "SCENE", clipId: "clip-1" },
    ]);
  });

  it("creates one preset effect per target with deterministic unique ids", () => {
    const preset = findLightingPreset("FADE_IN");
    expect(preset).toBeDefined();
    const targets = lightingTargetsForSceneSelection("clip-1", scene, ["body", "left-wing"]);
    const effects = createEffectsFromPresetForTargets(preset!, targets, { idSeed: 100 });

    expect(effects).toHaveLength(2);
    expect(effects.map((effect) => effect.id)).toEqual(["fx-2s", "fx-2t"]);
    expect(effects.map((effect) => effect.target)).toEqual(targets);
    expect(effects.every((effect) => effect.type === "FADE_IN")).toBe(true);
  });
});
