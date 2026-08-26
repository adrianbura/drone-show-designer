import { describe, expect, it } from "vitest";

import {
  canonicalStackPresetId,
  reorderEffect,
  stackColorParameters,
  stackOrder,
} from "../effectStack";
import { createEffectFromPreset, findLightingPreset } from "../../show/lighting";
import type { LightingEffectInstance } from "../../show/lighting";

const target = { kind: "SCENE_OBJECT" as const, clipId: "clip-1", instanceId: "o1" };

const make = (preset: string, priority: number, seed: number): LightingEffectInstance =>
  createEffectFromPreset(findLightingPreset(preset)!, target, {
    anchor: "SCENE_START",
    start: 0,
    priority,
    idSeed: seed,
  });

describe("effect stack", () => {
  it("maps everyday presets onto canonical lighting presets", () => {
    expect(canonicalStackPresetId("BASE_COLOR")).toBe("COLOR_TRANSITION");
    expect(canonicalStackPresetId("CHASE")).toBe("DIRECTIONAL_SWEEP");
  });

  it("produces everyday colour parameters without inventing effect types", () => {
    expect(stackColorParameters("BASE_COLOR", [10, 20, 30])).toEqual({ toColor: [10, 20, 30] });
    expect(stackColorParameters("PULSE", [10, 20, 30])).toEqual({ color: [10, 20, 30] });
    expect(stackColorParameters("GRADIENT", [10, 20, 30]).stops).toHaveLength(2);
  });

  it("reorders inside the scope without creating new effects", () => {
    const a = make(canonicalStackPresetId("FADE"), 0, 10);
    const b = make(canonicalStackPresetId("PULSE"), 1, 20);
    const list = [a, b];
    const reordered = reorderEffect(list, [a.id, b.id], b.id, -1);
    expect(reordered).toHaveLength(2);
    expect(reordered.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
    expect(stackOrder(reordered)[0]!.id).toBe(b.id);
  });

  it("is a no-op when the move leaves the stack", () => {
    const a = make(canonicalStackPresetId("FADE"), 0, 30);
    expect(reorderEffect([a], [a.id], a.id, -1)).toEqual([a]);
  });
});
