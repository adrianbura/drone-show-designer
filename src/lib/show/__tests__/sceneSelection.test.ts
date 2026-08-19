import { describe, expect, it } from "vitest";

import {
  SCENE_SCHEMA_VERSION,
  canonicalSceneSelection,
  duplicateSceneSelection,
  mirrorSceneSelectionX,
  reconcileSceneSelection,
  replaceSceneSelection,
  rotateSceneSelection,
  scaleSceneSelection,
  selectAllSceneObjects,
  toggleSceneSelection,
  translateSceneSelection,
  type FormationScene,
  type SceneFormationInstance,
} from "../scene";

function object(id: string, x: number): SceneFormationInstance {
  return {
    id,
    name: id,
    source: { kind: "STATIC", formationId: `formation-${id}` },
    transform: {
      position: [x, 0, 0],
      rotationDeg: [0, 0, 0],
      scale: 1,
    },
  };
}

function scene(): FormationScene {
  return {
    id: "clip-1",
    name: "Selection test",
    schemaVersion: SCENE_SCHEMA_VERSION,
    objects: [object("a", -10), object("b", 0), object("c", 10)],
    transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1 },
  };
}

describe("scene multi-selection editing", () => {
  it("canonicalises selection to scene order, removes duplicates and ignores unknown ids", () => {
    expect(canonicalSceneSelection(scene(), ["c", "missing", "a", "c"])).toEqual(["a", "c"]);
  });

  it("implements Windows-first plain click, Ctrl/Shift toggle and Ctrl+A semantics", () => {
    const source = scene();
    expect(replaceSceneSelection(source, "b")).toEqual({ objectIds: ["b"], primaryObjectId: "b" });

    const withC = toggleSceneSelection(source, { objectIds: ["b"], primaryObjectId: "b" }, "c");
    expect(withC).toEqual({ objectIds: ["b", "c"], primaryObjectId: "c" });

    const withoutC = toggleSceneSelection(source, withC, "c");
    expect(withoutC).toEqual({ objectIds: ["b"], primaryObjectId: "b" });

    expect(selectAllSceneObjects(source)).toEqual({
      objectIds: ["a", "b", "c"],
      primaryObjectId: "a",
    });
  });

  it("reconciles stale ids and guarantees primary belongs to selection", () => {
    expect(
      reconcileSceneSelection(scene(), {
        objectIds: ["missing", "c", "a"],
        primaryObjectId: "missing",
      }),
    ).toEqual({ objectIds: ["a", "c"], primaryObjectId: "a" });
  });

  it("translates only selected objects and keeps unselected object identity", () => {
    const source = scene();
    const untouched = source.objects[1];
    const next = translateSceneSelection(source, ["a", "c"], [2, 3, 4]);

    expect(next).not.toBe(source);
    expect(next.objects[0]?.transform.position).toEqual([-8, 3, 4]);
    expect(next.objects[1]).toBe(untouched);
    expect(next.objects[2]?.transform.position).toEqual([12, 3, 4]);
    expect(source.objects[0]?.transform.position).toEqual([-10, 0, 0]);
  });

  it("rotates and scales selected instances independently without moving their centres", () => {
    const source = scene();
    const rotated = rotateSceneSelection(source, ["b"], [5, 10, 15]);
    const scaled = scaleSceneSelection(rotated, ["b"], 1.5);

    expect(scaled.objects[1]?.transform.rotationDeg).toEqual([5, 10, 15]);
    expect(scaled.objects[1]?.transform.scale).toBe(1.5);
    expect(scaled.objects[1]?.transform.position).toEqual([0, 0, 0]);
    expect(scaled.objects[0]?.transform.scale).toBe(1);
  });

  it("clamps scale and rejects invalid scale factors as no-ops", () => {
    const source = scene();
    expect(scaleSceneSelection(source, ["a"], Number.NaN)).toBe(source);
    expect(scaleSceneSelection(source, ["a"], 0)).toBe(source);

    const tiny = scaleSceneSelection(source, ["a"], 0.001, 0.05);
    expect(tiny.objects[0]?.transform.scale).toBe(0.05);
  });

  it("toggles mirror on every selected object", () => {
    const once = mirrorSceneSelectionX(scene(), ["a", "c"]);
    const twice = mirrorSceneSelectionX(once, ["a", "c"]);

    expect(once.objects[0]?.transform.mirrorX).toBe(true);
    expect(once.objects[1]?.transform.mirrorX).toBeUndefined();
    expect(once.objects[2]?.transform.mirrorX).toBe(true);
    expect(twice.objects[0]?.transform.mirrorX).toBe(false);
    expect(twice.objects[2]?.transform.mirrorX).toBe(false);
  });

  it("duplicates a selection in canonical order with fresh ids and requested offset", () => {
    const source = scene();
    const result = duplicateSceneSelection(source, ["c", "a"], [1, 2, 0]);

    expect(result.objectIds).toHaveLength(2);
    expect(new Set(result.objectIds).size).toBe(2);
    expect(result.scene.objects).toHaveLength(5);

    const firstCopy = result.scene.objects.find((o) => o.id === result.objectIds[0]);
    const secondCopy = result.scene.objects.find((o) => o.id === result.objectIds[1]);
    expect(firstCopy?.transform.position).toEqual([-9, 2, 0]);
    expect(secondCopy?.transform.position).toEqual([11, 2, 0]);

    expect(source.objects).toHaveLength(3);
  });
});
