import { AlertTriangle, Check, FileUp, Sparkles, X } from "lucide-react";
import { useState } from "react";

import type { SvgSamplingMode } from "@/lib/show/svg";
import { useStudio } from "@/lib/studio/store";

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (v: number) => string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
        <span className="font-mono text-accent">
          {format ? format(value) : value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="studio-range"
      />
    </label>
  );
}

/**
 * SVG / logo import workflow: file pick -> live exact-N draft -> commit.
 * All geometry work happens in the pure engine (src/lib/show/svg).
 */
export default function SvgImportPanel() {
  const {
    project,
    svgDraft,
    svgBusy,
    svgError,
    importSvg,
    updateSvgDraft,
    cancelSvgDraft,
    commitSvgDraft,
    selectedClipId,
  } = useStudio();
  const [name, setName] = useState("");

  const draft = svgDraft;
  const report = draft?.result?.report;
  const params = draft?.params;

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <Sparkles className="size-3.5" /> Vector / logo
      </h2>

      <label className="chip-btn cursor-pointer justify-center">
        <FileUp className="size-3" />
        {svgBusy ? "Parsing…" : "Import SVG"}
        <input
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importSvg(file);
          }}
        />
      </label>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Outlines and filled regions are converted into exactly {project.droneCount} drone positions.
        Files are parsed locally as inert geometry — scripts, links and raster images are ignored.
      </p>

      {svgError ? (
        <p className="flex gap-1.5 rounded-md bg-destructive/15 p-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            {svgError.message}
            {svgError.details ? <span className="block opacity-70">{svgError.details}</span> : null}
          </span>
        </p>
      ) : null}

      {draft && params ? (
        <div className="space-y-3 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-[11px] text-foreground">{draft.asset.fileName}</p>
            <span className="font-mono text-[10px] text-muted-foreground">
              {draft.asset.geometry.contours.length} contours
            </span>
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Formation name (optional)"
            className="studio-input"
            aria-label="SVG formation name"
          />

          <div className="grid grid-cols-2 gap-2">
            {(["outline", "fill"] as SvgSamplingMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => updateSvgDraft({ mode })}
                className={`chip-btn justify-center ${params.mode === mode ? "mini-btn-accent" : ""}`}
                aria-pressed={params.mode === mode}
              >
                {mode === "outline" ? "Outline" : "Fill"}
              </button>
            ))}
          </div>

          <Slider
            label="Drones for this visual"
            value={params.targetCount}
            onChange={(targetCount) => updateSvgDraft({ targetCount })}
            min={4}
            max={project.droneCount}
          />

          <Slider
            label="Width"
            value={params.width}
            onChange={(width) => updateSvgDraft({ width })}
            min={10}
            max={Math.max(40, Math.round(project.area.width * 1.2))}
            unit="m"
          />
          <Slider
            label="Altitude"
            value={params.altitude}
            onChange={(altitude) => updateSvgDraft({ altitude })}
            min={5}
            max={Math.round(project.area.height)}
            unit="m"
          />
          <div className="grid grid-cols-2 gap-3">
            <Slider
              label="Offset X"
              value={params.positionX}
              onChange={(positionX) => updateSvgDraft({ positionX })}
              min={-Math.round(project.area.width / 2)}
              max={Math.round(project.area.width / 2)}
              unit="m"
            />
            <Slider
              label="Depth"
              value={params.depth}
              onChange={(depth) => updateSvgDraft({ depth })}
              min={-Math.round(project.area.depth / 2)}
              max={Math.round(project.area.depth / 2)}
              unit="m"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Slider
              label="Rotation"
              value={params.rotation}
              onChange={(rotation) => updateSvgDraft({ rotation })}
              min={-180}
              max={180}
              unit="°"
            />
            <Slider
              label="Relaxation"
              value={params.relaxIterations}
              onChange={(relaxIterations) => updateSvgDraft({ relaxIterations })}
              min={0}
              max={20}
            />
          </div>
          <Slider
            label="Detail"
            value={params.flattenTolerance}
            onChange={(flattenTolerance) => updateSvgDraft({ flattenTolerance })}
            min={0.05}
            max={2}
            step={0.05}
            format={(v) => v.toFixed(2)}
          />
          <Slider
            label="Seed"
            value={params.seed}
            onChange={(seed) => updateSvgDraft({ seed })}
            min={1}
            max={99999999}
            step={1}
            format={(v) => String(v)}
          />

          {report ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
              <div className="flex justify-between">
                <dt>points</dt>
                <dd className="text-accent">
                  {report.generatedCount}/{report.targetCount}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>min gap</dt>
                <dd
                  className={
                    report.minSpacing < project.limits.minSeparation
                      ? "text-destructive"
                      : "text-accent"
                  }
                >
                  {report.minSpacing.toFixed(2)} m
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>avg gap</dt>
                <dd>{report.avgNearestNeighborSpacing.toFixed(2)} m</dd>
              </div>
              <div className="flex justify-between">
                <dt>duplicates</dt>
                <dd>{report.duplicatePoints}</dd>
              </div>
            </dl>
          ) : null}

          {draft.error ? (
            <p className="rounded-md bg-destructive/15 p-2 text-[11px] text-destructive">
              {draft.error.message}
            </p>
          ) : null}

          {report && report.warnings.length > 0 ? (
            <ul className="space-y-1">
              {report.warnings.map((w, i) => (
                <li
                  key={`${w.code}-${i}`}
                  className="flex gap-1.5 text-[10px] leading-relaxed text-warning"
                >
                  <AlertTriangle className="mt-px size-3 shrink-0" />
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-2">
            <button
              data-testid="svg-add-to-scene"
              onClick={() => {
                commitSvgDraft({
                  ...(name.trim() ? { name } : {}),
                  target: "SCENE",
                  droneCount: params.targetCount,
                });
                setName("");
              }}
              disabled={!draft.result || !selectedClipId}
              title={
                selectedClipId
                  ? "Places one visual inside the selected scene"
                  : "Select a scene in the timeline first"
              }
              className="chip-btn mini-btn-accent w-full justify-center disabled:opacity-40"
            >
              <Check className="size-3" /> Add to current scene
            </button>
            <div className="flex gap-2">
              <button
                data-testid="svg-add-as-clip"
                onClick={() => {
                  commitSvgDraft({
                    ...(name.trim() ? { name } : {}),
                    target: "NEW_CLIP",
                    droneCount: params.targetCount,
                  });
                  setName("");
                }}
                disabled={!draft.result}
                className="chip-btn flex-1 justify-center disabled:opacity-40"
              >
                New scene
              </button>
              <button onClick={cancelSvgDraft} className="chip-btn justify-center">
                <X className="size-3" /> Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
