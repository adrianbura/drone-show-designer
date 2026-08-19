/**
 * FORMATION ASSET LIBRARY — domain model.
 *
 * A FormationAsset is a reusable DESIGN asset, not a hardware program and not an
 * ESSP file. Assets are immutable snapshots: using one in a show always creates a
 * project-owned copy, so deleting a library asset can never alter an existing
 * show. Machine-readable identity (asset type, source, ids, algorithm versions)
 * is language-neutral and is never translated.
 */
import type { DynamicFormation } from "../show/dynamic/types";
import type { FormationScene } from "../show/scene/types";
import type { Formation } from "../show/types";

/** Persisted schema version of the library payload. */
export const ASSET_SCHEMA_VERSION = 1;
/** Versioned file extension of the studio-specific asset file. */
export const ASSET_FILE_EXTENSION = ".droneformation.json";
export const ASSET_FILE_KIND = "DroneShowStudioFormationAsset";

/** Only the first three are implemented; the rest keep the model additive. */
export type FormationAssetType =
  | "STATIC_FORMATION"
  | "DYNAMIC_FORMATION"
  | "FORMATION_SCENE"
  | "SVG_ASSET"
  | "TEXT_ASSET"
  | "AI_GENERATED_ASSET";

export type FormationAssetSource =
  | "BUILT_IN"
  | "USER"
  | "IMPORTED"
  | "ESSP_DERIVED"
  | "AI_GENERATED";

/** Compact 2D preview: normalised [0,1] XY point pairs, top-down (X / Y up). */
export interface AssetThumbnail {
  readonly points: readonly (readonly [number, number])[];
}

/**
 * SELF-CONTAINED SCENE SNAPSHOT.
 *
 * A scene asset travels with EVERY formation / dynamic formation its objects
 * reference, so it never depends on project-owned ids. Reusing the asset copies
 * these dependencies into the project under fresh ids.
 */
export interface SceneAssetDependencies {
  readonly formations: readonly Formation[];
  readonly dynamicFormations: readonly DynamicFormation[];
}

/**
 * Non-pixel provenance record. NEVER stores raw image data, base64 or ImageData —
 * only identity of the origin (filename, deterministic analysis fingerprint and
 * the analysis parameters that produced the geometry).
 */
export interface AssetSourceRef {
  readonly kind: "IMAGE" | "SVG" | "PROMPT" | "FILE";
  readonly name?: string | undefined;
  readonly fingerprint?: string | undefined;
  readonly params?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export interface FormationAssetMetadata {
  /** Point count of the stored geometry — the asset's native fleet size. */
  readonly droneCount: number;
  readonly formationKind?: string | undefined;
  readonly motionGroupCount?: number;
  readonly keyframeCount?: number;
  readonly duration?: number;
  readonly loop?: string;
  readonly algorithmVersion?: string;
  /** SCENE assets only. */
  readonly objectCount?: number;
  readonly staticDependencyCount?: number;
  readonly dynamicDependencyCount?: number;
  /** Sum of the per-object requested drone counts of a SCENE asset. */
  readonly requestedDroneCount?: number;
  readonly sceneSchemaVersion?: number;
}

export interface FormationAsset {
  readonly id: string;
  /** Monotonic asset revision, incremented on every replace-in-place save. */
  readonly version: number;
  readonly schemaVersion: number;
  readonly name: string;
  readonly description?: string | undefined;
  readonly assetType: FormationAssetType;
  readonly tags: readonly string[];
  readonly favorite: boolean;
  /** ISO timestamps. */
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: FormationAssetSource;
  readonly sourceRef?: AssetSourceRef | undefined;
  readonly droneCount: number;
  readonly thumbnail?: AssetThumbnail | undefined;
  /** Exact engine payload. Dynamic assets keep the FULL animation model. */
  readonly formationData:
    | { readonly kind: "STATIC"; readonly formation: Formation }
    | { readonly kind: "DYNAMIC"; readonly formation: DynamicFormation }
    | {
        readonly kind: "SCENE";
        readonly scene: FormationScene;
        readonly dependencies: SceneAssetDependencies;
      };
  readonly metadata: FormationAssetMetadata;
}

export type LibraryView =
  | "ALL"
  | "STATIC"
  | "DYNAMIC"
  | "SCENE"
  | "FAVORITES"
  | "RECENT"
  | "BUILT_IN";

export interface LibraryQuery {
  readonly view: LibraryView;
  /** Free text matched against name and tags (case-insensitive). */
  readonly search: string;
  readonly tags: readonly string[];
}

export const DEFAULT_LIBRARY_QUERY: LibraryQuery = { view: "ALL", search: "", tags: [] };

/** Persisted library document. */
export interface LibraryDocument {
  readonly schemaVersion: number;
  readonly assets: readonly FormationAsset[];
}

export type LibraryErrorCode =
  | "MALFORMED_ASSET"
  | "UNSUPPORTED_SCHEMA"
  | "ASSET_NOT_FOUND"
  | "STORAGE_UNAVAILABLE"
  | "FLEET_MISMATCH";

export class LibraryError extends Error {
  readonly code: LibraryErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: LibraryErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "LibraryError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Fleet compatibility of an asset with the current project.
 *
 * PARTIAL FLEET PARTICIPATION (Sprint 7.3): an asset with FEWER points than the
 * fleet is fully usable — its points define the PARTICIPATING drone count, and
 * the fleet participation planner gives every remaining drone a role. Only an
 * asset that needs MORE drones than the fleet has is blocked, and it is blocked
 * loudly: no silent point deletion and no silent resampling.
 */
export type FleetCompatibility = "EXACT" | "PARTIAL" | "TOO_LARGE";

export interface AssetSaveInput {
  readonly name: string;
  readonly description?: string | undefined;
  readonly tags?: readonly string[];
  readonly favorite?: boolean;
  readonly source?: FormationAssetSource;
  readonly sourceRef?: AssetSourceRef | undefined;
}

/**
 * Persistence boundary. The UI only ever talks to this interface, so a future
 * cloud/account repository can replace the local one without UI changes.
 */
export interface FormationAssetRepository {
  list(): Promise<FormationAsset[]>;
  get(id: string): Promise<FormationAsset | null>;
  /** Inserts or replaces by id, bumping `version` and `updatedAt`. */
  save(asset: FormationAsset): Promise<FormationAsset>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): Promise<FormationAsset>;
  duplicate(id: string, name?: string): Promise<FormationAsset>;
  setFavorite(id: string, favorite: boolean): Promise<FormationAsset>;
  setTags(id: string, tags: readonly string[]): Promise<FormationAsset>;
  clear(): Promise<void>;
}
