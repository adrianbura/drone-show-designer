/**
 * Studio-specific versioned asset FILE format (`*.droneformation.json`).
 *
 * This is an application design-asset format. It is NOT ESSP, not a hardware
 * program and not the show export schema. Property names are machine-readable
 * and never localized.
 */
import { migrateAsset, newAssetId } from "./serialize";
import {
  ASSET_FILE_EXTENSION,
  ASSET_FILE_KIND,
  ASSET_SCHEMA_VERSION,
  LibraryError,
  type FormationAsset,
} from "./types";

export interface AssetFileDocument {
  readonly kind: typeof ASSET_FILE_KIND;
  readonly schemaVersion: number;
  readonly asset: FormationAsset;
}

export function assetFileName(asset: FormationAsset): string {
  const slug =
    asset.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "formation";
  return `${slug}${ASSET_FILE_EXTENSION}`;
}

export function serializeAssetFile(asset: FormationAsset): string {
  const doc: AssetFileDocument = {
    kind: ASSET_FILE_KIND,
    schemaVersion: ASSET_SCHEMA_VERSION,
    asset,
  };
  return JSON.stringify(doc, null, 2);
}

/** Parses an asset file, giving the imported asset a fresh id. */
export function parseAssetFile(text: string): FormationAsset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LibraryError("MALFORMED_ASSET", "Asset file is not valid JSON");
  }
  const doc = parsed as Partial<AssetFileDocument>;
  if (!doc || doc.kind !== ASSET_FILE_KIND) {
    throw new LibraryError("MALFORMED_ASSET", "Asset file kind is not recognised");
  }
  if (typeof doc.schemaVersion === "number" && doc.schemaVersion > ASSET_SCHEMA_VERSION) {
    throw new LibraryError("UNSUPPORTED_SCHEMA", "Asset file schema is newer than supported", {
      schemaVersion: doc.schemaVersion,
    });
  }
  const asset = migrateAsset(doc.asset);
  return { ...asset, id: newAssetId(assetIdPrefix(asset)), source: "IMPORTED" };
}
