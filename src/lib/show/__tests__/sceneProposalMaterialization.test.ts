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

function proposal(points: readonly Vector3Tuple[]): Vector3Tuple[] {
  return points.map(
    (point, index) => [point[0] + index * 0.01, point[1] + (index % 3) * 0.02, point[2] + (index % 2 ? 1.25 : -1.25)] as Vector3Tuple,
  );
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

  it("creates a derived asset and reproduces proposed world points without mutating the source", () => {
    const { project, scene } = sceneProject();
    const sourceId = scene.objects[0]!.source.kind === "STATIC" ? scene.objects[0]!.source.formationId : "";
    const sourceBefore = JSON.stringify(project.formations.find((formation) => formation.id === sourceId));
    const projectBefore = JSON.stringify(project);
    const proposed = proposal(resolveSceneAt(project, scene).points);

    const result = materializeStaticSceneGeometryProposal(project, scene.id, proposed);
    expect(result.ok).toBe(true);
    expect(result.blocker).toBeNull();
    expect(result.derivedFormationId).toBeTruthy();
    expect(result.derivedFormationIds).toHaveLength(1);
    expect(JSON.stringify(project)).toBe(projectBefore);
    expect(JSON.stringify(project.formations.find((formation) => formation.id === sourceId))).toBe(sourceBefore);

    const materializedScene = result.project.scenes!.find((candidate) => candidate.id === scene.id)!;
    const resolved = resolveSceneAt(result.project, materializedScene).points;
    expect(resolved).toHaveLength(proposed.length);
    resolved.forEach((point, index) => expectPointClose(point, proposed[index]!, 7));
  });

  it("materializes multiple static objects in stable scene/group order", () => {
    const { project, scene } = sceneProject();
    const second = {
      ...scene.objects[0]!,
      id: `${scene.id}-obj-2`,
      name: "Static object 2",
      transform: {
        position: [12, -3, -5] as Vector3Tuple,
        rotationDeg: [-4, 9, 17] as Vector3Tuple,
        scale: 1.25,
      },
    };
    const multiScene: FormationScene = { ...scene, objects: [...scene.objects, second] };
    const multi: ShowProject = { ...project, scenes: [multiScene] };
    const beforeJson = JSON.stringify(multi);
    const proposed = proposal(resolveSceneAt(multi, multiScene).points);

    const result = materializeStaticSceneGeometryProposal(multi, multiScene.id, proposed);
    expect(result.ok).toBe(true);
    expect(result.derivedFormationId).toBeNull();
    expect(result.derivedFormationIds).toHaveLength(2);
    expect(JSON.stringify(multi)).toBe(beforeJson);

    const materializedScene = result.project.scenes![0]!;
    const resolved = resolveSceneAt(result.project, materializedScene).points;
    resolved.forEach((point, index) => expectPointClose(point, proposed[index]!, 7));
    expect(result.project.formations).toHaveLength(multi.formations.length + 2);
  });

  it("materializes deterministic static sub-samples instead of guessing unused asset points", () => {
    const { project, scene } = sceneProject();
    const source = project.formations.find(
      (formation) => scene.objects[0]!.source.kind === "STATIC" && formation.id === scene.objects[0]!.source.formationId,
    )!;
    const requestedDroneCount = Math.max(1, source.points.length - 2);
    const subsampledScene: FormationScene = {
      ...scene,
      objects: [{ ...scene.objects[0]!, requestedDroneCount }],
    };
    const subsampled: ShowProject = { ...project, scenes: [subsampledScene] };
    const proposed = proposal(resolveSceneAt(subsampled, subsampledScene).points);

    const result = materializeStaticSceneGeometryProposal(subsampled, scene.id, proposed);
    expect(result.ok).toBe(true);
    const rebound = result.project.scenes![0]!.objects[0]!;
    expect(rebound.requestedDroneCount).toBe(requestedDroneCount);
    expect(rebound.source.kind).toBe("STATIC");
    if (rebound.source.kind !== "STATIC") throw new Error("expected static rebound");
    const reboundFormationId = rebound.source.formationId;
    const derived = result.project.formations.find((formation) => formation.id === reboundFormationId)!;

    expect(derived.points).toHaveLength(requestedDroneCount);
    const resolved = resolveSceneAt(result.project, result.project.scenes![0]!).points;
    resolved.forEach((point, index) => expectPointClose(point, proposed[index]!, 7));
  });

  it("reuses an unshared scene-owned derived id on repeated proposals and keeps root provenance", () => {
    const { project, scene } = sceneProject();
    const originalSourceId =
      scene.objects[0]!.source.kind === "STATIC" ? scene.objects[0]!.source.formationId : "";
    const firstProposal = proposal(resolveSceneAt(project, scene).points);
    const first = materializeStaticSceneGeometryProposal(project, scene.id, firstProposal);
    expect(first.ok).toBe(true);
    const firstId = first.derivedFormationId!;
    const firstCount = first.project.formations.length;
    const firstScene = first.project.scenes!.find((candidate) => candidate.id === scene.id)!;

    const secondProposal = proposal(resolveSceneAt(first.project, firstScene).points);
    const second = materializeStaticSceneGeometryProposal(first.project, scene.id, secondProposal);
    expect(second.ok).toBe(true);
    expect(second.derivedFormationId).toBe(firstId);
    expect(second.project.formations).toHaveLength(firstCount);

    const derived = second.project.formations.find((formation) => formation.id === firstId)!;
    expect(derived.params?['derivedFromFormationId']).toBe(originalSourceId);
    expect(derived.params?['rootFormationId']).toBe(originalSourceId);
    expect(derived.params?['derivedForSceneId']).toBe(scene.id);
    expect(derived.params?['derivedForObjectId']).toBe(scene.objects[0]!.id);
    expect(derived.name.match(/geometry proposal/g)).toHaveLength(1);

    const secondScene = second.project.scenes!.find((candidate) => candidate.id === scene.id)!;
    const resolved = resolveSceneAt(second.project, secondScene).points;
    resolved.forEach((point, index) => expectPointClose(point, secondProposal[index]!, 7));
  });

  it("does not reuse a derived id that another scene references", () => {
    const { project, scene } = sceneProject();
    const first = materializeStaticSceneGeometryProposal(
      project,
      scene.id,
      proposal(resolveSceneAt(project, scene).points),
    );
    expect(first.ok).toBe(true);
    const sharedId = first.derivedFormationId!;
    const firstScene = first.project.scenes!.find((candidate) => candidate.id === scene.id)!;
    const shadowScene: FormationScene = {
      ...firstScene,
      id: `${scene.id}-shadow`,
      objects: firstScene.objects.map((object, index) => ({
        ...object,
        id: `${object.id}-shadow-${index}`,
      })),
    };
    const shared: ShowProject = {
      ...first.project,
      scenes: [...(first.project.scenes ?? []), shadowScene],
    };
    const nextProposal = proposal(resolveSceneAt(shared, firstScene).points);
    const second = materializeStaticSceneGeometryProposal(shared, scene.id, nextProposal);
    expect(second.ok).toBe(true);
    expect(second.derivedFormationId).not.toBe(sharedId);
    expect(second.project.formations.some((formation) => formation.id === sharedId)).toBe(true);
    expect(
      second.project.scenes!.find((candidate) => candidate.id === shadowScene.id)!.objects[0]!.source,
    ).toEqual({ kind: "STATIC", formationId: sharedId });
  });

  it("blocks dynamic objects and point-count mismatch", () => {
    const { project, scene } = sceneProject();
    const dynamicScene: FormationScene = {
      ...scene,
      objects: [
        {
          ...scene.objects[0]!,
          source: { kind: "DYNAMIC", dynamicFormationId: "missing-dynamic" },
        },
      ],
    };
    const dynamicProject: ShowProject = { ...project, scenes: [dynamicScene] };
    expect(materializeStaticSceneGeometryProposal(dynamicProject, scene.id, []).blocker).toBe(
      "DYNAMIC_OBJECT_UNSUPPORTED",
    );

    const points = resolveSceneAt(project, scene).points;
    expect(materializeStaticSceneGeometryProposal(project, scene.id, points.slice(1)).blocker).toBe(
      "POINT_COUNT_MISMATCH",
    );
  });
});
