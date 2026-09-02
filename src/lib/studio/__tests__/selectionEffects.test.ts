import { describe, expect, it } from "vitest";

import {
  SELECTION_LIGHTING_PRESETS,
  SELECTION_MOTION_PRESETS,
  axisOfVector,
  axisVector,
  colorPatchFor,
  effectColors,
  effectDisplayLabel,
  findSelectionLightingPreset,
  pulseSpeed,
  relevantEffectControls,
  selectionEffectContext,
  selectionLightingParameters,
  selectionLightingTargets,
} from "../selectionEffects";
import { DYNAMIC_PRESETS } from "../../show/dynamic";
import { LIGHTING_PRESETS, createEffectFromPreset, findLightingPreset } from "../../show/lighting";

const objects = [
  { id: "o1", name: "SUPER RALY" },
  { id: "o2", name: "Underline 1" },
];

const base = {
  objects,
  droneCountOf: (id: string) => (id === "o1" ? 120 : 15),
};

describe("selection effect presets", () => {
  it("maps every everyday lighting preset onto an EXISTING canonical preset", () => {
    for (const preset of SELECTION_LIGHTING_PRESETS) {
      expect(LIGHTING_PRESETS.some((p) => p.id === preset.canonicalPresetId)).toBe(true);
      expect(preset.description.length).toBeGreaterThan(10);
    }
  });

  it("maps every everyday motion preset onto an EXISTING canonical dynamic preset", () => {
    for (const preset of SELECTION_MOTION_PRESETS) {
      expect(DYNAMIC_PRESETS.some((p) => p.id === preset.canonicalPreset)).toBe(true);
      expect(preset.description.length).toBeGreaterThan(10);
    }
  });

  it("only emits canonical lighting parameter fields", () => {
    const choice = {
      primary: [10, 20, 30] as const,
      secondary: [40, 50, 60] as const,
      axis: "Y" as const,
    };
    const solid = selectionLightingParameters(findSelectionLightingPreset("SOLID_COLOUR"), choice);
    expect(solid).toEqual({ fromColor: [10, 20, 30], toColor: [10, 20, 30] });

    const gradient = selectionLightingParameters(
      findSelectionLightingPreset("GRADIENT_SWEEP"),
      choice,
    );
    expect(gradient.direction).toEqual([0, 1, 0]);
    expect(gradient.stops).toEqual([
      { position: 0, color: [10, 20, 30] },
      { position: 1, color: [40, 50, 60] },
    ]);

    expect(selectionLightingParameters(findSelectionLightingPreset("FADE_IN"), choice)).toEqual({});
  });
});

describe("selection context", () => {
  it("describes an object selection with its canonical drone count", () => {
    const context = selectionEffectContext({
      ...base,
      mode: "OBJECT",
      selectedObjectIds: ["o1", "o2"],
      primaryObjectId: "o1",
      selectedPointIds: [],
    });
    expect(context.kind).toBe("OBJECTS");
    expect(context.droneCount).toBe(135);
    expect(context.objectCount).toBe(2);
    expect(context.empty).toBe(false);
  });

  it("describes a drone-point selection", () => {
    const context = selectionEffectContext({
      ...base,
      mode: "POINT",
      selectedObjectIds: ["o1"],
      primaryObjectId: "o1",
      selectedPointIds: ["p1", "p2", "p3"],
    });
    expect(context.kind).toBe("DRONES");
    expect(context.droneCount).toBe(3);
    expect(context.label).toContain("SUPER RALY");
  });

  it("warns instead of widening when nothing is selected", () => {
    const context = selectionEffectContext({
      ...base,
      mode: "OBJECT",
      selectedObjectIds: [],
      primaryObjectId: null,
      selectedPointIds: [],
    });
    expect(context.kind).toBe("NONE");
    expect(context.empty).toBe(true);
    expect(
      selectionLightingTargets("clip-1", {
        ...base,
        mode: "OBJECT",
        selectedObjectIds: [],
        primaryObjectId: null,
        selectedPointIds: [],
      }),
    ).toEqual([]);
  });

  it("produces canonical targets, one per selected object", () => {
    expect(
      selectionLightingTargets("clip-1", {
        ...base,
        mode: "OBJECT",
        selectedObjectIds: ["o1", "o2"],
        primaryObjectId: "o1",
        selectedPointIds: [],
      }),
    ).toEqual([
      { kind: "SCENE_OBJECT", clipId: "clip-1", instanceId: "o1" },
      { kind: "SCENE_OBJECT", clipId: "clip-1", instanceId: "o2" },
    ]);

    expect(
      selectionLightingTargets("clip-1", {
        ...base,
        mode: "POINT",
        selectedObjectIds: ["o1"],
        primaryObjectId: "o1",
        selectedPointIds: ["p1"],
      }),
    ).toEqual([{ kind: "POINT_GROUP", clipId: "clip-1", instanceId: "o1", pointIds: ["p1"] }]);
  });
});

describe("effect inspector relevance", () => {
  const target = { kind: "SCENE" as const, clipId: "clip-1" };
  const make = (presetId: string) =>
    createEffectFromPreset(findLightingPreset(presetId)!, target, { idSeed: 1 });

  it("shows only the controls the canonical type consumes", () => {
    expect(relevantEffectControls("FADE_IN")).not.toContain("DIRECTION");
    expect(relevantEffectControls("PULSE")).toContain("SPEED");
    expect(relevantEffectControls("COLOR_SWEEP")).toContain("DIRECTION");
    expect(relevantEffectControls("COLOR_SWEEP")).toContain("SECONDARY_COLOR");
    expect(relevantEffectControls("FADE_OUT")).not.toContain("SPEED");
  });

  it("reads and patches colours in canonical parameter fields", () => {
    const transition = make("COLOR_TRANSITION");
    expect(effectColors(transition).primary).toEqual([255, 255, 255]);
    expect(colorPatchFor(transition, "secondary", [1, 2, 3])).toEqual({ toColor: [1, 2, 3] });

    const sweep = make("COLOR_SWEEP");
    const patch = colorPatchFor(sweep, "primary", [9, 9, 9]);
    expect(patch.stops?.[0]?.color).toEqual([9, 9, 9]);
    expect(patch.stops).toHaveLength(sweep.parameters.stops!.length);
  });

  it("derives pulse speed from canonical cycles and duration", () => {
    const pulse = make("PULSE_2");
    expect(pulseSpeed(pulse)).toBe(1);
  });

  it("labels effects with their everyday preset name", () => {
    expect(effectDisplayLabel(make("PULSE_2"))).toBe("Pulse");
    expect(effectDisplayLabel(make("GROUP_SEQUENCE"))).toBe("group sequence");
  });

  it("round-trips axis vectors", () => {
    expect(axisOfVector(axisVector("Z"))).toBe("Z");
    expect(axisOfVector(undefined)).toBe("X");
  });
});
