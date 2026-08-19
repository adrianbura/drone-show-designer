/**
 * Local persistence behind the `FormationAssetRepository` boundary.
 *
 * The repository owns a small key/value document store so the storage backend is
 * swappable: `MemoryKeyValueStore` in tests, IndexedDB in the browser with a
 * localStorage fallback, and a future cloud repository without UI changes.
 */
import { assetIdPrefix } from "./assetFile";
import { migrateAsset, newAssetId, structuredClonePlain } from "./serialize";
import {
  ASSET_SCHEMA_VERSION,
  LibraryError,
  type FormationAsset,
  type FormationAssetRepository,
  type LibraryDocument,
} from "./types";

export const LIBRARY_STORAGE_KEY = "dss.formationLibrary.v1";

export interface KeyValueStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async write(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
}

/** Browser store: IndexedDB when available, otherwise localStorage. */
export function createBrowserKeyValueStore(): KeyValueStore {
  const DB = "drone-show-studio";
  const STORE = "keyval";

  const openDb = (): Promise<IDBDatabase | null> =>
    new Promise((resolve) => {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });

  const localRead = (key: string): string | null => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const localWrite = (key: string, value: string) => {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* storage full / disabled — the in-memory list still works this session */
    }
  };

  return {
    async read(key) {
      const db = await openDb();
      if (!db) return localRead(key);
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as string | undefined) ?? localRead(key));
        req.onerror = () => resolve(localRead(key));
      });
    },
    async write(key, value) {
      const db = await openDb();
      if (!db) return localWrite(key, value);
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          localWrite(key, value);
          resolve();
        };
      });
    },
  };
}

export class LocalFormationAssetRepository implements FormationAssetRepository {
  constructor(
    private readonly store: KeyValueStore = new MemoryKeyValueStore(),
    private readonly key: string = LIBRARY_STORAGE_KEY,
  ) {}

  /** Malformed individual assets are skipped, never fatal for the library. */
  private async readDocument(): Promise<{ assets: FormationAsset[]; skipped: number }> {
    const raw = await this.store.read(this.key);
    if (!raw) return { assets: [], skipped: 0 };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { assets: [], skipped: 0 };
    }
    const doc = parsed as Partial<LibraryDocument>;
    if (!doc || !Array.isArray(doc.assets)) return { assets: [], skipped: 0 };
    const assets: FormationAsset[] = [];
    let skipped = 0;
    for (const candidate of doc.assets) {
      try {
        assets.push(migrateAsset(candidate));
      } catch {
        skipped += 1;
      }
    }
    return { assets, skipped };
  }

  private async writeDocument(assets: readonly FormationAsset[]): Promise<void> {
    const doc: LibraryDocument = { schemaVersion: ASSET_SCHEMA_VERSION, assets };
    await this.store.write(this.key, JSON.stringify(doc));
  }

  async list(): Promise<FormationAsset[]> {
    return (await this.readDocument()).assets;
  }

  async get(id: string): Promise<FormationAsset | null> {
    return (await this.list()).find((a) => a.id === id) ?? null;
  }

  async save(asset: FormationAsset): Promise<FormationAsset> {
    const assets = await this.list();
    const existing = assets.find((a) => a.id === asset.id);
    const next: FormationAsset = {
      ...structuredClonePlain(asset),
      schemaVersion: ASSET_SCHEMA_VERSION,
      version: existing ? existing.version + 1 : asset.version,
      createdAt: existing?.createdAt ?? asset.createdAt,
      updatedAt: new Date().toISOString(),
    };
    migrateAsset(next);
    await this.writeDocument(
      existing ? assets.map((a) => (a.id === next.id ? next : a)) : [...assets, next],
    );
    return next;
  }

  async remove(id: string): Promise<void> {
    const assets = await this.list();
    await this.writeDocument(assets.filter((a) => a.id !== id));
  }

  private async mutate(
    id: string,
    fn: (asset: FormationAsset) => FormationAsset,
  ): Promise<FormationAsset> {
    const assets = await this.list();
    const current = assets.find((a) => a.id === id);
    if (!current) throw new LibraryError("ASSET_NOT_FOUND", `Unknown asset ${id}`, { id });
    const next: FormationAsset = { ...fn(current), updatedAt: new Date().toISOString() };
    await this.writeDocument(assets.map((a) => (a.id === id ? next : a)));
    return next;
  }

  async rename(id: string, name: string): Promise<FormationAsset> {
    return this.mutate(id, (a) => ({ ...a, name: name.trim() || a.name }));
  }

  async duplicate(id: string, name?: string): Promise<FormationAsset> {
    const source = await this.get(id);
    if (!source) throw new LibraryError("ASSET_NOT_FOUND", `Unknown asset ${id}`, { id });
    const ts = new Date().toISOString();
    const copy: FormationAsset = {
      ...structuredClonePlain(source),
      id: newAssetId(assetIdPrefix(source)),
      version: 1,
      name: name?.trim() || `${source.name} copy`,
      favorite: false,
      createdAt: ts,
      updatedAt: ts,
    };
    const assets = await this.list();
    await this.writeDocument([...assets, copy]);
    return copy;
  }

  async setFavorite(id: string, favorite: boolean): Promise<FormationAsset> {
    return this.mutate(id, (a) => ({ ...a, favorite }));
  }

  async setTags(id: string, tags: readonly string[]): Promise<FormationAsset> {
    return this.mutate(id, (a) => ({ ...a, tags: [...tags] }));
  }

  async clear(): Promise<void> {
    await this.writeDocument([]);
  }
}
