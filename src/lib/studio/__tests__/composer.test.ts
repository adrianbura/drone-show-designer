import { describe, expect, it } from "vitest";

import {
  EMPTY_COMPOSER_SELECTION,
  composerClick,
  composerDoubleClick,
  composerShiftClick,
  highlightedSlotIndices,
  reconcileComposerSelection,
  setComposerPointIds,
} from "../composerSelection";
import {
  canonicalStackPresetId,
  buildStackEffects,
  reorderEffect,
  setEffectEnabled,
  setEffectTimeScope,
  stackOrder,
} from "../effectStack";
import { IDENTITY_INSTANCE_TRANSFORM, type FormationScene } from "../../show/scene/types";

const scene: FormationScene = {
  id: "clip-1",
  name: "Scene",
  schemaVersion: 1,
  transform: IDENTITY_INSTANCE_TRANSFORM,
  objects: [
    {
      id: "o1",
      name: "Heart",
      source: { kind: "STATIC", formationId: "f1" },
      transform: IDENTITY_INSTANCE_TRANSFORM,
    },
    {
      id: "o2",
      name: "Wave",
      source: { kind: "DYNAMIC", dynamicFormationId: "d1" },
      transform: IDENTITY_INSTANCE_TRANSFORM,
    },
  ],
};

describe("composer selection", () => {
  it("replaces on click and toggles on shift-click", () => {
    let s = composerClick(scene, EMPTY_COMPOSER_SELECTION, "o1");
    expect(s.objects.ids).toEqual(["o1"]);
    s = composerShiftClick(scene, s, "o2");
    expect(s.objects.ids).toEqual(["o1", "o2"]);
    s = composerClick(scene, s, "o2");
    expect(s.objects.ids).toEqual(["o2"]);
  });

  it("enters point mode only for STATIC objects", () => {
    expect(composerDoubleClick(scene, EMPTY_COMPOSER_SELECTION, "o1").mode).toBe("POINT");
    expect(composerDoubleClick(scene, EMPTY_COMPOSER_SELECTION, "o2").mode).toBe("OBJECT");
  });

  it("drops point selection when reconciling against a scene without the object", () => {
    const point = setComposerPointIds(
      composerDoubleClick(scene, EMPTY_COMPOSER_SELECTION, "o1"),
      ["p1", "p1", "p2"],
    );
    expect(point.pointIds).toEqual(["p1", "p2"]);
    const gone = reconcileComposerSelection({ ...scene, objects: [scene.objects[1]!] }, point);
    expect(gone).toEqual(EMPTY_COMPOSER_SELECTION);
  });

  it("derives highlighted slots from the resolved scene", () => {
    const resolved = {
      sceneId: "clip-1",
      groups: [
        {
          groupId: "g1",
          instanceId: "o1",
          name: "Heart",
          formationId: "f1",
          offset: 0,
          pointCount: 3,
        },
        {
          groupId: "g2",
          instanceId: "o2",
          name: "Wave",
          formationId: null,
          offset: 3,
          pointCount: 2,
        },
      ],
      points: [],
      pointIds: [],
      animated: false,
    } as const;
    const s = composerClick(scene, EMPTY_COMPOSER_SELECTION, "o1");
    expect(highlightedSlotIndices(resolved, s)).toEqual([0, 1, 2]);
  });
});

describe("effect stack", () => {
  const targets = [{ kind: "SCENE_OBJECT" as const, clipId: "clip-1", instanceId: "o1" }];

  it("maps everyday presets onto canonical lighting presets", () => {
    expect(canonicalStackPresetId("BASE_COLOR")).toBe("COLOR_TRANSITION");
    expect(canonicalStackPresetId("CHASE")).toBe("DIRECTIONAL_SWEEP");
  });

  it("builds one canonical effect per target with increasing priority", () => {
    const first = buildStackEffects(targets, { preset: "FADE", idSeed: 1 });
    const second = buildStackEffects(targets, { preset: "PULSE", idSeed: 2 }, first);
    expect(first).toHaveLength(1);
    expect(second[0]!.priority).toBeGreaterThan(first[0]!.priority);
  });

  it("enables, time-scopes and reorders without creating new effects", () => {
    const a = buildStackEffects(targets, { preset: "FADE", idSeed: 10 })[0]!;
    const b = buildStackEffects(targets, { preset: "PULSE", idSeed: 20 }, [a])[0]!;
    let list = [a, b];
    list = setEffectEnabled(list, a.id, false);
    expect(list.find((e) => e.id === a.id)!.enabled).toBe(false);
    list = setEffectTimeScope(list, b.id, -5, 0);
    const scoped = list.find((e) => e.id === b.id)!;
    expect(scoped.start).toBe(0);
    expect(scoped.duration).toBeGreaterThan(0);
    const reordered = reorderEffect(list, [a.id, b.id], b.id, -1);
    expect(reordered).toHaveLength(2);
    expect(stackOrder(reordered)[0]!.id).toBe(b.id);
  });
});
