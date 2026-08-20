import { Layers, Library, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useLibrary } from "@/lib/library/provider";
import { useStudio } from "@/lib/studio/store";
import type { SpliceVerificationReport } from "@/lib/import/essp/native";

/**
 * IMPORTED SHOW -> NATIVE PROJECT.
 *
 * Extraction writes editable clips, formations and lighting into the project
 * while the imported payload stays the playback authority for every clip that
 * has not been edited yet. Ownership is shown per clip so the operator always
 * knows whether the viewport is showing imported data or planner output.
 */
export default function NativeConversionPanel() {
  const {
    referenceShow,
    forensicsReport,
    forensicsBusy,
    referenceLayer,
    referenceOwnership,
    referenceOwnedNow,
    referenceExtraction,
    referenceAssetDrafts,
    referenceExtractionWarnings,
    referenceExtractionError,
    extractReferenceShowToProject,
    promoteReferenceClip,
    clearReferenceLayer,
    verifyReferenceSplices,
    referenceLayerLimitations,
    selectedClipId,
    selectClip,
  } = useStudio();
  const library = useLibrary();
  const [splices, setSplices] = useState<SpliceVerificationReport | null>(null);
  const [saved, setSaved] = useState<{ total: number; static: number; dynamic: number; scene: number } | null>(null);

  const assetCounts = useMemo(
    () =>
      referenceAssetDrafts.reduce(
        (counts, draft) => {
          counts.total += 1;
          if (draft.kind === "STATIC") counts.static += 1;
          else if (draft.kind === "DYNAMIC") counts.dynamic += 1;
          else counts.scene += 1;
          return counts;
        },
        { total: 0, static: 0, dynamic: 0, scene: 0 },
      ),
    [referenceAssetDrafts],
  );

  /**
   * Saves EVERY reusable asset draft emitted by ESSP extraction. The draft kind
   * is the single routing authority: STATIC -> formation, DYNAMIC -> dynamic,
   * SCENE -> self-contained composition. This is metadata-only library work and
   * deliberately does not promote reference-owned clips.
   */
  const saveExtractedAssetsToLibrary = async () => {
    const count = { total: 0, static: 0, dynamic: 0, scene: 0 };
    for (const draft of referenceAssetDrafts) {
      const asset =
        draft.kind === "STATIC"
          ? await library.saveFormation(draft.formation, draft.input)
          : draft.kind === "DYNAMIC"
            ? await library.saveDynamicFormation(draft.formation, draft.input)
            : await library.saveScene(draft.scene, draft.dependencies, draft.input);
      if (!asset) continue;
      count.total += 1;
      if (draft.kind === "STATIC") count.static += 1;
      else if (draft.kind === "DYNAMIC") count.dynamic += 1;
      else count.scene += 1;
    }
    setSaved(count);
  };

  const ownerOf = (clipId: string) =>
    referenceLayer?.bindings.find((b) => b.clipId === clipId)?.owner ?? "PLANNER";

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <Layers className="size-3.5" /> Imported show → editable timeline
      </h2>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Extraction keeps the imported trajectories byte-exact as the playback source and adds
        editable clips on top. A clip switches to planner output only when you change its geometry,
        motion, timing or assignment.
      </p>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={extractReferenceShowToProject}
          disabled={!referenceShow || forensicsBusy}
          className="chip-btn justify-center disabled:opacity-40"
          title={
            !referenceShow
              ? "Import an ESSP show first"
              : "Replace the project content with the extracted timeline"
          }
        >
          <Wand2 className="size-3" />{" "}
          {forensicsBusy ? "Analysing…" : forensicsReport ? "Extract to timeline" : "Analyse & extract"}
        </button>
        <button
          onClick={() => {
            clearReferenceLayer();
            setSplices(null);
            setSaved(null);
          }}
          disabled={!referenceLayer}
          className="chip-btn justify-center disabled:opacity-40"
          title="Drop the imported playback layer; the timeline keeps playing planner output"
        >
          <Trash2 className="size-3" /> Drop layer
        </button>
      </div>

      {referenceExtractionError && (
        <p className="text-[10px] leading-relaxed text-critical">
          {referenceExtractionError.code}: {referenceExtractionError.message}
        </p>
      )}

      {referenceLayer && referenceOwnership && (
        <div className="space-y-2 pt-1">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <dt>reference time</dt>
            <dd className="text-right text-foreground">
              {referenceOwnership.referenceSeconds.toFixed(1)} s
            </dd>
            <dt>planner time</dt>
            <dd className="text-right text-foreground">
              {referenceOwnership.plannerSeconds.toFixed(1)} s
            </dd>
            <dt>intervals</dt>
            <dd className="text-right text-foreground">
              {referenceOwnership.referenceIntervalCount} ref /{" "}
              {referenceOwnership.plannerIntervalCount} planner
            </dd>
            <dt>playhead</dt>
            <dd className="text-right text-foreground">
              {referenceOwnedNow ? "IMPORTED" : "PLANNER"}
            </dd>
            <dt>assets ready</dt>
            <dd className="text-right text-foreground">{assetCounts.total}</dd>
            <dt>asset mix</dt>
            <dd className="text-right text-foreground">
              {assetCounts.static} static · {assetCounts.dynamic} dynamic · {assetCounts.scene} scene
            </dd>
          </dl>

          <button
            onClick={() => void saveExtractedAssetsToLibrary()}
            disabled={assetCounts.total === 0 || library.busy}
            className="chip-btn w-full justify-center disabled:opacity-40"
            title="Save every extracted STATIC, DYNAMIC and SCENE asset to the Library without promoting any clip"
          >
            <Library className="size-3" /> Save extracted assets to library
          </button>
          {saved !== null && (
            <p className="text-[10px] leading-relaxed text-success">
              {saved.total} assets saved — {saved.static} static · {saved.dynamic} dynamic · {saved.scene} scene.
              Reuse them from the Library panel.
            </p>
          )}

          <button
            onClick={() => setSplices(verifyReferenceSplices())}
            className="chip-btn w-full justify-center"
          >
            <ShieldCheck className="size-3" /> Verify splice boundaries
          </button>
          {splices && (
            <p
              className={`text-[10px] leading-relaxed ${splices.ok ? "text-success" : "text-warning"}`}
            >
              {splices.boundaries.length} boundaries — worst gap{" "}
              {splices.worstDeltaMeters.toFixed(2)} m (tolerance{" "}
              {splices.toleranceMeters.toFixed(2)} m)
              {splices.ok ? " — continuous" : " — review the promoted clips"}
            </p>
          )}

          <ul className="space-y-1">
            {referenceExtraction.map((d) => {
              const owner = ownerOf(d.clipId);
              return (
                <li key={d.clipId}>
                  <button
                    onClick={() => selectClip(d.clipId)}
                    className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left font-mono text-[10px] ${
                      selectedClipId === d.clipId ? "border-primary" : "border-border"
                    }`}
                  >
                    <span className="truncate">
                      {d.kind} {d.dynamic ? "· anim" : ""}{" "}
                      {d.representation === "COMPOSED_SCENE"
                        ? `· ${d.objects.length} objects`
                        : ""}{" "}
                      {d.fidelityRmsMeters != null ? `· rms ${d.fidelityRmsMeters.toFixed(2)}m` : ""}
                    </span>
                    <span
                      className={owner === "REFERENCE" ? "text-success" : "text-warning"}
                    >
                      {owner === "REFERENCE" ? "IMPORTED" : "PLANNER"}
                    </span>
                  </button>
                  {d.representation === "COMPOSED_SCENE" && (
                    <div className="mt-0.5 space-y-0.5 border-l border-border pl-2">
                      <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                        Composed scene · {d.decompositionSource ?? "evidence"} · confidence{" "}
                        {((d.decompositionConfidence ?? 0) * 100).toFixed(0)}%
                      </p>
                      {d.objects.map((o) => (
                        <p key={o.objectId} className="font-mono text-[9px] text-muted-foreground">
                          {o.name} · {o.droneCount} drones {o.dynamic ? "· anim" : "· static"} · res{" "}
                          {o.meanResidualMeters.toFixed(2)}m
                        </p>
                      ))}
                    </div>
                  )}
                  {owner === "REFERENCE" && (
                    <button
                      onClick={() => promoteReferenceClip(d.clipId)}
                      className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
                    >
                      Promote to planner
                    </button>
                  )}
                  {d.decompositionReasons.map((r) => (
                    <p key={r} className="text-[9px] leading-relaxed text-muted-foreground">
                      {r}
                    </p>
                  ))}
                  {d.warnings.map((w) => (
                    <p key={w} className="text-[9px] leading-relaxed text-warning">
                      {w}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>

          {referenceExtractionWarnings.length > 0 && (
            <ul className="space-y-1 text-[10px] text-warning">
              {referenceExtractionWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <ul className="space-y-1 text-[9px] leading-relaxed text-muted-foreground">
            {referenceLayerLimitations.map((l) => (
              <li key={l}>• {l}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
