import { describe, expect, it } from "vitest";

import type { LightingEffectInstance } from "../../show/lighting";
import {
  LIGHTING_SELECTION_PRESETS,
  MOTION_SELECTION_PRESETS,
  UNSUPPORTED_MOTION_REQUESTS,
  directionAxis,
  effectPresetLabel,
  effectsForSelection,
  lightingPresetParameters,
  lightingPresetTiming,
  relevantInspectorControls,
  selectionEffectContext,
} from "../selectionEffects";

const names = new Map([
  ["text", "SUPER RALY"],
  ["line1", "Underline 1"],
]);
const counts = new Map([
  ["text", 110],
  ["line1", 20],
]);

const base = {
  clipId: "c-scene",
  objectNames: names,
  objectDroneCounts: counts,
} as const;

describe("selection effect context", () => {
  it("never targets the whole scene when nothing is selected", () => {
    const context = selectionEffectContext({
      ...base,
      selectionMode: "OBJECT",
      objectIds: [],
      primaryObjectId: null,
      pointIds: [],
    });
    expect(context.kind).toBe("NONE");
    expect(context.targets).toHaveLength(0);
    expect(context.canApply).toBe(false);
  });

  it("resolves object targets with drone counts", () => {
    const context = selectionEffectContext({
      ...base,
      selectionMode: "OBJECT",
      objectIds: ["text", "line1"],
      primaryObjectId: "text",
      pointIds: [],
    });
    expect(context.kind).toBe("OBJECTS");
    expect(context.droneCount).toBe(130);
    expect(context.targets.map((t) => t.kind)).toEqual(["SCENE_OBJECT", "SCENE_OBJECT"]);
  });

  it("resolves a point group target in DRONES mode", () => {
    const context = selectionEffectContext({
      ...base,
      selectionMode: "POINT",
      objectIds: ["text"],
      primaryObjectId: "text",
      pointIds: ["p1", "p2"],
    });
    expect(context.kind).toBe("DRONES");
    expect(context.droneCount).toBe(2);
    expect(context.targets[0]).toMatchObject({ kind: "POINT_GROUP", instanceId: "text" });
  });
});

describe("preset vocabulary", () => {
  it("maps every operator preset onto a canonical id", () => {
    expect(LIGHTING_SELECTION_PRESETS.every((p) => p.canonicalPresetId.length > 0)).toBe(true);
    expect(MOTION_SELECTION_PRESETS.map((p) => p.canonicalPresetId)).toEqual([
      "WAVE",
      "PULSE",
      "DRIFT",
      "ORBIT",
      "TWIST",
    ]);
  });

  it("declares ripple as unsupported instead of faking it", () => {
    expect(UNSUPPORTED_MOTION_REQUESTS).toContain("RIPPLE");
    expect(MOTION_SELECTION_PRESETS.some((p) => p.id === ("RIPPLE" as never))).toBe(false);
  });

  it("starts presets at the playhead", () => {
    expect(lightingPresetTiming("FADE_IN", 4.25)).toEqual({ anchor: "ABSOLUTE", start: 4.25 });
    expect(lightingPresetTiming("SOLID", 2)).toEqual({
      anchor: "ABSOLUTE",
      start: 2,
      duration: 0.05,
    });
  });

  it("builds only canonical parameters", () => {
    const params = lightingPresetParameters("GRADIENT_SWEEP", {
      primary: [255, 0, 0],
      secondary: [0, 0, 255],
      axis: "Y",
    });
    expect(params.stops).toHaveLength(2);
    expect(params.direction).toEqual([0, 1, 0]);
    expect(directionAxis(params.direction)).toBe("Y");
  });

  it("exposes only supported inspector controls", () => {
    expect(relevantInspectorControls("PULSE")).toContain("speed");
    expect(relevantInspectorControls("PULSE")).not.toContain("axis");
    expect(relevantInspectorControls("COLOR_SWEEP")).toContain("axis");
  });
});

const effect = (id: string, instanceId: string): LightingEffectInstance => ({
  id,
  type: "COLOR_TRANSITION",
  enabled: true,
  anchor: "ABSOLUTE",
  start: 0,
  duration: 1,
  priority: 0,
  blendMode: "REPLACE",

  parameters: {},
  target: { kind: "SCENE_OBJECT", clipId: "c-scene", instanceId },
  metadata: { presetId: "COLOR_TRANSITION" },
});

describe("effect scoping", () => {
  it("isolates effects per selected object", () => {
    const effects = [effect("a", "text"), effect("b", "line1")];
    const context = selectionEffectContext({
      ...base,
      selectionMode: "OBJECT",
      objectIds: ["line1"],
      primaryObjectId: "line1",
      pointIds: [],
    });
    expect(effectsForSelection(effects, context).map((e) => e.id)).toEqual(["b"]);
  });

  it("labels effects with their operator preset name", () => {
    expect(effectPresetLabel(effect("a", "text"))).toBe("Solid colour");
  });
});
