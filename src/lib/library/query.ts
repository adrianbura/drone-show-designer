/** Pure library filtering and sorting. Fast enough for hundreds of assets. */
import type { FormationAsset, LibraryQuery } from "./types";

function matchesView(asset: FormationAsset, view: LibraryQuery["view"]): boolean {
  switch (view) {
    case "STATIC":
      return asset.assetType === "STATIC_FORMATION";
    case "DYNAMIC":
      return asset.assetType === "DYNAMIC_FORMATION";
    case "FAVORITES":
      return asset.favorite;
    case "BUILT_IN":
      return asset.source === "BUILT_IN";
    case "RECENT":
    case "ALL":
    default:
      return true;
  }
}

export function filterAssets(
  assets: readonly FormationAsset[],
  query: LibraryQuery,
): FormationAsset[] {
  const needle = query.search.trim().toLowerCase();
  const tags = query.tags.map((t) => t.toLowerCase());
  const filtered = assets.filter((asset) => {
    if (!matchesView(asset, query.view)) return false;
    if (tags.length > 0) {
      const assetTags = asset.tags.map((t) => t.toLowerCase());
      if (!tags.every((t) => assetTags.includes(t))) return false;
    }
    if (needle.length === 0) return true;
    return (
      asset.name.toLowerCase().includes(needle) ||
      asset.tags.some((t) => t.toLowerCase().includes(needle))
    );
  });
  const byRecent = (a: FormationAsset, b: FormationAsset) =>
    b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name);
  if (query.view === "RECENT") return filtered.sort(byRecent).slice(0, 20);
  return filtered.sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name),
  );
}

export function allTags(assets: readonly FormationAsset[]): string[] {
  const set = new Set<string>();
  for (const a of assets) for (const t of a.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function normalizeTagInput(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 24),
    ),
  ];
}
