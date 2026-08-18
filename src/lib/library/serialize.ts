/**
 * Asset (de)serialisation. Static assets keep the exact `Formation`; dynamic
 * assets keep the FULL `DynamicFormation` — base geometry, stable point ids,
 * motion groups and their membership, keyframes, transform tracks, pivot, loop
 * mode and algorithm version. A dynamic asset is never flattened to a static
 * snapshot.
 */
import type { DynamicFormation } from "../show/dynamic/types";
import type { Formation, Vec3 } from "../show/types";
import {
  ASSET_SCHEMA_VERSION,
  LibraryError,
  type AssetSaveInput,
  type AssetThumbnail,
  type FleetCompatibility,
  type FormationAsset,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

export function newAssetId(prefix = "asset"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/** Normalised top-down thumbnail (X right, Z up in screen space). */
export function thumbnailFromPoints(points: readonly Vec3[], maxPoints = 400): AssetThumbnail {
  if (points.length === 0) return { points: [] };
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const picked: Vec3[] = [];
  for (let i = 0; i < points.length; i += step) picked.push(points[i]!);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of picked) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const span = Math.max(spanX, spanY);
  return {
    points: picked.map(
      (p) =>
        [
          Number((((p[0] - minX) / span + (1 - spanX / span) / 2)).toFixed(4)),
          Number((((p[1] - minY) / span + (1 - spanY / span) / 2)).toFixed(4)),
        ] as const,
    ),
  };
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

/** JSON round-trip clone — keeps assets plain, serialisable and detached. */
export function structuredClonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
  if (a.assetType !== "STATIC_FORMATION" && a.assetType !== "DYNAMIC_FORMATION") return false;
  if (!Array.isArray(a.tags)) return false;
  if (typeof a.droneCount !== "number") return false;
  const data = a.formationData;
  if (!data || typeof data !== "object") return false;
  if (data.kind === "STATIC") return Array.isArray(data.formation?.points);
  if (data.kind === "DYNAMIC") {
    return Array.isArray(data.formation?.points) && Array.isArray(data.formation?.groups);
  }
  return false;
}

/**
 * Migrates an asset to the current schema version. Unknown FUTURE versions are
 * rejected rather than guessed at, so a malformed asset fails gracefully.
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
  return value;
}
