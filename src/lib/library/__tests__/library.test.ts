import { beforeEach, describe, expect, it } from "vitest";

import { createDefaultProject } from "@/lib/show/defaultProject";
import { applyPreset, dynamicFromFormation } from "@/lib/show/dynamic";
import { sampleDynamicFormation } from "@/lib/show/dynamic/sampler";
import {
  assetFleetCompatibility,
  assetFromDynamicFormation,
  assetFromFormation,
  dynamicFormationFromAsset,
  filterAssets,
  formationFromAsset,
  LibraryError,
  LocalFormationAssetRepository,
  MemoryKeyValueStore,
  migrateAsset,
  normalizeTagInput,
  parseAssetFile,
  serializeAssetFile,
  allTags,
  ASSET_SCHEMA_VERSION,
  DEFAULT_LIBRARY_QUERY,
  LIBRARY_STORAGE_KEY,
} from "..";

const project = createDefaultProject(48);
const staticFormation = project.formations[1]!;

function dynamic() {
  const base = dynamicFromFormation(staticFormation, { id: "dyn-1", seed: 7 });
  return applyPreset(base, "WAVE");
}

describe("formation asset library — serialization", () => {
  it("saves a static formation with geometry and a thumbnail", () => {
    const asset = assetFromFormation(staticFormation, { name: "Orb", tags: ["abstract"] });
    expect(asset.assetType).toBe("STATIC_FORMATION");
    expect(asset.schemaVersion).toBe(ASSET_SCHEMA_VERSION);
    expect(asset.droneCount).toBe(staticFormation.points.length);
    expect(asset.thumbnail?.points.length).toBeGreaterThan(0);
    const copy = formationFromAsset(asset, "f-new");
    expect(copy.id).toBe("f-new");
    // JSON persistence normalises -0 to 0; geometry is otherwise bit-identical.
    const flat = (pts: readonly (readonly number[])[]) => pts.flat().map((v) => v + 0);
    expect(flat(copy.points)).toEqual(flat(staticFormation.points));
  });

  it("preserves the FULL dynamic animation model", () => {
    const source = dynamic();
    const asset = assetFromDynamicFormation(source, { name: "Wave" });
    const restored = dynamicFormationFromAsset(asset, "dyn-copy");
    expect(restored.points.map((p: { id: string }) => p.id)).toEqual(source.points.map((p: { id: string }) => p.id));
    expect(restored.groups).toEqual(source.groups);
    expect(restored.transform).toEqual(source.transform);
    expect(restored.pivot).toEqual(source.pivot);
    expect(restored.loop).toBe(source.loop);
    expect(restored.algorithmVersion).toBe(source.algorithmVersion);
    // Mathematical output is unchanged by a library round-trip.
    expect(sampleDynamicFormation(restored, 0.37)).toEqual(
      sampleDynamicFormation(source, 0.37),
    );
    expect(asset.metadata.motionGroupCount).toBe(source.groups.length);
    expect(asset.metadata.keyframeCount).toBeGreaterThan(0);
  });

  it("rejects malformed and future-schema assets gracefully", () => {
    expect(() => migrateAsset({ id: "x" })).toThrow(LibraryError);
    const asset = assetFromFormation(staticFormation, { name: "X" });
    expect(() => migrateAsset({ ...asset, schemaVersion: 99 })).toThrow(/newer than supported/);
  });

  it("round-trips the versioned asset file format with a fresh id", () => {
    const asset = assetFromFormation(staticFormation, { name: "File" });
    const parsed = parseAssetFile(serializeAssetFile(asset));
    expect(parsed.id).not.toBe(asset.id);
    expect(parsed.source).toBe("IMPORTED");
    expect(parsed.formationData).toEqual(asset.formationData);
    expect(() => parseAssetFile("{}")).toThrow(LibraryError);
  });

  it("reports fleet compatibility without adapting geometry", () => {
    const asset = assetFromFormation(staticFormation, { name: "Fleet" });
    expect(assetFleetCompatibility(asset, staticFormation.points.length)).toBe("EXACT");
    // A smaller asset is usable: its points are the PARTICIPATING drone count.
    expect(assetFleetCompatibility(asset, 300)).toBe("PARTIAL");
    expect(assetFleetCompatibility(asset, 1)).toBe("TOO_LARGE");
  });
});

