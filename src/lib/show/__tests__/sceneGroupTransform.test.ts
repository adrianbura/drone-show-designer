import { describe, expect, it } from "vitest";

import {
  SCENE_SCHEMA_VERSION,
  rotateSceneGroupLayout,
  scaleSceneGroupLayout,
  sceneGroupPivot,
  type FormationScene,
  type SceneFormationInstance,
} from "../scene";

function object(id: string, x: number, y = 0): SceneFormationInstance {
  return {
    id,
    name: id,
    source: { kind: "STATIC", formationId: `formation-${id}` },
    transform: {
      position: [x, y, 0],
      rotationDeg: [0, 0, 0],
      scale: 1,
    },
  };
}

function scene(): FormationScene {
  return {
    id: "clip-1",
    name: "Group transform",
    schemaVersion: SCENE_SCHEMA_VERSION,
    objects: [object("a", -10), object("b", 10), object("c", 30)],
    transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1 },
  };
}

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("scene group-layout transforms", () => {
  it("computes the deterministic centroid of selected world centres", () => {
    const source = scene();
    expect(
      sceneGroupPivot(source, ["c", "a"], {
        a: [-10, 2, 0],
        b: [10, 2, 0],
        c: [30, 2, 0],
      }),
    ).toEqual([10, 2, 0]);
  });

  it("rotates group layout around the shared pivot and preserves pairwise distance", () => {
    const source = scene();
    const centres = { a: [-10, 0, 0] as const, b: [10, 0, 0] as const };
    const before = distance(centres.a, centres.b);
    const next = rotateSceneGroupLayout(
      source,
      { objectIds: ["a", "b"], worldCentres: centres, pivot: [0, 0, 0] },
      [0, 0, 90],
    );

    expect(next.objects[0]?.transform.position[0]).toBeCloseTo(0, 9);
    expect(next.objects[0]?.transform.position[1]).toBeCloseTo(-10, 9);
    expect(next.objects[1]?.transform.position[0]).toBeCloseTo(0, 9);
    expect(next.objects[1]?.transform.position[1]).toBeCloseTo(10, 9);
    expect(next.objects[0]?.transform.rotationDeg).toEqual([0, 0, 90]);
    expect(next.objects[1]?.transform.rotationDeg).toEqual([0, 0, 90]);

    const after = distance(
      next.objects[0]!.transform.position,
      next.objects[1]!.transform.position,
    );
    expect(after).toBeCloseTo(before, 9);
    expect(next.objects[2]).toBe(source.objects[2]);
  });

  it("scales group layout around the shared pivot and multiplies object scales", () => {
    const source = scene();
    const next = scaleSceneGroupLayout(
      source,
      {
        objectIds: ["a", "b"],
        worldCentres: { a: [-10, 0, 0], b: [10, 0, 0] },
        pivot: [0, 0, 0],
      },
      1.5,
    );

    expect(next.objects[0]?.transform.position).toEqual([-15, 0, 0]);
    expect(next.objects[1]?.transform.position).toEqual([15, 0, 0]);
    expect(next.objects[0]?.transform.scale).toBe(1.5);
    expect(next.objects[1]?.transform.scale).toBe(1.5);
    expect(next.objects[2]).toBe(source.objects[2]);
  });

  it("treats invalid scale as a no-op", () => {
    const source = scene();
    expect(
      scaleSceneGroupLayout(
        source,
        {
          objectIds: ["a", "b"],
          worldCentres: { a: [-10, 0, 0], b: [10, 0, 0] },
          pivot: [0, 0, 0],
        },
        Number.NaN,
      ),
    ).toBe(source);
  });
});
