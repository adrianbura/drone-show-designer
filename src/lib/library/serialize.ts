/**
 * Asset (de)serialisation. Static assets keep the exact `Formation`; dynamic
 * assets keep the FULL `DynamicFormation` — base geometry, stable point ids,
 * motion groups and their membership, keyframes, transform tracks, pivot, loop
 * mode and algorithm version. A dynamic asset is never flattened to a static
 * snapshot.
 */
import type { DynamicFormation } from "../show/dynamic/types";
import type { Formation, Vec3 } from "../show/types";
import { validateSceneAssetPayload } from "./sceneAsset";
import { newAssetId, structuredClonePlain, thumbnailFromPoints } from "./snapshot";
import {
  ASSET_SCHEMA_VERSION,
  LibraryError,
  type AssetSaveInput,
  type FleetCompatibility,
  type FormationAsset,
} from "./types";

export { newAssetId, structuredClonePlain, thumbnailFromPoints };

function nowIso(): string {
  return new Date().toISOString();
}

export function assetFromFormation(formation: Formation, input: AssetSaveInput): FormationAsset {
  const ts = nowIso();
  return {
    id: newAssetId("sfa"),
    version: 1,
    schemaVersion: ASSET_SCHEMA_VERSION,
    name: input.name.trim() || formation.name,
    description: input.description,
    assetType: "STATIC_FORMATION",
    tags: [...(input.tags ?? [])],
    favorite: input.favorite ?? false,
    createdAt: ts,
    updatedAt: ts,
    source: input.source ?? "USER",
    sourceRef: input.sourceRef,
    droneCount: formation.points.length,
    thumbnail: thumbnailFromPoints(formation.points),
    formationData: { kind: "STATIC", formation: structuredClonePlain(formation) },
    metadata: { droneCount: formation.points.length, formationKind: formation.kind },
  };
}

export function assetFromDynamicFormation(
  formation: DynamicFormation,
  input: AssetSaveInput,
): FormationAsset {
  const ts = nowIso();
  const keyframeCount =
    formation.transform.length +
    formation.groups.reduce((sum, g) => sum + g.keyframes.length, 0);
  return {
    id: newAssetId("dfa"),
    version: 1,
    schemaVersion: ASSET_SCHEMA_VERSION,
    name: input.name.trim() || formation.name,
    description: input.description,
    assetType: "DYNAMIC_FORMATION",
    tags: [...(input.tags ?? [])],
    favorite: input.favorite ?? false,
    createdAt: ts,
    updatedAt: ts,
    source: input.source ?? "USER",
    sourceRef: input.sourceRef,
    droneCount: formation.points.length,
    thumbnail: thumbnailFromPoints(formation.points.map((p) => p.base as Vec3)),
    formationData: { kind: "DYNAMIC", formation: structuredClonePlain(formation) },
    metadata: {
      droneCount: formation.points.length,
      motionGroupCount: formation.groups.length,
      keyframeCount,
      duration: formation.duration,
      loop: formation.loop,
      algorithmVersion: formation.algorithmVersion,
    },
  };
}


/** Project-owned copy of a static asset. The library asset stays untouched. */
export function formationFromAsset(asset: FormationAsset, newId: string): Formation {
  if (asset.formationData.kind !== "STATIC") {
    throw new LibraryError("MALFORMED_ASSET", "Asset does not contain a static formation", {
      id: asset.id,
    });
  }
  return { ...structuredClonePlain(asset.formationData.formation), id: newId, name: asset.name };
}

/** Project-owned copy of a dynamic asset, animation model fully preserved. */
export function dynamicFormationFromAsset(
  asset: FormationAsset,
  newId: string,
): DynamicFormation {
  if (asset.formationData.kind !== "DYNAMIC") {
    throw new LibraryError("MALFORMED_ASSET", "Asset does not contain a dynamic formation", {
      id: asset.id,
    });
  }
  return { ...structuredClonePlain(asset.formationData.formation), id: newId, name: asset.name };
}

export function assetFleetCompatibility(
  asset: FormationAsset,
  projectDroneCount: number,
): FleetCompatibility {
  if (asset.droneCount === projectDroneCount) return "EXACT";
  return asset.droneCount < projectDroneCount ? "PARTIAL" : "TOO_LARGE";
}

/** An asset is usable when the fleet has at least as many drones as it needs. */
export function isAssetUsableWithFleet(asset: FormationAsset, projectDroneCount: number): boolean {
  return assetFleetCompatibility(asset, projectDroneCount) !== "TOO_LARGE";
}

/** Drones the fleet participation planner has to give another role to. */
export function assetReserveCount(asset: FormationAsset, projectDroneCount: number): number {
  return Math.max(0, projectDroneCount - asset.droneCount);
}

/** Structural validation of an untrusted asset (storage or imported file). */
export function isValidAsset(value: unknown): value is FormationAsset {
  if (!value || typeof value !== "object") return false;
  const a = value as Partial<FormationAsset>;
  if (typeof a.id !== "string" || a.id.length === 0) return false;
  if (typeof a.name !== "string") return false;
  if (typeof a.version !== "number" || typeof a.schemaVersion !== "number") return false;
  if (
    a.assetType !== "STATIC_FORMATION" &&
    a.assetType !== "DYNAMIC_FORMATION" &&
    a.assetType !== "FORMATION_SCENE"
  ) {
    return false;
  }
  if (!Array.isArray(a.tags)) return false;
  if (typeof a.droneCount !== "number") return false;
  const data = a.formationData;
  if (!data || typeof data !== "object") return false;
  if (data.kind === "STATIC") return Array.isArray(data.formation?.points);
  if (data.kind === "DYNAMIC") {
    return Array.isArray(data.formation?.points) && Array.isArray(data.formation?.groups);
  }
  if (data.kind === "SCENE") {
    return (
      !!data.scene &&
      Array.isArray(data.scene.objects) &&
      !!data.dependencies &&
      Array.isArray(data.dependencies.formations) &&
      Array.isArray(data.dependencies.dynamicFormations)
    );
  }
  return false;
}

/**
 * Migrates an asset to the current schema version. Unknown FUTURE versions are
 * rejected rather than guessed at, so a malformed asset fails gracefully.
 *
 * Legacy STATIC / DYNAMIC assets are returned unchanged; SCENE assets get the
 * full referential integrity check (no dangling formation or dynamic ids).
 */
export function migrateAsset(value: unknown): FormationAsset {
  if (!isValidAsset(value)) {
    throw new LibraryError("MALFORMED_ASSET", "Asset payload is not a valid formation asset");
  }
  if (value.schemaVersion > ASSET_SCHEMA_VERSION) {
    throw new LibraryError(
      "UNSUPPORTED_SCHEMA",
      `Asset schema ${value.schemaVersion} is newer than supported ${ASSET_SCHEMA_VERSION}`,
      { id: value.id, schemaVersion: value.schemaVersion },
    );
  }
  if (value.formationData.kind === "SCENE") validateSceneAssetPayload(value);
  return value;
}
