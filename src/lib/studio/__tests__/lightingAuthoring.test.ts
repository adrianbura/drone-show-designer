/**
 * LIGHTING AUTHORING UX — deterministic tests.
 *
 * Verifies that the designer surface only PREPARES canonical inputs: quick
 * presets exist in the preset engine, selection maps to canonical targets,
 * timing readouts come from the canonical anchor resolver, and an
 * object-targeted effect never leaks onto a sibling object. Positions must be
 * bit-identical for a lighting-only edit.
 */
import { describe, expect, it } from "vitest";

import { createDemoProject } from "@/lib/show/defaultProject";
import { makeFormation } from "@/lib/show/formations";
import {
  createEffectFromPreset,
  findLightingPreset,
  projectLightingAt,
  type LightingEffectInstance,
} from "@/lib/show/lighting";
import { addObject, emptyScene, patchObjectTransform } from "@/lib/show/scene";
import { buildShowPlan, positionsAt } from "@/lib/show/trajectory/schedule";
import { clipPhase, type ShowProject } from "@/lib/show/types";
import {
  QUICK_LIGHTING_PRESET_IDS,
  effectSwatch,
  effectTargetLabel,
  formatSeconds,
  lightingTargetsForSelection,
  presetUsesColor,
  quickLightingPresets,
  resolvedEffectInterval,
  targetReadout,
} from "../lightingAuthoring";

function twoObjectProject(): { project: ShowProject; clipId: string; a: string; b: string } {
  const base = createDemoProject(48);
  const fa = makeFormation("f-a", "Left Wing", "grid", 24, base.area);
  const fb = makeFormation("f-b", "Right Wing", "circle", 24, base.area);
  const withAssets: ShowProject = { ...base, formations: [...base.formations, fa, fb] };
  const clip = withAssets.timeline.find((c) => clipPhase(c) === "SHOW") ?? withAssets.timeline[0]!;
  let scene = emptyScene(clip.id, "Wings");
  const first = addObject(withAssets, scene, {
    source: { kind: "STATIC", formationId: fa.id },
    name: "Left Wing",
  });
  scene = first.scene;
  const second = addObject(withAssets, scene, {
    source: { kind: "STATIC", formationId: fb.id },
    name: "Right Wing",
  });
  scene = second.scene;
  scene = patchObjectTransform(scene, first.objectId, { position: [-25, 40, 0] });
  scene = patchObjectTransform(scene, second.objectId, { position: [25, 40, 0] });
  return {
    project: { ...withAssets, scenes: [scene] },
    clipId: clip.id,
    a: first.objectId,
    b: second.objectId,
  };
}

describe("quick lighting presets", () => {
  it("all quick ids resolve in the canonical preset engine", () => {
    for (const id of QUICK_LIGHTING_PRESET_IDS) expect(findLightingPreset(id), id).toBeTruthy();
    expect(quickLightingPresets()).toHaveLength(QUICK_LIGHTING_PRESET_IDS.length);
  });

  it("gradient presets are not driven by the single quick colour", () => {
    expect(presetUsesColor(findLightingPreset("FADE_IN")!)).toBe(true);
    expect(presetUsesColor(findLightingPreset("COLOR_TRANSITION")!)).toBe(false);
    expect(presetUsesColor(findLightingPreset("COLOR_SWEEP")!)).toBe(false);
  });
});

describe("selection to canonical targets", () => {
  it("empty selection means the whole scene", () => {
    expect(lightingTargetsForSelection("clip-1", [])).toEqual([{ kind: "SCENE", clipId: "clip-1" }]);
    expect(targetReadout([], [])).toEqual({ kind: "SCENE", names: [], count: 0 });
  });

  it("multi-selection produces one SCENE_OBJECT target per object", () => {
    const targets = lightingTargetsForSelection("clip-1", ["o1", "o2"]);
    expect(targets).toEqual([
      { kind: "SCENE_OBJECT", clipId: "clip-1", instanceId: "o1" },
      { kind: "SCENE_OBJECT", clipId: "clip-1", instanceId: "o2" },
    ]);
    const readout = targetReadout(
      [
        { id: "o1", name: "Left Wing" },
        { id: "o2", name: "Right Wing" },
      ],
      ["o1", "o2"],
    );
    expect(readout).toEqual({ kind: "OBJECTS", names: ["Left Wing", "Right Wing"], count: 2 });
  });
});

