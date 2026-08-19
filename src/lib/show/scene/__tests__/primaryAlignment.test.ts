import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../../defaultProject";
import { makeFormation } from "../../formations";
import { objectCentre } from "../group";
import { alignSceneObjectsBy } from "../design";
import { IDENTITY_INSTANCE_TRANSFORM, SCENE_SCHEMA_VERSION, type FormationScene } from "../types";

function fixture() {
  const base = createDefaultProject(3);
  const formation = makeFormation("f", "F", "grid", 3, base.area);
  const project = { ...base, formations: [formation] };
  const makeObject = (id: string, y: number) => ({
    id,
    name: id,
    source: { kind: "STATIC" as const, formationId: formation.id },
    transform: { ...IDENTITY_INSTANCE_TRANSFORM, position: [0, y, 0] as const },
  });
  const scene: FormationScene = {
    id: "clip",
    name: "Primary altitude",
    schemaVersion: SCENE_SCHEMA_VERSION,
    transform: IDENTITY_INSTANCE_TRANSFORM,
    objects: [makeObject("a", 10), makeObject("b", 20), makeObject("c", 30)],
  };
  return { project, scene };
}

describe("primary-object alignment", () => {
  it("MATCH_ALTITUDE keeps the primary fixed and moves siblings to its world Y", () => {
    const { project, scene } = fixture();
    const beforePrimary = objectCentre(project, scene.objects[1]!);
    const result = alignSceneObjectsBy(project, scene, ["a", "b", "c"], "MATCH_ALTITUDE", "b");
    const centres = result.objects.map((object) => objectCentre(project, object));

    centres.forEach((centre) => expect(centre[1]).toBeCloseTo(beforePrimary[1], 9));
    expect(result.objects[1]).toEqual(scene.objects[1]);
  });

  it("falls back deterministically to the first selected scene object", () => {
    const { project, scene } = fixture();
    const target = objectCentre(project, scene.objects[0]!)[1];
    const result = alignSceneObjectsBy(project, scene, ["a", "b", "c"], "MATCH_ALTITUDE");

    result.objects.forEach((object) => expect(objectCentre(project, object)[1]).toBeCloseTo(target, 9));
  });

  it("an unknown primary id uses the deterministic fallback instead of moving unpredictably", () => {
    const { project, scene } = fixture();
    const target = objectCentre(project, scene.objects[0]!)[1];
    const result = alignSceneObjectsBy(project, scene, ["a", "b", "c"], "MATCH_ALTITUDE", "missing");

    result.objects.forEach((object) => expect(objectCentre(project, object)[1]).toBeCloseTo(target, 9));
  });
});
