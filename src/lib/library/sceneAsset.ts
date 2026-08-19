/**
 * FORMATION SCENE ASSETS — a whole composition as one reusable library asset.
 *
 * A scene asset is a SELF-CONTAINED immutable snapshot: the `FormationScene`
 * plus every `Formation` / `DynamicFormation` its objects reference. Nothing in
 * the payload may point at a project-owned id, so deleting the asset can never
 * change a show and editing a show can never change the asset.
 *
 * Reuse is always a COPY: `instantiateSceneAsset` mints project-owned ids for
 * the scene, its objects and every dependency, and rewrites the object sources
 * to those new ids. No alternative scene shape exists anywhere: the stored model
 * is the canonical `FormationScene`.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { DynamicFormation } from "../show/dynamic/types";
import { resolveSceneAt } from "../show/scene/resolve";
import { SCENE_SCHEMA_VERSION, type FormationScene, type SceneFormationInstance } from "../show/scene/types";
import type { Formation, ShowProject, Vec3 } from "../show/types";
import { newAssetId, structuredClonePlain, thumbnailFromPoints } from "./snapshot";
import {
  ASSET_SCHEMA_VERSION,
  LibraryError,
  type AssetSaveInput,
  type FormationAsset,
  type SceneAssetDependencies,
} from "./types";

/** Minimal source of formation geometry — a project or a dependency bundle. */
export interface SceneSourceProject {
  readonly formations: readonly Formation[];
  readonly dynamicFormations?: readonly DynamicFormation[];
}

/** Dependency bundle as a project-shaped read model for the scene resolver. */
export function sceneDependencyProject(dependencies: SceneAssetDependencies): ShowProject {
  return {
    formations: dependencies.formations,
    dynamicFormations: dependencies.dynamicFormations,
  } as unknown as ShowProject;
}

/**
 * Collects exactly the dependencies the scene references — nothing more. Any
 * missing source is a hard error: a half-resolved snapshot must never be saved.
 */
export function collectSceneDependencies(
  scene: FormationScene,
  project: SceneSourceProject,
): SceneAssetDependencies {
  const formations = new Map<string, Formation>();
  const dynamics = new Map<string, DynamicFormation>();
  for (const object of scene.objects) {
    const src = object.source;
    if (src.kind === "STATIC") {
      const formation = project.formations.find((f) => f.id === src.formationId);
      if (!formation) {
        throw new LibraryError("MALFORMED_ASSET", "Scene object has no static source formation", {
          sceneId: scene.id,
          objectId: object.id,
          formationId: src.formationId,
        });
      }
      formations.set(formation.id, structuredClonePlain(formation));
      continue;
    }
    const dynamicId = src.dynamicFormationId;
    const dynamic = (project.dynamicFormations ?? []).find((d) => d.id === dynamicId);
    if (!dynamic) {
      throw new LibraryError("MALFORMED_ASSET", "Scene object has no dynamic source formation", {
        sceneId: scene.id,
        objectId: object.id,
        dynamicFormationId: dynamicId,
      });
    }
    const copy = structuredClonePlain(dynamic);
    // `sourceFormationId` is provenance only. Keep it when the formation travels
    // with the asset, drop it otherwise so no project-owned id can dangle.
    const source = copy.sourceFormationId
      ? project.formations.find((f) => f.id === copy.sourceFormationId)
      : undefined;
    if (source) formations.set(source.id, structuredClonePlain(source));
    dynamics.set(copy.id, source ? copy : withoutSourceFormation(copy));
  }
  return { formations: [...formations.values()], dynamicFormations: [...dynamics.values()] };
}

/** Drops the provenance link instead of leaving a dangling project id. */
function withoutSourceFormation(dynamic: DynamicFormation): DynamicFormation {
  const { sourceFormationId: _dropped, ...rest } = dynamic;
  return rest as DynamicFormation;
}

/** Point count of an object after its requested drone budget is applied. */
function objectPointCount(
  object: SceneFormationInstance,
  dependencies: SceneAssetDependencies,
): number {
  const src = object.source;
  const available =
    src.kind === "STATIC"
      ? (dependencies.formations.find((f) => f.id === src.formationId)?.points.length ?? 0)
      : (dependencies.dynamicFormations.find((d) => d.id === src.dynamicFormationId)?.points
          .length ?? 0);
  const requested = object.requestedDroneCount ?? null;
  return requested && requested > 0 ? Math.min(requested, available) : available;
}

export interface SceneAssetSummary {
  readonly objectCount: number;
  readonly droneCount: number;
  readonly staticDependencyCount: number;
  readonly dynamicDependencyCount: number;
}

