/**
 * FORMATION LIBRARY PANEL — browse, save and reuse formation assets.
 *
 * Inserting an asset always creates a project-owned copy with a fresh id. An
 * asset that uses only PART of the fleet is fully supported (the reserve planner
 * keeps every remaining drone planned); an asset that needs MORE drones than the
 * project has is blocked — no silent resampling, no dropped drones.
 */
import { Download, Heart, Search, Star, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { useLibrary } from "@/lib/library/provider";
import {
  assetFleetCompatibility,
  dynamicFormationFromAsset,
  formationFromAsset,
  normalizeTagInput,
  ASSET_FILE_EXTENSION,
  type FormationAsset,
  type LibraryView,
} from "@/lib/library";
import { useStudio } from "@/lib/studio/store";

const VIEWS: LibraryView[] = ["ALL", "STATIC", "DYNAMIC", "SCENE", "FAVORITES", "RECENT"];

function Thumbnail({ asset }: { asset: FormationAsset }) {
  const points = asset.thumbnail?.points ?? [];
  return (
    <svg viewBox="0 0 1 1" className="size-14 shrink-0 rounded border border-border bg-surface-sunken">
      {points.map((p, i) => (
        <circle key={i} cx={p[0]} cy={1 - p[1]} r={0.02} className="fill-accent/80" />
      ))}
    </svg>
  );
}

export default function LibraryPanel() {
  const { t } = useI18n();
  const library = useLibrary();
  const {
    project,
    selectedClipId,
    selectedDynamicFormation,
    addLibraryFormation,
    addLibraryDynamicFormation,
    addSceneObject,
    insertLibraryAssetIntoShow,
    sceneAssetPayloadForClip,
  } = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saveName, setSaveName] = useState("");
  const [saveTags, setSaveTags] = useState("");

  const selectedClip = project.timeline.find((c) => c.id === selectedClipId) ?? null;
  const selectedFormation = project.formations.find((f) => f.id === selectedClip?.formationId);

  const scenePayload = selectedClipId ? sceneAssetPayloadForClip(selectedClipId) : null;

  const use = (asset: FormationAsset) => {
    if (assetFleetCompatibility(asset, project.droneCount) === "TOO_LARGE") return;
    // ONE authoring action for every asset kind: copied dependencies, new scene,
    // new clip and the LANDING shift are a single undo entry.
    insertLibraryAssetIntoShow(asset);
  };

  /**
   * SIMULTANEOUS SCENES: adds the asset as an ADDITIONAL object of the selected
   * clip's scene instead of creating a new clip, so several formations can play
   * together. Physical drone allocation stays with the participation planner.
   */
  const addToScene = (asset: FormationAsset) => {
    if (!selectedClipId || asset.formationData.kind === "SCENE") return;
    if (asset.formationData.kind === "DYNAMIC") {
      const created = addLibraryDynamicFormation(dynamicFormationFromAsset(asset, "pending"));
      addSceneObject(selectedClipId, {
        source: { kind: "DYNAMIC", dynamicFormationId: created.id },
        name: asset.name,
        assetId: asset.id,
      });
    } else {
      const created = addLibraryFormation(formationFromAsset(asset, "pending"));
      addSceneObject(selectedClipId, {
        source: { kind: "STATIC", formationId: created.id },
        name: asset.name,
        assetId: asset.id,
      });
    }
  };

  const download = (asset: FormationAsset) => {
    const blob = new Blob([library.exportAssetFile(asset)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${asset.name.replace(/[^\w-]+/g, "_")}${ASSET_FILE_EXTENSION}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {t("formationLibrary.title")}
        </h2>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5"
            title={t("formationLibrary.importAsset")}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-3" />
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) await library.importAssetFile(file);
            }}
          />
        </div>
      </header>

      {/* Save the current selection as a reusable asset. */}
      <div className="space-y-1.5 rounded-md border border-border p-2">
        <Input
          className="h-7 text-xs"
          placeholder={t("common.name")}
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
        />
        <Input
          className="h-7 text-xs"
          placeholder={t("formationLibrary.tagsPlaceholder")}
          value={saveTags}
          onChange={(e) => setSaveTags(e.target.value)}
        />
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 flex-1 font-mono text-[9px] uppercase tracking-[0.14em]"
            disabled={!selectedFormation}
            title={t("formationLibrary.saveStatic")}
            onClick={async () => {
              if (!selectedFormation) return;
              await library.saveFormation(selectedFormation, {
                name: saveName || selectedFormation.name,
                tags: normalizeTagInput(saveTags),
              });
              setSaveName("");
              setSaveTags("");
            }}
          >
            {t("formationLibrary.static")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 flex-1 font-mono text-[9px] uppercase tracking-[0.14em]"
            disabled={!selectedDynamicFormation}
            title={t("formationLibrary.saveDynamic")}
            onClick={async () => {
              if (!selectedDynamicFormation) return;
              await library.saveDynamicFormation(selectedDynamicFormation, {
                name: saveName || selectedDynamicFormation.name,
                tags: normalizeTagInput(saveTags),
              });
              setSaveName("");
              setSaveTags("");
            }}
          >
            {t("formationLibrary.dynamic")}
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 w-full font-mono text-[9px] uppercase tracking-[0.14em]"
          disabled={!scenePayload}
          title={scenePayload ? t("formationLibrary.saveScene") : t("formationLibrary.sceneNoScene")}
          onClick={async () => {
            if (!scenePayload) return;
            await library.saveScene(scenePayload.scene, scenePayload.dependencies, {
              name: saveName || scenePayload.scene.name,
              tags: normalizeTagInput(saveTags),
              source: scenePayload.source,
              sourceRef: scenePayload.sourceRef,
            });
            setSaveName("");
            setSaveTags("");
          }}
        >
          {t("formationLibrary.scene")}
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-7 pl-7 text-xs"
          placeholder={t("formationLibrary.searchPlaceholder")}
          value={library.query.search}
          onChange={(e) => library.setQuery({ search: e.target.value })}
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => library.setQuery({ view })}
            className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-colors ${
              library.query.view === view
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted-foreground"
            }`}
          >
            {t(`formationLibrary.view.${view}` as "formationLibrary.view.ALL")}
          </button>
        ))}
      </div>

      {library.error ? (
        <p className="font-mono text-[10px] text-destructive">
          {t("formationLibrary.importFailed", { code: library.error.code })}
        </p>
      ) : null}

      {library.visible.length === 0 ? (
        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          {library.assets.length === 0
            ? t("formationLibrary.empty")
            : t("formationLibrary.noResults")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {library.visible.map((asset) => {
            const compatibility = assetFleetCompatibility(asset, project.droneCount);
            const usable = compatibility !== "TOO_LARGE";
            return (
              <li key={asset.id} className="rounded-md border border-border p-2">
                <div className="flex gap-2">
                  <Thumbnail asset={asset} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-foreground">{asset.name}</div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                      {asset.assetType === "FORMATION_SCENE"
                        ? t("formationLibrary.scene")
                        : asset.assetType === "DYNAMIC_FORMATION"
                          ? t("formationLibrary.dynamic")
                          : t("formationLibrary.static")}{" "}
                      · {t("formationLibrary.points", { count: asset.droneCount })}
                    </div>
                    {asset.formationData.kind === "SCENE" ? (
                      <div className="font-mono text-[9px] text-muted-foreground/80">
                        {t("formationLibrary.sceneMeta", {
                          objects: asset.formationData.scene.objects.length,
                          formations: asset.formationData.dependencies.formations.length,
                          dynamics: asset.formationData.dependencies.dynamicFormations.length,
                        })}
                      </div>
                    ) : null}
                    {/* PROVENANCE always visible: an ESSP-derived asset carries
                        different editing expectations from a user-authored one. */}
                    <div
                      className={`font-mono text-[9px] ${asset.source === "ESSP_DERIVED" ? "text-accent/80" : "text-muted-foreground/80"}`}
                      data-testid="asset-provenance"
                    >
                      {asset.source === "ESSP_DERIVED" ? t("formationLibrary.esspDerived") : "USER"}
                    </div>
                    {asset.tags.length > 0 ? (
                      <div className="truncate font-mono text-[9px] text-muted-foreground/80">
                        {asset.tags.join(" · ")}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      title={asset.favorite ? t("formationLibrary.unfavorite") : t("formationLibrary.favorite")}
                      onClick={() => void library.setFavorite(asset.id, !asset.favorite)}
                      className={asset.favorite ? "text-accent" : "text-muted-foreground"}
                    >
                      {asset.favorite ? <Star className="size-3" /> : <Heart className="size-3" />}
                    </button>
                    <button
                      type="button"
                      title={t("formationLibrary.exportAsset")}
                      onClick={() => download(asset)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Download className="size-3" />
                    </button>
                    <button
                      type="button"
                      title={t("common.delete")}
                      onClick={() => {
                        if (window.confirm(t("formationLibrary.deleteConfirm"))) {
                          void library.remove(asset.id);
                        }
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 flex-1 font-mono text-[9px] uppercase tracking-[0.14em]"
                    disabled={!usable}
                    onClick={() => use(asset)}
                  >
                    {t("formationLibrary.useInShow")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 flex-1 font-mono text-[9px] uppercase tracking-[0.14em]"
                    disabled={!usable || !selectedClipId || asset.formationData.kind === "SCENE"}
                    title={
                      asset.formationData.kind === "SCENE"
                        ? t("formationLibrary.sceneAddBlocked")
                        : t("scene.addToScene")
                    }
                    onClick={() => addToScene(asset)}
                  >
                    {t("scene.addToScene")}
                  </Button>
                </div>
                <p
                  className={`mt-1 font-mono text-[9px] leading-relaxed ${
                    compatibility === "EXACT"
                      ? "text-muted-foreground"
                      : compatibility === "PARTIAL"
                        ? "text-accent"
                        : "text-warning"
                  }`}
                >
                  {compatibility === "EXACT"
                    ? t("formationLibrary.exact")
                    : compatibility === "PARTIAL"
                      ? t("formationLibrary.partial", {
                          assetCount: asset.droneCount,
                          projectCount: project.droneCount,
                        })
                      : t("formationLibrary.tooLarge", {
                          assetCount: asset.droneCount,
                          projectCount: project.droneCount,
                        })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
