/**
 * ADD VISUAL — the everyday creation wizard of the Visuals panel.
 *
 * One primary action leads to the four real creation paths (Import SVG, Text,
 * Line, Existing asset) plus an HONEST unavailable entry for AI images, which
 * have no canonical scene-object pipeline.
 *
 * Everything here is presentation only:
 *   - geometry comes from the canonical SVG / text / native formation engines;
 *   - drone reserve comes from the canonical scene budget (never recomputed);
 *   - one "Add to scene" equals exactly ONE canonical store mutation, i.e. one
 *     undo entry. Preview and Cancel mutate nothing.
 */
import { AlertTriangle, FileUp, Plus, Sparkles, Type as TypeIcon, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import type { RGB } from "@/lib/show/types";
import { generateTextGeometry } from "@/lib/show/text";
import {
  CREATE_VISUAL_CHOICES,
  buildTextVisualRecipe,
  describeSvgGeometry,
  estimateVisualSpacing,
  evaluateDroneAllocation,
  TEXT_VISUAL_FONTS,
  type CreateVisualMode,
} from "@/lib/studio/createVisual";
import { useStudio } from "@/lib/studio/store";

const toHex = (rgb: RGB): string =>
  `#${rgb
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const fromHex = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16) || 0,
  parseInt(hex.slice(3, 5), 16) || 0,
  parseInt(hex.slice(5, 7), 16) || 0,
];

function NumberField({
  label,
  value,
  step,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (next: number) => void;
  testId?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-[0.14em]">{label}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
        className="studio-input w-20 text-right font-mono"
      />
    </label>
  );
}

function ColourField({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  testId: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-[0.14em]">Base colour</span>
      <input
        type="color"
        value={value}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-16 cursor-pointer rounded border border-border bg-transparent"
      />
    </label>
  );
}

export default function AddVisualWizard({
  clipId,
  fleet,
  used,
}: {
  clipId: string;
  fleet: number;
  used: number;
}) {
  const {
    project,
    svgDraft,
    svgBusy,
    svgError,
    importSvg,
    updateSvgDraft,
    cancelSvgDraft,
    commitSvgDraft,
    addNativeVisual,
    addTextVisual,
    addSceneObject,
  } = useStudio();

  const [mode, setMode] = useState<CreateVisualMode | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [colour, setColour] = useState("#ffffff");
  const [mirror, setMirror] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Text inputs
  const [text, setText] = useState("SUPER RALY");
  const [font, setFont] = useState(TEXT_VISUAL_FONTS[1]!.weight);
  const [textDrones, setTextDrones] = useState(60);
  const [textWidth, setTextWidth] = useState(70);
  const [textHeight, setTextHeight] = useState(18);
  const [textX, setTextX] = useState(0);
  const [textY, setTextY] = useState(50);
  const [textZ, setTextZ] = useState(0);

  // Line inputs
  const [lineDrones, setLineDrones] = useState(20);
  const [lineLength, setLineLength] = useState(40);
  const [lineRows, setLineRows] = useState(1);
  const [lineX, setLineX] = useState(0);
  const [lineY, setLineY] = useState(45);
  const [lineZ, setLineZ] = useState(0);
  const [lineRotation, setLineRotation] = useState(0);

  // Existing asset inputs
  const [assetId, setAssetId] = useState("");
  const [assetDrones, setAssetDrones] = useState(20);

  const reset = useCallback(() => {
    setOpen(false);
    setMode(null);
    setName("");
    setMirror(false);
    setAdvanced(false);
    setFileError(null);
    cancelSvgDraft();
  }, [cancelSvgDraft]);

  const pickFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      const isSvg = file.name.toLowerCase().endsWith(".svg") || file.type === "image/svg+xml";
      if (!isSvg) {
        setFileError(`“${file.name}” is not an SVG file.`);
        return;
      }
      setFileError(null);
      void importSvg(file);
    },
    [importSvg],
  );

  const svgFacts = useMemo(
    () => (svgDraft ? describeSvgGeometry(svgDraft.asset.fileName, svgDraft.asset.geometry) : null),
    [svgDraft],
  );
  const spacing = useMemo(
    () => estimateVisualSpacing(svgDraft?.result?.report ?? null),
    [svgDraft],
  );
  const textRecipe = useMemo(
    () =>
      buildTextVisualRecipe({
        text,
        weight: font,
        droneCount: Math.round(textDrones),
        widthMeters: textWidth,
        heightMeters: textHeight,
        altitudeMeters: 0,
      }),
    [text, font, textDrones, textWidth, textHeight],
  );
  const textPreview = useMemo(() => {
    if (!textRecipe.ok) return { ok: false as const, reason: textRecipe.reason };
    try {
      const geometry = generateTextGeometry(textRecipe.recipe);
      return { ok: true as const, points: geometry.points.length, path: geometry.pathMeters };
    } catch (error) {
      return {
        ok: false as const,
        reason: error instanceof Error ? error.message : "Text geometry failed.",
      };
    }
  }, [textRecipe]);

  const requested =
    mode === "SVG"
      ? (svgDraft?.params.targetCount ?? 0)
      : mode === "TEXT"
        ? Math.round(textDrones)
        : mode === "LINE"
          ? Math.round(lineDrones)
          : mode === "ASSET"
            ? Math.round(assetDrones)
            : 0;
  const allocation = evaluateDroneAllocation({
    fleet,
    used,
    requested,
    minimum: mode === "LINE" ? 2 : 1,
  });

  const ready =
    mode === "SVG"
      ? Boolean(svgDraft?.result) && allocation.valid
      : mode === "TEXT"
        ? textPreview.ok && allocation.valid
        : mode === "LINE"
          ? allocation.valid
          : mode === "ASSET"
            ? Boolean(assetId) && allocation.valid
            : false;

  const commit = useCallback(() => {
    const color = fromHex(colour);
    if (mode === "SVG" && svgDraft?.result) {
      commitSvgDraft({
        ...(name.trim() ? { name: name.trim() } : {}),
        target: "SCENE",
        clipId,
        droneCount: svgDraft.params.targetCount,
        mirrorX: mirror,
        color,
      });
    } else if (mode === "TEXT" && textRecipe.ok) {
      addTextVisual(clipId, {
        recipe: textRecipe.recipe,
        name: name.trim() || textRecipe.normalizedText,
        position: [textX, textY, textZ],
        color,
        mirrorX: mirror,
      });
    } else if (mode === "LINE") {
      addNativeVisual(clipId, {
        kind: "line",
        name: name.trim() || "Line",
        droneCount: Math.round(lineDrones),
        params: { length: Math.max(1, lineLength), rows: Math.max(1, Math.round(lineRows)) },
        position: [lineX, lineY, lineZ],
        rotationDeg: [0, 0, lineRotation],
        color,
        mirrorX: mirror,
      });
    } else if (mode === "ASSET" && assetId) {
      const asset = project.formations.find((f) => f.id === assetId);
      addSceneObject(clipId, {
        source: { kind: "STATIC", formationId: assetId },
        name: name.trim() || asset?.name || "Visual",
        requestedDroneCount: Math.round(assetDrones),
      });
    } else {
      return;
    }
    reset();
  }, [
    addNativeVisual,
    addSceneObject,
    addTextVisual,
    assetDrones,
    assetId,
    clipId,
    colour,
    commitSvgDraft,
    lineDrones,
    lineLength,
    lineRows,
    lineRotation,
    lineX,
    lineY,
    lineZ,
    mirror,
    mode,
    name,
    project.formations,
    reset,
    svgDraft,
    textRecipe,
    textX,
    textY,
    textZ,
  ]);

  if (!open) {
    return (
      <button
        type="button"
        data-testid="composer-add-visual"
        onClick={() => setOpen(true)}
        className="chip-btn mini-btn-accent mt-2 w-full justify-center"
      >
        <Plus className="size-3" /> Add visual
      </button>
    );
  }

  return (
    <div
      className="mt-2 space-y-2 rounded border border-border bg-surface-sunken p-2"
      data-testid="composer-add-visual-wizard"
      data-mode={mode ?? "CHOOSE"}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Add visual
        </p>
        <button
          type="button"
          data-testid="wizard-cancel"
          onClick={reset}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Cancel add visual"
        >
          <X className="size-3" />
        </button>
      </div>

      {mode === null ? (
        <ul className="space-y-1" data-testid="wizard-choices">
          {CREATE_VISUAL_CHOICES.map((choice) => (
            <li key={choice.mode}>
              <button
                type="button"
                disabled={!choice.available}
                data-testid={`composer-choice-${choice.mode}`}
                onClick={() => setMode(choice.mode)}
                className="chip-btn w-full justify-start disabled:opacity-40"
              >
                {choice.mode === "SVG" ? <FileUp className="size-3" /> : null}
                {choice.mode === "TEXT" ? <TypeIcon className="size-3" /> : null}
                {choice.mode === "AI" ? <Sparkles className="size-3" /> : null}
                <span className="truncate">{choice.label}</span>
              </button>
              <p className="px-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {choice.description}
              </p>
              {!choice.available && choice.unavailableNote ? (
                <p
                  className="flex gap-1 px-1 font-mono text-[10px] leading-relaxed text-warning"
                  data-testid={`composer-choice-${choice.mode}-unavailable`}
                >
                  <AlertTriangle className="mt-px size-3 shrink-0" />
                  <span>{choice.unavailableNote}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {mode === "SVG" ? (
        <div className="space-y-1.5">
          <div
            data-testid="wizard-svg-dropzone"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              pickFile(event.dataTransfer?.files?.[0]);
            }}
            onClick={() => fileInput.current?.click()}
            className={`cursor-pointer rounded border border-dashed p-3 text-center font-mono text-[10px] leading-relaxed ${
              dragging ? "border-accent text-accent" : "border-border text-muted-foreground"
            }`}
          >
            {svgBusy ? "Parsing…" : "Drop an .svg file here, or click to choose one"}
            <input
              ref={fileInput}
              type="file"
              accept=".svg,image/svg+xml"
              aria-label="SVG file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                pickFile(file);
              }}
            />
          </div>

          {(fileError ?? svgError) ? (
            <p
              className="flex gap-1 rounded bg-destructive/15 p-1.5 font-mono text-[10px] text-destructive"
              data-testid="wizard-svg-error"
            >
              <AlertTriangle className="mt-px size-3 shrink-0" />
              <span>{fileError ?? svgError?.message}</span>
            </p>
          ) : null}

          {svgFacts ? (
            <>
              <p
                className="truncate font-mono text-[10px] text-foreground"
                data-testid="wizard-svg-filename"
              >
                {svgFacts.fileName}
              </p>
              <p
                className="font-mono text-[10px] text-muted-foreground"
                data-testid="wizard-svg-bounds"
              >
                {svgFacts.widthUnits.toFixed(0)} × {svgFacts.heightUnits.toFixed(0)} units ·{" "}
                {svgFacts.aspectLabel} · {svgFacts.contours} contours
              </p>
              {spacing ? (
                <p
                  className="font-mono text-[10px] text-muted-foreground"
                  data-testid="wizard-svg-spacing"
                >
                  spacing ≈ {spacing.avgSpacing.toFixed(2)} m (min {spacing.minSpacing.toFixed(2)}{" "}
                  m)
                </p>
              ) : null}
              <NumberField
                label="Drones"
                value={svgDraft?.params.targetCount ?? 0}
                step={1}
                testId="wizard-drones"
                onChange={(value) => updateSvgDraft({ targetCount: Math.round(value) })}
              />
              <NumberField
                label="Width m"
                value={svgDraft?.params.width ?? 0}
                step={1}
                testId="wizard-svg-width"
                onChange={(value) => updateSvgDraft({ width: Math.max(1, value) })}
              />
              <div className="grid grid-cols-3 gap-1">
                <NumberField
                  label="X"
                  value={svgDraft?.params.positionX ?? 0}
                  step={0.5}
                  testId="wizard-svg-x"
                  onChange={(value) => updateSvgDraft({ positionX: value })}
                />
                <NumberField
                  label="Y"
                  value={svgDraft?.params.altitude ?? 0}
                  step={0.5}
                  testId="wizard-svg-y"
                  onChange={(value) => updateSvgDraft({ altitude: Math.max(0, value) })}
                />
                <NumberField
                  label="Z"
                  value={svgDraft?.params.depth ?? 0}
                  step={0.5}
                  testId="wizard-svg-z"
                  onChange={(value) => updateSvgDraft({ depth: value })}
                />
              </div>
              <NumberField
                label="Rotation"
                value={svgDraft?.params.rotation ?? 0}
                step={5}
                testId="wizard-svg-rotation"
                onChange={(value) => updateSvgDraft({ rotation: value })}
              />
              <button
                type="button"
                data-testid="wizard-advanced-toggle"
                onClick={() => setAdvanced((v) => !v)}
                className="chip-btn w-full justify-center"
              >
                {advanced ? "Hide advanced geometry" : "Advanced geometry"}
              </button>
              {advanced ? (
                <div className="space-y-1.5" data-testid="wizard-advanced">
                  <div className="grid grid-cols-2 gap-1">
                    {(["outline", "fill"] as const).map((samplingMode) => (
                      <button
                        key={samplingMode}
                        type="button"
                        aria-pressed={svgDraft?.params.mode === samplingMode}
                        data-testid={`wizard-svg-mode-${samplingMode}`}
                        onClick={() => updateSvgDraft({ mode: samplingMode })}
                        className={`chip-btn justify-center ${
                          svgDraft?.params.mode === samplingMode ? "mini-btn-accent" : ""
                        }`}
                      >
                        {samplingMode === "outline" ? "Outline" : "Fill"}
                      </button>
                    ))}
                  </div>
                  <NumberField
                    label="Relaxation"
                    value={svgDraft?.params.relaxIterations ?? 0}
                    step={1}
                    testId="wizard-svg-relax"
                    onChange={(value) =>
                      updateSvgDraft({ relaxIterations: Math.max(0, Math.round(value)) })
                    }
                  />
                  <NumberField
                    label="Detail"
                    value={svgDraft?.params.flattenTolerance ?? 0}
                    step={0.05}
                    testId="wizard-svg-detail"
                    onChange={(value) =>
                      updateSvgDraft({ flattenTolerance: Math.max(0.05, value) })
                    }
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {mode === "TEXT" ? (
        <div className="space-y-1.5" data-testid="wizard-text">
          <input
            value={text}
            aria-label="Text to fly"
            data-testid="wizard-text-input"
            onChange={(event) => setText(event.target.value)}
            className="studio-input w-full font-mono"
          />
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">Font</span>
            <select
              value={font}
              data-testid="wizard-text-font"
              onChange={(event) =>
                setFont(event.target.value as (typeof TEXT_VISUAL_FONTS)[number]["weight"])
              }
              className="studio-input w-28 font-mono"
            >
              {TEXT_VISUAL_FONTS.map((option) => (
                <option key={option.weight} value={option.weight}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Drones"
            value={textDrones}
            step={1}
            testId="wizard-drones"
            onChange={setTextDrones}
          />
          <div className="grid grid-cols-2 gap-1">
            <NumberField
              label="Width m"
              value={textWidth}
              step={1}
              testId="wizard-text-width"
              onChange={setTextWidth}
            />
            <NumberField
              label="Height m"
              value={textHeight}
              step={1}
              testId="wizard-text-height"
              onChange={setTextHeight}
            />
          </div>
          <div className="grid grid-cols-3 gap-1">
            <NumberField
              label="X"
              value={textX}
              step={0.5}
              testId="wizard-text-x"
              onChange={setTextX}
            />
            <NumberField
              label="Y"
              value={textY}
              step={0.5}
              testId="wizard-text-y"
              onChange={setTextY}
            />
            <NumberField
              label="Z"
              value={textZ}
              step={0.5}
              testId="wizard-text-z"
              onChange={setTextZ}
            />
          </div>
          <p
            className={`font-mono text-[10px] ${textPreview.ok ? "text-muted-foreground" : "text-destructive"}`}
            data-testid="wizard-text-preview"
          >
            {textPreview.ok
              ? `${textPreview.points} points · ${textPreview.path.toFixed(1)} m of stroke`
              : textPreview.reason}
          </p>
        </div>
      ) : null}

      {mode === "LINE" ? (
        <div className="space-y-1.5" data-testid="composer-add-line">
          <NumberField
            label="Drones"
            value={lineDrones}
            step={1}
            testId="line-drones"
            onChange={setLineDrones}
          />
          <NumberField
            label="Length m"
            value={lineLength}
            step={1}
            testId="line-length"
            onChange={setLineLength}
          />
          <NumberField
            label="Rows"
            value={lineRows}
            step={1}
            testId="line-rows"
            onChange={setLineRows}
          />
          <div className="grid grid-cols-3 gap-1">
            <NumberField label="X" value={lineX} step={0.5} testId="line-x" onChange={setLineX} />
            <NumberField label="Y" value={lineY} step={0.5} testId="line-y" onChange={setLineY} />
            <NumberField label="Z" value={lineZ} step={0.5} testId="line-z" onChange={setLineZ} />
          </div>
          <NumberField
            label="Rotation"
            value={lineRotation}
            step={5}
            testId="line-rotation"
            onChange={setLineRotation}
          />
        </div>
      ) : null}

      {mode === "ASSET" ? (
        <div className="space-y-1.5" data-testid="wizard-asset">
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">Asset</span>
            <select
              value={assetId}
              data-testid="wizard-asset-select"
              onChange={(event) => setAssetId(event.target.value)}
              className="studio-input w-40 font-mono"
            >
              <option value="">Choose…</option>
              {project.formations.map((formation) => (
                <option key={formation.id} value={formation.id}>
                  {formation.name} ({formation.points.length})
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Drones"
            value={assetDrones}
            step={1}
            testId="wizard-drones"
            onChange={setAssetDrones}
          />
        </div>
      ) : null}

      {mode !== null && mode !== "AI" ? (
        <div className="space-y-1.5 border-t border-border pt-1.5">
          <p
            className="font-mono text-[10px] text-muted-foreground"
            data-testid="wizard-allocation"
          >
            fleet {allocation.fleet} · used {allocation.used} · reserve {allocation.reserve} ·
            requested {allocation.requested}
          </p>
          {allocation.message ? (
            <p
              className="font-mono text-[10px] text-destructive"
              data-testid="wizard-allocation-warning"
            >
              {allocation.message}
            </p>
          ) : null}
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">Name</span>
            <input
              value={name}
              data-testid="wizard-name"
              placeholder="optional"
              onChange={(event) => setName(event.target.value)}
              className="studio-input w-36 font-mono"
            />
          </label>
          <ColourField value={colour} onChange={setColour} testId="wizard-color" />
          {mode !== "ASSET" ? (
            <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="uppercase tracking-[0.14em]">Mirror</span>
              <input
                type="checkbox"
                checked={mirror}
                data-testid="wizard-mirror"
                onChange={(event) => setMirror(event.target.checked)}
              />
            </label>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              data-testid={mode === "LINE" ? "composer-add-line-commit" : "wizard-commit"}
              disabled={!ready}
              onClick={commit}
              className="chip-btn mini-btn-accent flex-1 justify-center disabled:opacity-40"
            >
              Add to scene
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(null);
                setFileError(null);
                cancelSvgDraft();
              }}
              className="chip-btn justify-center"
            >
              Back
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
