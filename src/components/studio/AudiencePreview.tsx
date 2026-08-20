/**
 * AUDIENCE VIEW / PERSPECTIVE PREVIEW — DIAGNOSTICS ONLY.
 *
 * All perspective math comes from the canonical analyzer
 * (`analyzeAudienceProjection`) and all normalisation from the pure presentation
 * helpers. This component evaluates no geometry in JSX, gates no export and
 * never mutates the show — it only draws what the analyzer reports.
 */
import { useMemo } from "react";
import { Eye, Info } from "lucide-react";

import {
  AUDIENCE_VIEWPOINT_NOTE,
  analyzeAudienceProjection,
  audienceMetricRows,
  buildAudiencePreview,
  type AudiencePreviewMode,
} from "@/lib/show/diagnostics";
import { AudienceProjectionError } from "@/lib/show/diagnostics/audienceProjection";
import type { Vector3Tuple } from "@/lib/show/types";
import { useAudienceView } from "@/lib/studio/audienceView";
import { useStudio } from "@/lib/studio/store";

const MODES: AudiencePreviewMode[] = ["ORTHOGRAPHIC", "PERSPECTIVE", "OVERLAY"];
const SIZE = 260;

export default function AudiencePreview() {
  const { samplesAtTime, time } = useStudio();
  const {
    params,
    setParam,
    resetParams,
    view,
    previewMode,
    setPreviewMode,
    audienceCamera,
    setAudienceCamera,
    showDepth,
    setShowDepth,
  } = useAudienceView();

  const framePoints = useMemo<Vector3Tuple[]>(
    () => samplesAtTime(time).map((s) => s.position as Vector3Tuple),
    [samplesAtTime, time],
  );

  // CURRENT FRAME ONLY — cheap, and never a full-show sweep on render.
  const result = useMemo(() => {
    try {
      return { report: analyzeAudienceProjection(framePoints, view), error: null as string | null };
    } catch (e) {
      return {
        report: null,
        error: e instanceof AudienceProjectionError ? e.message : "invalid viewpoint",
      };
    }
  }, [framePoints, view]);

  const preview = useMemo(
    () => (result.report ? buildAudiencePreview(result.report, previewMode) : null),
    [result.report, previewMode],
  );
  const rows = useMemo(
    () => (result.report ? audienceMetricRows(result.report) : []),
    [result.report],
  );

  return (
    <section className="panel-card" data-testid="audience-view-analysis">
      <h2 className="panel-title">
        <Eye className="size-3.5 text-muted-foreground" />
        Audience view / perspective
      </h2>
      <p className="pb-1 text-[10px] leading-relaxed text-muted-foreground">
        {AUDIENCE_VIEWPOINT_NOTE} Visualisation and measurement only: no formation, planner, safety,
        assignment or export behaviour is affected.
      </p>

      <div className="grid grid-cols-2 gap-2 pb-2">
        {(
          [
            ["viewerDistanceMeters", "Viewer distance (m)"],
            ["viewerHeightMeters", "Viewer height (m)"],
            ["viewerOffsetXMeters", "Viewer offset X (m)"],
            ["targetHeightMeters", "Target height (m)"],
            ["targetOffsetXMeters", "Target offset X (m)"],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
          >
            {label}
            <input
              type="number"
              step={key === "viewerHeightMeters" ? 0.1 : 5}
              value={params[key]}
              onChange={(e) => setParam(key, Number(e.target.value))}
              className="studio-input text-right font-mono"
              data-testid={`audience-${key}`}
            />
          </label>
        ))}
        <button onClick={resetParams} className="chip-btn mt-auto justify-center">
          Reset viewpoint
        </button>
      </div>

      <div className="flex gap-1 pb-2">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => setPreviewMode(m)}
            aria-pressed={previewMode === m}
            data-testid={`audience-mode-${m}`}
            className={`chip-btn flex-1 justify-center ${
              previewMode === m ? "border-accent text-accent" : ""
            }`}
          >
            {m === "ORTHOGRAPHIC" ? "Authoring" : m === "PERSPECTIVE" ? "Audience" : "Overlay"}
          </button>
        ))}
      </div>

      {result.error ? (
        <p
          className="rounded border border-destructive/50 bg-destructive/10 p-2 text-[10px] text-destructive"
          data-testid="audience-invalid"
        >
          INVALID VIEWPOINT — {result.error}
        </p>
      ) : null}

      {preview && !preview.empty ? (
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="w-full rounded border border-border bg-surface-sunken"
          data-testid="audience-preview-svg"
          role="img"
          aria-label="Audience projection preview"
        >
          {preview.showOrthographic
            ? preview.points.map((p) => (
                <circle
                  key={`o${p.index}`}
                  cx={p.orthographic[0] * SIZE}
                  cy={p.orthographic[1] * SIZE}
                  r={1.6}
                  className="fill-muted-foreground/70"
                />
              ))
            : null}
          {preview.showPerspective
            ? preview.points.map((p) => (
                <circle
                  key={`p${p.index}`}
                  cx={p.perspective[0] * SIZE}
                  cy={p.perspective[1] * SIZE}
                  r={p.isWorst ? 3 : 1.6}
                  className={p.isWorst ? "fill-warning" : "fill-accent"}
                />
              ))
            : null}
          {preview.mode === "OVERLAY"
            ? preview.points.map((p) => (
                <line
                  key={`l${p.index}`}
                  x1={p.orthographic[0] * SIZE}
                  y1={p.orthographic[1] * SIZE}
                  x2={p.perspective[0] * SIZE}
                  y2={p.perspective[1] * SIZE}
                  className="stroke-warning/40"
                  strokeWidth={0.6}
                />
              ))
            : null}
        </svg>
      ) : null}

      <dl
        className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2 font-mono text-[10px] text-muted-foreground"
        data-testid="audience-metrics"
      >
        {rows.map((r) => (
          <div key={r.label} className="col-span-2 grid grid-cols-2 gap-x-3">
            <dt className="uppercase tracking-[0.12em]">{r.label}</dt>
            <dd className="text-right text-foreground">{r.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex gap-1 pt-2">
        <button
          onClick={() => setAudienceCamera(!audienceCamera)}
          aria-pressed={audienceCamera}
          data-testid="audience-camera-toggle"
          className={`chip-btn flex-1 justify-center ${audienceCamera ? "border-accent text-accent" : ""}`}
        >
          {audienceCamera ? "Free / orbit camera" : "View from audience"}
        </button>
        <button
          onClick={() => setShowDepth(!showDepth)}
          aria-pressed={showDepth}
          data-testid="audience-depth-toggle"
          className={`chip-btn flex-1 justify-center ${showDepth ? "border-accent text-accent" : ""}`}
        >
          Show depth
        </button>
      </div>

      <p className="flex gap-1 pt-2 text-[10px] leading-relaxed text-muted-foreground">
        <Info className="mt-[1px] size-3 shrink-0" />
        <span>
          Related but distinct diagnostics: <strong>Vertical stack</strong> measures physical
          world-Y alignment; <strong>audience projection</strong> measures apparent perspective
          geometry. Their thresholds and verdicts are never combined. The audience camera changes the
          camera only.
        </span>
      </p>
    </section>
  );
}