export function sceneAssetSummary(asset: FormationAsset): SceneAssetSummary | null {
  if (asset.formationData.kind !== "SCENE") return null;
  const { scene, dependencies } = asset.formationData;
  return {
    objectCount: scene.objects.length,
    droneCount: scene.objects.reduce((sum, o) => sum + objectPointCount(o, dependencies), 0),
    staticDependencyCount: dependencies.formations.length,
    dynamicDependencyCount: dependencies.dynamicFormations.length,
  };
}

/**
 * Composite thumbnail: the WHOLE scene resolved at neutral time (t = 0) with
 * every object transform applied. A scene is never previewed as one of its
 * dependencies.
 */
export function sceneThumbnailPoints(
  scene: FormationScene,
  dependencies: SceneAssetDependencies,
): Vec3[] {
  try {
    return resolveSceneAt(sceneDependencyProject(dependencies), scene, 0).points.map(
      (p) => [p[0], p[1], p[2]] as Vec3,
    );
  } catch {
    return [];
  }
}

export function assetFromScene(
  scene: FormationScene,
  dependencies: SceneAssetDependencies,
  input: AssetSaveInput,
): FormationAsset {
  const ts = new Date().toISOString();
  const snapshotScene = structuredClonePlain(scene);
  const snapshotDeps: SceneAssetDependencies = {
    formations: structuredClonePlain(dependencies.formations) as Formation[],
    dynamicFormations: structuredClonePlain(dependencies.dynamicFormations) as DynamicFormation[],
  };
  const droneCount = snapshotScene.objects.reduce(
    (sum, o) => sum + objectPointCount(o, snapshotDeps),
    0,
  );
  const asset: FormationAsset = {
    id: newAssetId("fsa"),
    version: 1,
    schemaVersion: ASSET_SCHEMA_VERSION,
    name: input.name.trim() || snapshotScene.name,
    description: input.description,
    assetType: "FORMATION_SCENE",
    tags: [...(input.tags ?? [])],
    favorite: input.favorite ?? false,
    createdAt: ts,
    updatedAt: ts,
    // Provenance is NEVER downgraded to USER just because the user pressed save.
    source: input.source ?? "USER",
    sourceRef: input.sourceRef,
    droneCount,
    thumbnail: thumbnailFromPoints(sceneThumbnailPoints(snapshotScene, snapshotDeps)),
    formationData: { kind: "SCENE", scene: snapshotScene, dependencies: snapshotDeps },
    metadata: {
      droneCount,
      objectCount: snapshotScene.objects.length,
      staticDependencyCount: snapshotDeps.formations.length,
      dynamicDependencyCount: snapshotDeps.dynamicFormations.length,
      requestedDroneCount: droneCount,
      sceneSchemaVersion: snapshotScene.schemaVersion,
    },
  };
  validateSceneAssetPayload(asset);
  return asset;
}

/**
 * Structural + referential validation of a scene asset. Every failure is loud:
 * a malformed scene asset is rejected, never silently repaired.
 */
export function validateSceneAssetPayload(asset: FormationAsset): void {
  const data = asset.formationData;
  const fail = (message: string, details: Record<string, unknown> = {}): never => {
    throw new LibraryError("MALFORMED_ASSET", message, { id: asset.id, ...details });
  };
  if (data.kind !== "SCENE") return void fail("Asset does not contain a formation scene");
  const { scene, dependencies } = data;
  if (!scene || typeof scene.id !== "string" || !Array.isArray(scene.objects)) {
    fail("Scene asset has no scene payload");
  }
  if (scene.objects.length === 0) fail("Scene asset has no objects");
  if (typeof scene.schemaVersion === "number" && scene.schemaVersion > SCENE_SCHEMA_VERSION) {
    throw new LibraryError("UNSUPPORTED_SCHEMA", "Scene schema is newer than supported", {
      id: asset.id,
      sceneSchemaVersion: scene.schemaVersion,
    });
  }
  if (!dependencies || !Array.isArray(dependencies.formations) || !Array.isArray(dependencies.dynamicFormations)) {
    fail("Scene asset has no dependency bundle");
  }
  const seen = new Set<string>();
  for (const object of scene.objects) {
    if (!object || typeof object.id !== "string" || object.id.length === 0) {
      fail("Scene object has no id");
    }
    if (seen.has(object.id)) fail("Scene object ids are not unique", { objectId: object.id });
    seen.add(object.id);
    const src = object.source;
    if (src.kind === "STATIC") {
      const formation = dependencies.formations.find((f) => f.id === src.formationId);
      if (!formation) {
        fail("Scene asset references a formation that is not bundled", {
          objectId: object.id,
          formationId: src.formationId,
        });
      }
      if (!Array.isArray(formation!.points) || formation!.points.length === 0) {
        fail("Bundled formation has no points", { formationId: formation!.id });
      }
      const requested = object.requestedDroneCount ?? null;
      if (requested !== null && (!Number.isFinite(requested) || requested < 1)) {
        fail("Scene object has an invalid drone budget", { objectId: object.id, requested });
      }
      continue;
    }
    if (src.kind !== "DYNAMIC") {
      fail("Scene object has an unknown source kind", { objectId: object.id });
    }
    const dynamic = dependencies.dynamicFormations.find(
      (d) => d.id === src.dynamicFormationId,
    );
    if (!dynamic) {
      fail("Scene asset references a dynamic formation that is not bundled", {
        objectId: object.id,
        dynamicFormationId: src.dynamicFormationId,
      });
    }
    if (!Array.isArray(dynamic!.points) || dynamic!.points.length === 0) {
      fail("Bundled dynamic formation has no points", { dynamicFormationId: dynamic!.id });
    }
    if (dynamic!.sourceFormationId && !dependencies.formations.some((f) => f.id === dynamic!.sourceFormationId)) {
      fail("Bundled dynamic formation points at a formation that is not bundled", {
        dynamicFormationId: dynamic!.id,
      });
    }
    const requested = object.requestedDroneCount ?? null;
    if (requested !== null && (!Number.isFinite(requested) || requested < 1)) {
      fail("Scene object has an invalid drone budget", { objectId: object.id, requested });
    }
  }
}

