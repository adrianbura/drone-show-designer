import { describe, expect, it } from "vitest";

import { createDemoProject } from "../defaultProject";
import {
  applyInstanceTransform,
  applyInverseInstanceTransform,
  materializeStaticSceneGeometryProposal,
  resolveSceneAt,
} from "../scene";
import type { FormationScene, InstanceTransform } from "../scene/types";
import type { ShowProject, Vector3Tuple } from "../types";

function sceneProject(): { project: ShowProject; scene: FormationScene } {
  const base = createDemoProject();
  const formation = base.formations[0]!;
  const clip = base.timeline.find((candidate) => (candidate.phase ?? "SHOW") === "SHOW") ?? base.timeline[0]!;
  const scene: FormationScene = {
    id: clip.id,
    name: "Proposal scene",
    schemaVersion: 1,
    transform: {
      position: [3, 4, -2],
      rotationDeg: [5, -12, 8],
      scale: 1.1,
    },
    objects: [
      {
        id: `${clip.id}-obj-1`,
        name: "Static object",
        source: { kind: "STATIC", formationId: formation.id },
        transform: {
          position: [-4, 2, 6],
          rotationDeg: [7, 18, -9],
          scale: 0.85,
          mirrorX: true,
        },
      },
    ],
  };
  return { project: { ...base, scenes: [scene] }, scene };
}

function expectPointClose(actual: Vector3Tuple, expected: Vector3Tuple, digits = 8) {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe("scene geometry proposal materialization", () => {
  it("inverts instance transforms including mirror, scale, rotation and translation", () => {
    const transform: InstanceTransform = {
      position: [4, -3, 8],
      rotationDeg: [13, -21, 31],
      scale: 1.7,
      mirrorX: true,
    };
    const pivot: Vector3Tuple = [2, 5, -1];
    const local: Vector3Tuple = [9, 4, 7];
    const world = applyInstanceTransform(local, transform, pivot);
    expectPointClose(applyInverseInstanceTransform(world, transform, pivot), local, 9);
  });

  it("creates a derived asset and reproduces the proposed world points without mutating the source", () => {
    const { project, scene } = sceneProject();
    const sourceId = scene.objects[0]!.source.kind === "STATIC" ? scene.objects[0]!.source.formationId : "";
    const sourceBefore = JSON.stringify(project.formations.find((formation) => formation.id === sourceId));
    const projectBefore = JSON.stringify(project);
    const before = resolveSceneAt(project, scene).points;
    const proposed = before.map(
      (point, index) => [point[0] + index * 0.01, point[1], point[2] + (index % 2 ? 1.25 : -1.25)] as Vector3Tuple,
    );

    const result = materializeStaticSceneGeometryProposal(project, scene.id, proposed);
    expect(result.ok).toBe(true);
    expect(result.blocker).toBeNull();
    expect(result.derivedFormationId).toBeTruthy();
    expect(JSON.stringify(project)).toBe(projectBefore);
    expect(JSON.stringify(project.formations.find((formation) => formation.id === sourceId))).toBe(sourceBefore);

    const materializedScene = result.project.scenes!.find((candidate) => candidate.id === scene.id)!;
    const resolved = resolveSceneAt(result.project, materializedScene).points;
    expect(resolved).toHaveLength(proposed.length);
    resolved.forEach((point, index) => expectPointClose(point, proposed[index]!, 7));
    expect(result.project.formations).toHaveLength(project.formations.length + 1);
    expect(materializedScene.objects[0]!.source).toEqual({
      kind: "STATIC",
      formationId: result.derivedFormationId,
    });
  });

  it("blocks ambiguous multi-object and sub-sampled scenes instead of guessing", () => {
    const { project, scene } = sceneProject();
    const points = resolveSceneAt(project, scene).points;
    const multi: ShowProject = {
      ...project,
      scenes: [{ ...scene, objects: [...scene.objects, { ...scene.objects[0]!, id: `${scene.id}-obj-2` }] }],
    };
    expect(materializeStaticSceneGeometryProposal(multi, scene.id, points).blocker).toBe("MULTI_OBJECT_SCENE");

    const subsampled: ShowProject = {
      ...project,
      scenes: [
        {
          ...scene,
          objects: [{ ...scene.objects[0]!, requestedDroneCount: Math.max(1, points.length - 1) }],
        },
      ],
    };
    expect(materializeStaticSceneGeometryProposal(subsampled, scene.id, points).blocker).toBe(
      "SUBSAMPLED_OBJECT_UNSUPPORTED",
    );
  });
});
