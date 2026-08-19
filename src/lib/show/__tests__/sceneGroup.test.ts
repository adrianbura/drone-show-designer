/**
 * SCENE MULTI-SELECT + GROUP TRANSFORM tests.
 *
 * Verifies the pure primitives the viewport gizmo and the batch panel drive:
 * selection invariants, deterministic group pivot, layout-preserving batch
 * translate / rotate / scale, mirror, duplicate, delete and mixed-value flags.
 * Nothing here plans trajectories — group editing is artistic composition only.
 */
import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../defaultProject";
import { makeFormation } from "../formations";
import {
  addObject,
  applySceneClick,
  applySceneGroupDelta,
  duplicateSceneObjects,
  EMPTY_SCENE_SELECTION,
  emptyScene,
  mirrorSceneObjects,
  mixedTransformFlags,
  normalizeSceneSelection,
  objectCentre,
  patchObjectTransform,
  removeSceneObjects,
  resolveSceneAt,
  sceneGroupPivot,
  selectAllSceneObjects,
  type FormationScene,
} from "../scene";
import type { ShowProject, Vector3Tuple } from "../types";

function fixture(): { project: ShowProject; scene: FormationScene; a: string; b: string } {
  const base = createDefaultProject(40);
  const f1 = makeFormation("f-a", "A", "grid", 8, base.area);
  const f2 = makeFormation("f-b", "B", "circle", 8, base.area);
  const project: ShowProject = { ...base, formations: [...base.formations, f1, f2] };
  let scene = emptyScene("clip-1", "Scene");
  const first = addObject(project, scene, { source: { kind: "STATIC", formationId: f1.id }, name: "A" });
  scene = first.scene;
  const second = addObject(project, scene, { source: { kind: "STATIC", formationId: f2.id }, name: "B" });
  scene = second.scene;
  scene = patchObjectTransform(scene, first.objectId, { position: [-10, 20, 0] });
  scene = patchObjectTransform(scene, second.objectId, { position: [10, 20, 0] });
  return { project, scene, a: first.objectId, b: second.objectId };
}

const round = (v: Vector3Tuple): Vector3Tuple => [
  Math.round(v[0] * 1e6) / 1e6,
  Math.round(v[1] * 1e6) / 1e6,
  Math.round(v[2] * 1e6) / 1e6,
];

describe("scene selection", () => {
  it("drops stale ids and always keeps a valid primary", () => {
    const { scene, a } = fixture();
    expect(normalizeSceneSelection(scene, ["ghost"], "ghost")).toEqual(EMPTY_SCENE_SELECTION);
    const sel = normalizeSceneSelection(scene, [a, a, "ghost"], "ghost");
    expect(sel.ids).toEqual([a]);
    expect(sel.primaryId).toBe(a);
  });

  it("replaces on plain click and toggles with Ctrl/Shift", () => {
    const { scene, a, b } = fixture();
    const one = applySceneClick(scene, EMPTY_SCENE_SELECTION, a, "REPLACE");
    expect(one.ids).toEqual([a]);
    const two = applySceneClick(scene, one, b, "TOGGLE");
    expect(two.ids).toEqual([a, b]);
    expect(two.primaryId).toBe(b);
    const back = applySceneClick(scene, two, b, "TOGGLE");
    expect(back.ids).toEqual([a]);
    expect(applySceneClick(scene, two, b, "REPLACE").ids).toEqual([b]);
  });

  it("selects every object of the scene", () => {
    const { scene, a, b } = fixture();
    expect(selectAllSceneObjects(scene, null).ids).toEqual([a, b]);
    expect(selectAllSceneObjects(null, null)).toEqual(EMPTY_SCENE_SELECTION);
  });
});