describe("timing readout uses the canonical anchor resolver", () => {
  const clip = { start: 10, transition: 4, hold: 6 };
  const base = createEffectFromPreset(findLightingPreset("FADE_IN")!, {
    kind: "SCENE",
    clipId: "c",
  });

  it("resolves each anchor to absolute show time", () => {
    const cases: Array<[LightingEffectInstance["anchor"], number]> = [
      ["ABSOLUTE", 1],
      ["SCENE_START", 11],
      ["FORMATION_READY", 15],
      ["SCENE_END", 21],
    ];
    for (const [anchor, expected] of cases) {
      const interval = resolvedEffectInterval({ ...base, anchor, start: 1 }, clip)!;
      expect(interval.start, anchor).toBeCloseTo(expected, 6);
      expect(interval.end - interval.start).toBeCloseTo(base.duration, 6);
    }
  });

  it("returns null without a governing clip and formats seconds", () => {
    expect(resolvedEffectInterval(base, null)).toBeNull();
    expect(formatSeconds(65.25)).toBe("1:05.3");
    expect(formatSeconds(-2)).toBe("-0:02.0");
  });
});

describe("effect layer readability helpers", () => {
  it("labels the effect target and exposes a swatch", () => {
    const objects = [{ id: "o1", name: "Left Wing" }];
    const scene = createEffectFromPreset(findLightingPreset("FADE_IN")!, {
      kind: "SCENE",
      clipId: "c",
    });
    expect(effectTargetLabel(scene, objects)).toBeNull();
    const object = createEffectFromPreset(
      findLightingPreset("FADE_IN")!,
      { kind: "SCENE_OBJECT", clipId: "c", instanceId: "o1" },
      { parameters: { color: [10, 20, 30] } },
    );
    expect(effectTargetLabel(object, objects)).toBe("Left Wing");
    expect(effectSwatch(object)).toEqual([10, 20, 30]);
    const transition = createEffectFromPreset(findLightingPreset("COLOR_TRANSITION")!, {
      kind: "SCENE",
      clipId: "c",
    });
    expect(effectSwatch(transition)).toEqual([40, 90, 255]);
    expect(effectSwatch(createEffectFromPreset(findLightingPreset("COLOR_SWEEP")!, {
      kind: "SCENE",
      clipId: "c",
    }))).toEqual([255, 255, 255]);
  });
});

describe("object-targeted lighting", () => {
  it("an effect on one object leaves the sibling object untouched", () => {
    const { project, clipId, a } = twoObjectProject();
    const plan = buildShowPlan(project);
    const clip = project.timeline.find((c) => c.id === clipId)!;
    const t = clip.start + clip.transition + 0.4;

    const effect: LightingEffectInstance = {
      ...createEffectFromPreset(
        findLightingPreset("FADE_IN")!,
        { kind: "SCENE_OBJECT", clipId, instanceId: a },
        { parameters: { color: [0, 0, 255] } },
      ),
      id: "fx-a",
      anchor: "FORMATION_READY",
      start: 0,
      duration: 2,
    };
    const lit: ShowProject = { ...project, lighting: { schemaVersion: 1, effects: [effect] } };

    const before = projectLightingAt({ project, participation: plan.participation }, t);
    const after = projectLightingAt({ project: lit, participation: plan.participation }, t);
    expect(after).toHaveLength(before.length);

    const changed = after.filter((s, i) => JSON.stringify(s) !== JSON.stringify(before[i]));
    const unchanged = after.filter((s, i) => JSON.stringify(s) === JSON.stringify(before[i]));
    expect(changed.length).toBeGreaterThan(0);
    expect(unchanged.length).toBeGreaterThan(0);

    // Lighting-only edit: not a single position may move.
    const litPlan = buildShowPlan(lit);
    expect(positionsAt(litPlan, t)).toEqual(positionsAt(plan, t));
  });

  it("multi-object authoring reaches both objects", () => {
    const { project, clipId, a, b } = twoObjectProject();
    const plan = buildShowPlan(project);
    const clip = project.timeline.find((c) => c.id === clipId)!;
    const t = clip.start + clip.transition + 0.4;
    const effects = lightingTargetsForSelection(clipId, [a, b]).map((target, i) => ({
      ...createEffectFromPreset(findLightingPreset("CENTER_TO_OUTSIDE")!, target, {
        parameters: { color: [255, 0, 0] },
      }),
      id: `fx-${i}`,
      anchor: "FORMATION_READY" as const,
      start: 0,
    }));
    const lit: ShowProject = { ...project, lighting: { schemaVersion: 1, effects } };

    const one: ShowProject = {
      ...project,
      lighting: { schemaVersion: 1, effects: [effects[0]!] },
    };
    const both = projectLightingAt({ project: lit, participation: plan.participation }, t);
    const single = projectLightingAt({ project: one, participation: plan.participation }, t);
    const base = projectLightingAt({ project, participation: plan.participation }, t);

    const diff = (list: typeof base) =>
      list.filter((s, i) => JSON.stringify(s) !== JSON.stringify(base[i])).length;
    expect(diff(both)).toBeGreaterThan(diff(single));
  });
});
