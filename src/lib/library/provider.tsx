/**
 * FORMATION ASSET LIBRARY — React boundary.
 *
 * All persistence goes through `FormationAssetRepository`, so the UI has no
 * knowledge of the storage backend. Library state is intentionally separate
 * from the studio store: saving or deleting an asset must never invalidate
 * project state or engine memoisation.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { DynamicFormation } from "../show/dynamic/types";
import type { Formation } from "../show/types";
import {
  assetFromDynamicFormation,
  assetFromFormation,
  createBrowserKeyValueStore,
  filterAssets,
  LocalFormationAssetRepository,
  parseAssetFile,
  serializeAssetFile,
  allTags as collectTags,
  DEFAULT_LIBRARY_QUERY,
  LibraryError,
  type AssetSaveInput,
  type FormationAsset,
  type FormationAssetRepository,
  type LibraryQuery,
} from ".";

export interface LibraryApi {
  assets: FormationAsset[];
  /** Assets after the active query — what the panel renders. */
  visible: FormationAsset[];
  tags: string[];
  query: LibraryQuery;
  setQuery: (patch: Partial<LibraryQuery>) => void;
  busy: boolean;
  /** Machine-readable failure of the last operation, if any. */
  error: { code: string; message: string } | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  saveFormation: (formation: Formation, input: AssetSaveInput) => Promise<FormationAsset | null>;
  saveDynamicFormation: (
    formation: DynamicFormation,
    input: AssetSaveInput,
  ) => Promise<FormationAsset | null>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  setFavorite: (id: string, favorite: boolean) => Promise<void>;
  setTags: (id: string, tags: readonly string[]) => Promise<void>;
  /** Imports a `.droneformation.json` file as a new asset. */
  importAssetFile: (file: File) => Promise<FormationAsset | null>;
  /** Serialises an asset for download (caller triggers the file save). */
  exportAssetFile: (asset: FormationAsset) => string;
}

const GLOBAL_KEY = "__dssLibraryContext";
const globalStore = globalThis as unknown as Record<string, React.Context<LibraryApi | null>>;
const LibraryContext: React.Context<LibraryApi | null> =
  globalStore[GLOBAL_KEY] ?? createContext<LibraryApi | null>(null);
globalStore[GLOBAL_KEY] = LibraryContext;

export function LibraryProvider({
  children,
  repository,
}: {
  children: ReactNode;
  /** Injectable for tests; defaults to the browser-backed repository. */
  repository?: FormationAssetRepository;
}) {
  const repo = useMemo(
    () => repository ?? new LocalFormationAssetRepository(createBrowserKeyValueStore()),
    [repository],
  );
  const [assets, setAssets] = useState<FormationAsset[]>([]);
  const [query, setQueryState] = useState<LibraryQuery>(DEFAULT_LIBRARY_QUERY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        const result = await fn();
        setAssets(await repo.list());
        return result;
      } catch (e) {
        const code = e instanceof LibraryError ? e.code : "STORAGE_UNAVAILABLE";
        setError({ code, message: e instanceof Error ? e.message : String(e) });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [repo],
  );

  const refresh = useCallback(async () => {
    await run(async () => undefined);
  }, [run]);

  // Assets load after mount only: SSR must not touch browser storage.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<LibraryApi>(() => {
    return {
      assets,
      visible: filterAssets(assets, query),
      tags: collectTags(assets),
      query,
      setQuery: (patch) => setQueryState((q) => ({ ...q, ...patch })),
      busy,
      error,
      clearError: () => setError(null),
      refresh,
      saveFormation: (formation, input) => run(() => repo.save(assetFromFormation(formation, input))),
      saveDynamicFormation: (formation, input) =>
        run(() => repo.save(assetFromDynamicFormation(formation, input))),
      remove: async (id) => void (await run(() => repo.remove(id))),
      rename: async (id, name) => void (await run(() => repo.rename(id, name))),
      duplicate: async (id) => void (await run(() => repo.duplicate(id))),
      setFavorite: async (id, favorite) => void (await run(() => repo.setFavorite(id, favorite))),
      setTags: async (id, tags) => void (await run(() => repo.setTags(id, tags))),
      importAssetFile: async (file) => {
        const text = await file.text();
        return run(() => repo.save(parseAssetFile(text)));
      },
      exportAssetFile: (asset) => serializeAssetFile(asset),
    };
  }, [assets, busy, error, query, refresh, repo, run]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside <LibraryProvider>");
  return ctx;
}