describe("group transforms", () => {
  it("uses the deterministic centroid of the selected objects as pivot", () => {
    const { project, scene, a, b } = fixture();
    const pivot = sceneGroupPivot(project, scene, [a, b]);
    const ca = objectCentre(project, scene.objects[0]!);
    const cb = objectCentre(project, scene.objects[1]!);
    expect(round(pivot)).toEqual(round([(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2]));
    expect(sceneGroupPivot(project, scene, [a, b])).toEqual(pivot);
  });

  it("translates every selected object by the same delta and leaves others alone", () => {
    const { project, scene, a } = fixture();
    const next = applySceneGroupDelta(project, scene, [a], { position: [5, -2, 3] });
    expect(next.objects[0]!.transform.position).toEqual([-5, 18, 3]);
    expect(next.objects[1]!.transform.position).toEqual(scene.objects[1]!.transform.position);
  });

  it("rotates the LAYOUT around the group pivot, not each object in place", () => {
    const { project, scene, a, b } = fixture();
    const pivot = sceneGroupPivot(project, scene, [a, b]);
    const before = scene.objects.map((o) => objectCentre(project, o));
    const next = applySceneGroupDelta(project, scene, [a, b], { rotationDeg: [0, 180, 0] });
    const after = next.objects.map((o) => objectCentre(project, o));
    // A 180 deg spin about +Y mirrors each centre through the pivot in X/Z.
    next.objects.forEach((_, i) => {
      expect(after[i]![0] - pivot[0]).toBeCloseTo(-(before[i]![0] - pivot[0]), 4);
      expect(after[i]![2] - pivot[2]).toBeCloseTo(-(before[i]![2] - pivot[2]), 4);
    });
    expect(next.objects[0]!.transform.rotationDeg[1]).toBeCloseTo(180, 5);
    // The pivot itself is invariant under the gesture.
    expect(round(sceneGroupPivot(project, next, [a, b]))).toEqual(round(pivot));
  });

  it("scales the layout distance and each instance scale", () => {
    const { project, scene, a, b } = fixture();
    const pivot = sceneGroupPivot(project, scene, [a, b]);
    const before = scene.objects.map((o) => objectCentre(project, o));
    const next = applySceneGroupDelta(project, scene, [a, b], { scaleFactor: 2 });
    const after = next.objects.map((o) => objectCentre(project, o));
    expect(next.objects[0]!.transform.scale).toBeCloseTo(2, 6);
    next.objects.forEach((_, i) => {
      expect(after[i]![0] - pivot[0]).toBeCloseTo((before[i]![0] - pivot[0]) * 2, 4);
      expect(after[i]![2] - pivot[2]).toBeCloseTo((before[i]![2] - pivot[2]) * 2, 4);
    });
  });

  it("is a no-op for an identity delta and never mutates the input scene", () => {
    const { project, scene, a, b } = fixture();
    const next = applySceneGroupDelta(project, scene, [a, b], {});
    expect(next.objects.map((o) => o.transform)).toEqual(scene.objects.map((o) => o.transform));
    expect(scene.objects[0]!.transform.position).toEqual([-10, 20, 0]);
  });

  it("mirrors, duplicates and deletes whole selections", () => {
    const { project, scene, a, b } = fixture();
    const mirrored = mirrorSceneObjects(scene, [a, b]);
    expect(mirrored.objects.every((o) => o.transform.mirrorX === true)).toBe(true);

    const dup = duplicateSceneObjects(scene, [a, b]);
    expect(dup.objectIds).toHaveLength(2);
    expect(dup.scene.objects).toHaveLength(4);
    expect(new Set(dup.scene.objects.map((o) => o.id)).size).toBe(4);
    // Duplicates are deterministic: same input, same ids.
    expect(duplicateSceneObjects(scene, [a, b]).objectIds).toEqual(dup.objectIds);

    const removed = removeSceneObjects(scene, [a]);
    expect(removed.objects.map((o) => o.id)).toEqual([b]);
    // Resolution still works after a batch delete.
    expect(resolveSceneAt(project, removed, 0).points.length).toBeGreaterThan(0);
  });

  it("reports mixed values per field across a selection", () => {
    const { scene, a, b } = fixture();
    const mixed = mixedTransformFlags(scene, [a, b]);
    expect(mixed.position).toBe(true);
    expect(mixed.scale).toBe(false);
    expect(mixedTransformFlags(scene, [a]).position).toBe(false);
  });
});
