import { FileArchive, PencilRuler, Trash2 } from "lucide-react";
import { useMemo, useRef } from "react";

import { esspUnitsToMeters } from "@/lib/import/essp";
import { analyzeImportedLighting } from "@/lib/import/essp/native/lightingAudit";
import { useStudio } from "@/lib/studio/store";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </>
  );
}

/**
 * Reference archive import + forensic report. Read-only: nothing here feeds the
 * planner, the optimiser or the safety auto-fixers.
 */
export default function EsspPanel() {
  const {
    referenceShow,
    referencePlayback,
    setReferencePlayback,
    referenceBusy,
    referenceError,
    importEsspFiles,
    clearReferenceShow,
    selectedReferenceDroneId,
    selectReferenceDrone,
    showReferencePaths,
    setShowReferencePaths,
    time,
    referenceLayer,
    extractReferenceShowToProject,
  } = useStudio();
  const inputRef = useRef<HTMLInputElement>(null);
  const report = referenceShow?.report;
  const stats = referenceShow?.statistics;
  const drone = referenceShow?.drones.find((d) => d.sourceId === selectedReferenceDroneId);
  // IMPORTED LIGHTING AUDIT — description only. Never rewrites reference bytes.
  const lighting = useMemo(
    () => analyzeImportedLighting(referenceShow, referenceLayer),
    [referenceShow, referenceLayer],
  );

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <FileArchive className="size-3.5" /> Reference show (ESSP)
      </h2>
      <p className="text-[10px] leading-relaxed text-warning">
        EXPERIMENTAL — REVERSE-ENGINEERED REFERENCE FORMAT. Imported data is read-only and is never
        re-planned, optimised or auto-corrected.
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".essp,.zip"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void importEsspFiles(files);
          e.target.value = "";
        }}
      />
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={referenceBusy}
          className="chip-btn justify-center disabled:opacity-40"
        >
          {referenceBusy ? "Reading…" : "Import .essp / .zip"}
        </button>
        <button
          onClick={clearReferenceShow}
          disabled={!referenceShow}
          className="chip-btn justify-center disabled:opacity-40"
        >
          <Trash2 className="size-3" /> Clear
        </button>
      </div>
      {referenceShow ? (
        <div className="space-y-1.5 rounded border border-primary/50 bg-primary/5 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Editable timeline
            </span>
            <span className="status-pill status-ok" data-testid="essp-source-preserved">
              Original ESSP preserved
            </span>
          </div>
          {hasEditableTimeline ? (
            <>
              <p
                data-testid="essp-editable-created"
                className="flex items-center gap-1.5 text-[11px] font-medium text-success"
              >
                <Check className="size-3" /> Editable timeline created — original ESSP preserved.
              </p>
              <button
                type="button"
                data-testid="essp-make-editable-again"
                onClick={extractReferenceShowToProject}
                disabled={forensicsBusy}
                className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                {forensicsBusy ? "Re-extracting…" : "Re-extract and replace"}
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="essp-make-editable"
              onClick={extractReferenceShowToProject}
              disabled={forensicsBusy}
              className="chip-btn chip-btn-active w-full justify-center disabled:opacity-40"
            >
              <PencilRuler className="size-3" />{" "}
              {forensicsBusy ? "Preparing…" : "Make editable"}
            </button>
          )}
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Create an editable Studio timeline while preserving the original ESSP as the reference
            source. The imported samples stay the playback authority for every interval you do not
            replace.
          </p>
          {referenceExtractionError && (
            <p
              data-testid="essp-make-editable-error"
              className="text-[10px] leading-relaxed text-critical"
            >
              {referenceExtractionError.code}: {referenceExtractionError.message} — the imported
              reference show and its source bytes are unchanged.
            </p>
          )}
        </div>
      ) : null}
      {lighting ? (
        <div
          data-testid="imported-lighting-audit"
          className="space-y-1 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground"
        >
          <p className="uppercase tracking-[0.14em]">imported lighting</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <Row label="rgb frames" value={`${lighting.frameCount} @ ${lighting.rgbRateHz} Hz`} />
            <Row label="segments" value={String(lighting.intervals.length)} />
            <Row label="blackout" value={`${lighting.blackoutSeconds.toFixed(2)} s`} />
            <Row label="held colour" value={`${lighting.solidSeconds.toFixed(2)} s`} />
            <Row label="varying" value={`${lighting.varyingSeconds.toFixed(2)} s`} />
            <Row
              label="exact as effects"
              value={`${(lighting.exactCoverage * 100).toFixed(1)} %`}
            />
          </dl>
          <p className="leading-relaxed">
            Varying intervals cannot be expressed as Studio effects without loss, so they stay owned
            by the imported RGB track (zero error) instead of being approximated.
          </p>
        </div>
      ) : null}
      {referenceError && (
        <p className="text-[10px] leading-relaxed text-critical">
          {referenceError.code}: {referenceError.message}
        </p>
      )}

      {referenceShow && report && stats && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <input
                type="checkbox"
                checked={referencePlayback}
                onChange={(e) => setReferencePlayback(e.target.checked)}
              />
              Play reference
            </label>
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <input
                type="checkbox"
                checked={showReferencePaths}
                onChange={(e) => setShowReferencePaths(e.target.checked)}
              />
              Paths
            </label>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <Row label="files" value={`${report.validFiles}/${report.files}`} />
            <Row label="rejected" value={String(report.invalidFiles)} />
            <Row label="grid" value={report.launchGrid.inferredGrid} />
            <Row
              label="pad spacing"
              value={
                report.launchGrid.xSpacingRaw != null
                  ? `${esspUnitsToMeters(report.launchGrid.xSpacingRaw).toFixed(2)} m`
                  : "irregular"
              }
            />
            <Row label="pos rate" value={`${report.timing.positionRateHz} Hz`} />
            <Row label="rgb rate" value={`${report.timing.rgbRateHz} Hz`} />
            <Row label="pos duration" value={`${report.timing.positionDurationSeconds.toFixed(3)} s`} />
            <Row label="rgb duration" value={`${report.timing.rgbDurationSeconds.toFixed(3)} s`} />
            <Row label="max altitude" value={`${stats.maxAltitudeMeters.toFixed(1)} m`} />
            <Row label="max sampled speed" value={`${stats.maxSampledSpeedMps.toFixed(2)} m/s`} />
            <Row
              label="min separation"
              value={`${stats.minPairwiseDistanceMeters.toFixed(2)} m @ ${stats.minPairwiseDistanceTime.toFixed(1)} s`}
            />
            <Row label="scale" value={`${report.coordinateScale.metersPerUnit} m/unit`} />
          </dl>

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {report.timing.endpointConvention}
          </p>

          <label className="space-y-1.5">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Inspect drone
            </span>
            <select
              value={selectedReferenceDroneId ?? ""}
              onChange={(e) => selectReferenceDrone(e.target.value || null)}
              className="studio-input"
            >
              <option value="">— none —</option>
              {referenceShow.drones.map((d) => (
                <option key={d.sourceId} value={d.sourceId}>
                  {d.sourceId} ({d.sourceFile})
                </option>
              ))}
            </select>
          </label>

          {drone && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
              <Row label="file size" value={`${drone.fileSize} B`} />
              <Row label="pos samples" value={String(drone.positionSampleCount)} />
              <Row label="rgb samples" value={String(drone.rgbSampleCount)} />
              <Row
                label="raw @ t"
                value={(() => {
                  const i =
                    Math.min(
                      drone.positionSampleCount - 1,
                      Math.max(0, Math.floor(time * report.timing.positionRateHz)),
                    ) * 3;
                  return `${drone.positionSamples[i]}, ${drone.positionSamples[i + 1]}, ${drone.positionSamples[i + 2]}`;
                })()}
              />
              <Row
                label="launch (m)"
                value={drone.launchPosition.map((v) => v.toFixed(2)).join(", ")}
              />
            </dl>
          )}

          {report.diagnostics.some((d) => !d.ok) && (
            <ul className="space-y-1 text-[10px] text-critical">
              {report.diagnostics
                .filter((d) => !d.ok)
                .slice(0, 8)
                .map((d) => (
                  <li key={d.fileName}>
                    {d.fileName}: {d.code ?? "ERROR"} — {d.message}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