describe("formation asset library — repository", () => {
  let store: MemoryKeyValueStore;
  let repo: LocalFormationAssetRepository;

  beforeEach(() => {
    store = new MemoryKeyValueStore();
    repo = new LocalFormationAssetRepository(store, LIBRARY_STORAGE_KEY);
  });

  it("persists assets across repository instances (new session)", async () => {
    await repo.save(assetFromFormation(staticFormation, { name: "Persisted" }));
    const reopened = new LocalFormationAssetRepository(store, LIBRARY_STORAGE_KEY);
    const assets = await reopened.list();
    expect(assets).toHaveLength(1);
    expect(assets[0]!.name).toBe("Persisted");
  });

  it("persists a dynamic asset with keyframes across sessions", async () => {
    const source = dynamic();
    await repo.save(assetFromDynamicFormation(source, { name: "Dyn" }));
    const reopened = new LocalFormationAssetRepository(store, LIBRARY_STORAGE_KEY);
    const loaded = (await reopened.list())[0]!;
    const restored = dynamicFormationFromAsset(loaded, "dyn-2");
    expect(restored.groups.length).toBe(source.groups.length);
    expect(restored.groups[0]?.keyframes.length).toBe(source.groups[0]?.keyframes.length);
  });

  it("renames, duplicates, favourites, tags and deletes", async () => {
    const saved = await repo.save(assetFromFormation(staticFormation, { name: "A" }));
    const renamed = await repo.rename(saved.id, "B");
    expect(renamed.name).toBe("B");
    const copy = await repo.duplicate(saved.id);
    expect(copy.id).not.toBe(saved.id);
    expect(copy.name).toBe("B copy");
    const fav = await repo.setFavorite(saved.id, true);
    expect(fav.favorite).toBe(true);
    const tagged = await repo.setTags(saved.id, ["finale", "logo"]);
    expect(tagged.tags).toEqual(["finale", "logo"]);
    await repo.remove(saved.id);
    expect(await repo.get(saved.id)).toBeNull();
    expect(await repo.list()).toHaveLength(1);
  });

  it("bumps the version when replacing an asset in place", async () => {
    const saved = await repo.save(assetFromFormation(staticFormation, { name: "V" }));
    const again = await repo.save(saved);
    expect(again.version).toBe(saved.version + 1);
  });

  it("skips malformed stored assets instead of failing the library", async () => {
    const good = assetFromFormation(staticFormation, { name: "Good" });
    await store.write(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({ schemaVersion: ASSET_SCHEMA_VERSION, assets: [good, { id: "broken" }] }),
    );
    expect(await repo.list()).toHaveLength(1);
  });
});

describe("formation asset library — search and views", () => {
  const a = { ...assetFromFormation(staticFormation, { name: "Eagle", tags: ["animal"] }) };
  const b = {
    ...assetFromDynamicFormation(dynamic(), { name: "Finale wave", tags: ["finale"] }),
    favorite: true,
  };

  it("filters by view, search text and tags", () => {
    const assets = [a, b];
    expect(filterAssets(assets, { ...DEFAULT_LIBRARY_QUERY, view: "DYNAMIC" })).toEqual([b]);
    expect(filterAssets(assets, { ...DEFAULT_LIBRARY_QUERY, view: "FAVORITES" })).toEqual([b]);
    expect(filterAssets(assets, { ...DEFAULT_LIBRARY_QUERY, search: "eag" })).toEqual([a]);
    expect(filterAssets(assets, { ...DEFAULT_LIBRARY_QUERY, search: "animal" })).toEqual([a]);
    expect(filterAssets(assets, { ...DEFAULT_LIBRARY_QUERY, tags: ["finale"] })).toEqual([b]);
    expect(allTags(assets)).toEqual(["animal", "finale"]);
  });

  it("normalises tag input", () => {
    expect(normalizeTagInput(" Animal, logo ,animal,")).toEqual(["animal", "logo"]);
  });
});