export interface SceneInstantiationIds {
  /** Timeline clip id the scene will be bound to (`scene.id === clip.id`). */
  readonly sceneId: string;
  readonly formationId: (index: number) => string;
  readonly dynamicFormationId: (index: number) => string;
}

export interface SceneInstantiation {
  readonly scene: FormationScene;
  readonly formations: Formation[];
  readonly dynamicFormations: DynamicFormation[];
}

/**
 * PROJECT-OWNED COPY of a scene asset: fresh ids for the scene, its objects and
 * every dependency. The library asset is never referenced again afterwards
 * except as provenance (`object.assetId`).
 */
export function instantiateSceneAsset(
  asset: FormationAsset,
  ids: SceneInstantiationIds,
): SceneInstantiation {
  validateSceneAssetPayload(asset);
  const data = asset.formationData as Extract<
    FormationAsset["formationData"],
    { kind: "SCENE" }
  >;
  const formationIdMap = new Map<string, string>();
  const dynamicIdMap = new Map<string, string>();
  const formations = data.dependencies.formations.map((formation, index) => {
    const id = ids.formationId(index);
    formationIdMap.set(formation.id, id);
    return { ...structuredClonePlain(formation), id };
  });
  const dynamicFormations = data.dependencies.dynamicFormations.map((dynamic, index) => {
    const id = ids.dynamicFormationId(index);
    dynamicIdMap.set(dynamic.id, id);
    const copy = structuredClonePlain(dynamic);
    const sourceFormationId = copy.sourceFormationId
      ? formationIdMap.get(copy.sourceFormationId)
      : undefined;
    return sourceFormationId
      ? { ...copy, id, sourceFormationId }
      : withoutSourceFormation({ ...copy, id });
  });

  const objects: SceneFormationInstance[] = data.scene.objects.map((object, index) => {
    const clone = structuredClonePlain(object);
    const objectId = `${ids.sceneId}-obj-${index + 1}`;
    if (clone.source.kind === "STATIC") {
      const formationId = formationIdMap.get(clone.source.formationId);
      if (!formationId) {
        throw new LibraryError("MALFORMED_ASSET", "Scene dependency could not be remapped", {
          id: asset.id,
          objectId: object.id,
        });
      }
      return { ...clone, id: objectId, assetId: asset.id, source: { kind: "STATIC", formationId } };
    }
    const dynamicFormationId = dynamicIdMap.get(clone.source.dynamicFormationId);
    if (!dynamicFormationId) {
      throw new LibraryError("MALFORMED_ASSET", "Scene dependency could not be remapped", {
        id: asset.id,
        objectId: object.id,
      });
    }
    return {
      ...clone,
      id: objectId,
      assetId: asset.id,
      source: { kind: "DYNAMIC", dynamicFormationId },
    };
  });

  return {
    scene: {
      ...structuredClonePlain(data.scene),
      id: ids.sceneId,
      name: asset.name,
      schemaVersion: SCENE_SCHEMA_VERSION,
      objects,
    },
    formations,
    dynamicFormations,
  };
}

/** Longest animation cycle of the scene — a sensible default clip hold. */
export function sceneAssetDuration(asset: FormationAsset): number {
  if (asset.formationData.kind !== "SCENE") return 0;
  return asset.formationData.dependencies.dynamicFormations.reduce(
    (max, d) => Math.max(max, d.duration ?? 0),
    0,
  );
}
