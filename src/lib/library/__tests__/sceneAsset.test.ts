/**
 * FORMATION SCENE ASSETS — snapshot, validation, instantiation and file
 * round-trip. A scene asset must be self-contained and reuse must never share
 * ids with the library payload.
 */
import { describe, expect, it } from "vitest";

import {
  assetFromScene,
  collectSceneDependencies,
  filterAssets,
  instantiateSceneAsset,
  LibraryError,
  migrateAsset,
  parseAssetFile,
  sceneAssetSummary,
  serializeAssetFile,
  validateSceneAssetPayload,
  DEFAULT_LIBRARY_QUERY,
  type FormationAsset,
} from "..";
import { applyPreset, dynamicFromFormation } from "@/lib/show/dynamic";
import { IDENTITY_INSTANCE_TRANSFORM, type FormationScene } from "@/lib/show/scene/types";
import { createDefaultProject } from "@/lib/show/defaultProject";

const project = createDefaultProject(48);
const staticFormation = project.formations[1]!;
const dynamicFormation = applyPreset(
  dynamicFromFormation(project.formations[0]!, { id: "dyn-1", seed: 3 }),
  "WAVE",
);

const sourceProject = {
  ...project,
  dynamicFormations: [dynamicFormation],
};

const scene: FormationScene = {
  id: "clip-1",
  name: "Opening composition",
  schemaVersion: 1,
  objects: [
    {
      id: "obj-1",
      name: "Static block",
      source: { kind: "STATIC", formationId: staticFormation.id },
      transform: { ...IDENTITY_INSTANCE_TRANSFORM, position: [10, 0, 0] },
    },
    {
      id: "obj-2",
      name: "Animated block",
      source: { kind: "DYNAMIC", dynamicFormationId: dynamicFormation.id },
      transform: IDENTITY_INSTANCE_TRANSFORM,
    },
  ],
  transform: IDENTITY_INSTANCE_TRANSFORM,
};

function sceneAsset(): FormationAsset {
  const dependencies = collectSceneDependencies(scene, sourceProject);
  return assetFromScene(scene, dependencies, { name: "Opening", tags: ["scene"] });
}

describe("scene assets — snapshot", () => {
  it("bundles exactly the dependencies the scene references", () => {
    const deps = collectSceneDependencies(scene, sourceProject);
    expect(deps.dynamicFormations.map((d) => d.id)).toEqual([dynamicFormation.id]);
    expect(deps.formations.some((f) => f.id === staticFormation.id)).toBe(true);
  });

  it("fails loudly when a source formation is missing", () => {
    expect(() =>
      collectSceneDependencies(scene, { formations: [], dynamicFormations: [] }),
    ).toThrowError(LibraryError);
  });

  it("stores the whole composition with a composite thumbnail", () => {
    const asset = sceneAsset();
    expect(asset.assetType).toBe("FORMATION_SCENE");
    expect(asset.formationData.kind).toBe("SCENE");
    expect(asset.droneCount).toBeGreaterThan(staticFormation.points.length);
    expect(asset.thumbnail?.points.length).toBeGreaterThan(0);
    expect(sceneAssetSummary(asset)?.objectCount).toBe(2);
  });

  it("keeps imported provenance instead of downgrading it to USER", () => {
    const deps = collectSceneDependencies(scene, sourceProject);
    const asset = assetFromScene(scene, deps, { name: "Imported", source: "ESSP_DERIVED" });
    expect(asset.source).toBe("ESSP_DERIVED");
  });
});

describe("scene assets — validation", () => {
  it("rejects a scene asset whose dependency is not bundled", () => {
    const asset = sceneAsset();
    const broken: FormationAsset = {
      ...asset,
      formationData: {
        kind: "SCENE",
        scene,
        dependencies: { formations: [], dynamicFormations: [] },
      },
    };
    expect(() => validateSceneAssetPayload(broken)).toThrowError(LibraryError);
  });

  it("rejects duplicate object ids", () => {
    const asset = sceneAsset();
    const data = asset.formationData;
    if (data.kind !== "SCENE") throw new Error("expected a scene payload");
    const duplicated: FormationAsset = {
      ...asset,
      formationData: {
        ...data,
        scene: { ...data.scene, objects: [data.scene.objects[0]!, data.scene.objects[0]!] },
      },
    };
    expect(() => validateSceneAssetPayload(duplicated)).toThrowError(LibraryError);
  });

  it("validates scene payloads through migrateAsset", () => {
    expect(() => migrateAsset(sceneAsset())).not.toThrow();
  });
});

describe("scene assets — reuse", () => {
  it("instantiates project-owned copies with fresh ids", () => {
    const asset = sceneAsset();
    const created = instantiateSceneAsset(asset, {
      sceneId: "c-9",
      formationId: (i) => `f-new-${i}`,
      dynamicFormationId: (i) => `dyn-new-${i}`,
    });
    expect(created.scene.id).toBe("c-9");
    expect(created.formations.every((f) => f.id.startsWith("f-new-"))).toBe(true);
    expect(created.dynamicFormations.every((d) => d.id.startsWith("dyn-new-"))).toBe(true);
    for (const object of created.scene.objects) {
      const id =
        object.source.kind === "STATIC"
          ? object.source.formationId
          : object.source.dynamicFormationId;
      const known =
        created.formations.some((f) => f.id === id) ||
        created.dynamicFormations.some((d) => d.id === id);
      expect(known).toBe(true);
    }
    // The library asset is untouched by reuse.
    const data = asset.formationData;
    if (data.kind !== "SCENE") throw new Error("expected a scene payload");
    expect(data.scene.id).toBe("clip-1");
  });

  it("survives a file round-trip and appears in the SCENE view", () => {
    const asset = sceneAsset();
    const restored = parseAssetFile(serializeAssetFile(asset));
    expect(restored.assetType).toBe("FORMATION_SCENE");
    expect(restored.id).not.toBe(asset.id);
    expect(restored.source).toBe("IMPORTED");
    const visible = filterAssets([restored], { ...DEFAULT_LIBRARY_QUERY, view: "SCENE" });
    expect(visible.map((a) => a.id)).toEqual([restored.id]);
  });
});
