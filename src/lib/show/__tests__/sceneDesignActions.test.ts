import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../defaultProject";
import { makeFormation } from "../formations";
import { addObject, emptyScene } from "../scene/edit";
import { objectCentre } from "../scene/group";
import {
  alignSceneObjects,
  distributeSceneObjects,
  matchSceneObjectAltitude,
} from "../scene/designActions";
import type { FormationScene } from "../scene/types";

function fixture() {
  let project = createDefaultProject();
  const formation = makeFormation("f-design", "Design", "grid", 12, project.area);
  project = { ...project, formations: [formation] };

  let scene: FormationScene = emptyScene("clip-design", "Design scene");
  scene = addObject(project, scene, {
    source: { kind: "STATIC", formationId: formation.id },
    name: "A",
  }).scene;
  scene = addObject(project, scene, {
    source: { kind: "STATIC", formationId: formation.id },
    name: "B",
  }).scene;
  scene = addObject(project, scene, {
    source: { kind: "STATIC", formationId: formation.id },
    name: "C",
  }).scene;

  const [a, b, c] = scene.objects;
  scene = {
    ...scene,
    objects: [
      { ...a!, transform: { ...a!.transform, position: [-6, 8, -3] } },
      { ...b!, transform: { ...b!.transform, position: [2, 14, 5] } },
      { ...c!, transform: { ...c!.transform, position: [10, 20, 1] } },
    ],
  };
  return { project, scene, ids: scene.objects.map((object) => object.id) };
}

const coordinate = (
  project: ReturnType<typeof createDefaultProject>,
  scene: FormationScene,
  id: string,
  axis: 0 | 1 | 2,
) => objectCentre(project, scene.objects.find((object) => object.id === id)!)[axis];

describe("scene design actions", () => {
  it("aligns selected centres on X without changing unselected object", () => {
    const { project, scene, ids } = fixture();
    const untouched = JSON.stringify(scene.objects[2]);
    const next = alignSceneObjects(project, scene, ids.slice(0, 2), "X", "CENTER");

    expect(coordinate(project, next, ids[0]!, 0)).toBeCloseTo(2, 9);
    expect(coordinate(project, next, ids[1]!, 0)).toBeCloseTo(2, 9);
    expect(JSON.stringify(next.objects[2])).toBe(untouched);
  });

  it("align MIN/MAX uses the selected extrema", () => {
    const { project, scene, ids } = fixture();
    const min = alignSceneObjects(project, scene, ids, "Z", "MIN");
    expect(ids.map((id) => coordinate(project, min, id, 2))).toEqual([-3, -3, -3]);

    const max = alignSceneObjects(project, scene, ids, "Z", "MAX");
    expect(ids.map((id) => coordinate(project, max, id, 2))).toEqual([5, 5, 5]);
  });

  it("matches altitude to the first selected object deterministically", () => {
    const { project, scene, ids } = fixture();
    const next = matchSceneObjectAltitude(project, scene, [ids[1]!, ids[0]!, ids[2]!]);
    expect(ids.map((id) => coordinate(project, next, id, 1))).toEqual([14, 14, 14]);
  });

  it("distributes X evenly while preserving the two extremes", () => {
    const { project, scene, ids } = fixture();
    const next = distributeSceneObjects(project, scene, ids, "X");
    const xs = ids.map((id) => coordinate(project, next, id, 0));
    expect(xs).toEqual([-6, 2, 10]);
  });

  it("distributes Z by existing coordinate order, not selection order", () => {
    const { project, scene, ids } = fixture();
    const next = distributeSceneObjects(project, scene, [ids[1]!, ids[2]!, ids[0]!], "Z");
    expect(coordinate(project, next, ids[0]!, 2)).toBe(-3);
    expect(coordinate(project, next, ids[2]!, 2)).toBe(1);
    expect(coordinate(project, next, ids[1]!, 2)).toBe(5);
  });

  it("is a no-op for insufficient selections and never mutates input", () => {
    const { project, scene, ids } = fixture();
    const before = JSON.stringify(scene);
    expect(alignSceneObjects(project, scene, [ids[0]!], "X", "CENTER")).toBe(scene);
    expect(matchSceneObjectAltitude(project, scene, [ids[0]!])).toBe(scene);
    expect(distributeSceneObjects(project, scene, ids.slice(0, 2), "X")).toBe(scene);
    expect(JSON.stringify(scene)).toBe(before);
  });
});
