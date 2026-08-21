import { describe, expect, it } from "vitest";

import { createDemoProject } from "../defaultProject";
import { auditGeometryDerivedAssets } from "../diagnostics";
import { materializeStaticSceneGeometryProposal, resolveSceneAt } from "../scene";
import type { FormationScene } from "../scene/types";
import type { ShowProject } from "../types";
import { clipPhase } from "../types";

function sceneProject(): { project: ShowProject; scene: FormationScene } {
  const base = createDemoProject();
  const clip = base.timeline.find((candidate) => clipPhase(candidate) === "SHOW")!;
  const formation = base.formations.find((candidate) => candidate.id === clip.formationId)!;
  const scene: FormationScene = {
    id: clip.id,
    name: "Audit scene",
    schemaVersion: 1,
    transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1 },
    objects: [
      {
        id: `${clip.id}-object`,
        name: "Object",
        source: { kind: "STATIC", formationId: formation.id },
        transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1 },
      },
    ],
  };
  return { project: { ...base, scenes: [scene] }, scene };
}

describe("geometry derived asset audit", () => {
  it("reports a materialized scene asset as singly referenced and owned by its scene object", () => {
    const { project, scene } = sceneProject();
    const points = resolveSceneAt(project, scene).points.map(
      (point) => [point[0], point[1], point[2] + 1] as const,
    );
    const materialized = materializeStaticSceneGeometryProposal(project, scene.id, points);
    expect(materialized.ok).toBe(true);

    const report = auditGeometryDerivedAssets(materialized.project);
    expect(report.derivedAssetCount).toBe(1);
    expect(report.orphanedFormationIds).toEqual([]);
    expect(report.sharedFormationIds).toEqual([]);
    expect(report.ownershipMismatchFormationIds).toEqual([]);
    expect(report.assets[0]!.referenceCount).toBe(1);
    expect(report.assets[0]!.sceneObjectRefs).toEqual([
      { sceneId: scene.id, objectId: scene.objects[0]!.id },
    ]);
  });

  it("detects an orphan without mutating the project", () => {
    const { project, scene } = sceneProject();
    const points = resolveSceneAt(project, scene).points;
    const materialized = materializeStaticSceneGeometryProposal(project, scene.id, points);
    expect(materialized.ok).toBe(true);
    const derivedId = materialized.derivedFormationIds[0]!;
    const orphaned: ShowProject = {
      ...materialized.project,
      scenes: materialized.project.scenes!.map((candidate) =>
        candidate.id === scene.id ? scene : candidate,
      ),
    };
    const before = JSON.stringify(orphaned);

    const report = auditGeometryDerivedAssets(orphaned);
    expect(report.orphanedFormationIds).toEqual([derivedId]);
    expect(JSON.stringify(orphaned)).toBe(before);
  });

  it("flags shared or wrong-owner references instead of treating them as safe to reuse", () => {
    const { project, scene } = sceneProject();
    const points = resolveSceneAt(project, scene).points;
    const materialized = materializeStaticSceneGeometryProposal(project, scene.id, points);
    expect(materialized.ok).toBe(true);
    const derivedId = materialized.derivedFormationIds[0]!;
    const derivedScene = materialized.project.scenes![0]!;
    const second: FormationScene = {
      ...derivedScene,
      id: `${derivedScene.id}-copy`,
      objects: derivedScene.objects.map((object) => ({ ...object, id: `${object.id}-copy` })),
    };
    const shared: ShowProject = {
      ...materialized.project,
      scenes: [...materialized.project.scenes!, second],
    };

    const report = auditGeometryDerivedAssets(shared);
    expect(report.sharedFormationIds).toEqual([derivedId]);
    expect(report.ownershipMismatchFormationIds).toEqual([derivedId]);
    expect(report.assets[0]!.referenceCount).toBe(2);
  });
});
