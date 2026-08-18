/**
 * REFERENCE IMAGE PANEL — presentation only (Sprint 8B1 / 8B2).
 *
 * Three-stage diagnostic surface: REFERENCE (the image), STRUCTURE (exactly what
 * the analysis decided to preserve, now editable) and DRONES (the exact-N
 * compiler result).
 *
 * The panel owns NO geometry logic: analysis lives in src/lib/visual/image,
 * structure edits are pure commands in src/lib/visual/editor and point
 * generation stays with the deterministic Drone Art Compiler. Saving an asset
 * never touches the show timeline.
 */
import { Image as ImageIcon, Save, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { useLibrary } from "@/lib/library/provider";
import { useStudio } from "@/lib/studio/store";
import {
  analyzeImage,
  compileVisualFormation,
  decodeImageFile,
  designFromAnalysis,
  designToAnalysis,
  formationFromCompiled,
  assetSourceForDesign,
  hitTestDesign,
  ImageAnalysisError,
  letterbox,
  screenToDesign,
  toleranceInDesignUnits,
  useStructureEditor,
  type DesignPoint,
  type ImageAnalysisResult,
  type ImageBackgroundMode,
  type ImageDetailLevel,
  type ImageStructureMode,
  type RgbaImage,
  type StructureEditorState,
  type VisualFormationDesign,
} from "@/lib/visual";
import StructureEditorToolbar from "./StructureEditorToolbar";
import StructureInspector from "./StructureInspector";
import StructureList from "./StructureList";

type Stage = "REFERENCE" | "STRUCTURE" | "DRONES";

const STAGES: Stage[] = ["REFERENCE", "STRUCTURE", "DRONES"];
const DETAILS: ImageDetailLevel[] = ["LOW", "MEDIUM", "HIGH"];
const STRUCTURES: ImageStructureMode[] = ["OUTLINE", "STRUCTURAL", "FILLED"];
const BACKGROUNDS: ImageBackgroundMode[] = ["AUTO", "LIGHT", "DARK"];

const W = 268;
const H = 200;
/** Selection tolerance in canvas pixels. */
const HIT_PIXELS = 6;

/**
 * Draws the EDITED design (not the raw analysis) so every structure edit is
 * visible immediately, and hosts selection + polyline drawing.
 */
function StructureCanvas({
  design,
  analysisWidth,
  analysisHeight,
  editor,
}: {
  design: VisualFormationDesign;
  analysisWidth: number;
  analysisHeight: number;
  editor: StructureEditorState;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const transform = useMemo(
    () => letterbox(W, H, analysisWidth, analysisHeight),
    [analysisHeight, analysisWidth],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, W, H);

    const toCanvas = (p: DesignPoint): readonly [number, number] => {
      const [ax, ay] = designToAnalysis(analysisWidth, analysisHeight, p);
      return [transform.offsetX + ax * transform.scale, transform.offsetY + ay * transform.scale];
    };
    const path = (points: readonly DesignPoint[], closed: boolean) => {
      ctx.beginPath();
      points.forEach((p, i) => {
        const [x, y] = toCanvas(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (closed) ctx.closePath();
    };

    for (const primitive of design.primitives) {
      const enabled = primitive.enabled !== false;
      const selected = primitive.id === editor.selectedId;
      ctx.setLineDash(enabled ? [] : [3, 3]);
      ctx.lineWidth = selected ? 2.4 : primitive.essential ? 1.6 : 1;
      ctx.strokeStyle = selected
        ? "rgb(255,214,120)"
        : enabled
          ? "rgb(140,220,255)"
          : "rgba(140,220,255,0.28)";
      switch (primitive.type) {
        case "REGION": {
          if (enabled) {
            ctx.fillStyle = selected ? "rgba(255,214,120,0.18)" : "rgba(120,200,255,0.18)";
            path(primitive.outline, true);
            ctx.fill();
            for (const hole of primitive.holes ?? []) {
              ctx.save();
              ctx.globalCompositeOperation = "destination-out";
              path(hole, true);
              ctx.fill();
              ctx.restore();
            }
          }
          path(primitive.outline, true);
          ctx.stroke();
          break;
        }
        case "CLOSED_CONTOUR":
          path(primitive.path, true);
          ctx.stroke();
          break;
        case "POLYLINE":
          path(primitive.path, false);
          ctx.stroke();
          break;
        case "POINT_FEATURE": {
          const [x, y] = toCanvas(primitive.position);
          ctx.beginPath();
          ctx.arc(x, y, selected ? 4 : 2.5, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        default:
          break;
      }
    }

    // In-progress polyline (editor-only state, never part of the design yet).
    if (editor.drawing.length > 0) {
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = "rgb(255,140,180)";
      ctx.lineWidth = 1.4;
      path(editor.drawing, false);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgb(255,140,180)";
      for (const p of editor.drawing) {
        const [x, y] = toCanvas(p);
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.setLineDash([]);
  }, [analysisHeight, analysisWidth, design, editor.drawing, editor.selectedId, transform]);

  const pointFromEvent = (event: React.MouseEvent<HTMLCanvasElement>): DesignPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return screenToDesign(rect, transform, event.clientX, event.clientY);
  };

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      tabIndex={0}
      className="w-full rounded border border-border/70 bg-background outline-none"
      role="img"
      aria-label="Extracted structure preview"
      onClick={(event) => {
        const point = pointFromEvent(event);
        if (editor.tool === "DRAW") {
          editor.addDrawPoint(point);
          return;
        }
        editor.select(
          hitTestDesign(design, point, toleranceInDesignUnits(transform, HIT_PIXELS)),
        );
      }}
      onDoubleClick={() => {
        if (editor.tool === "DRAW") editor.commitDrawing();
      }}
      onKeyDown={(event) => {
        if (editor.tool !== "DRAW") return;
        if (event.key === "Enter") {
          event.preventDefault();
          editor.commitDrawing();
        } else if (event.key === "Escape") {
          event.preventDefault();
          editor.cancelDrawing();
        }
      }}
    />
  );
}

function PointsCanvas({
  points,
}: {
  points: readonly (readonly [number, number, number])[];
}) {
  const draw = (canvas: HTMLCanvasElement | null) => {
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (points.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const scale = (Math.min(W, H) - 18) / span;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    ctx.fillStyle = "rgb(235,245,255)";
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(W / 2 + (p[0] - cx) * scale, H / 2 - (p[1] - cy) * scale, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  return (
    <canvas
      ref={draw}
      width={W}
      height={H}
      className="w-full rounded border border-border/70 bg-background"
      role="img"
      aria-label="Compiled drone preview"
    />
  );
}

export default function ImageDesignPanel() {
  const { t } = useI18n();
  const { project } = useStudio();
  const library = useLibrary();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<Stage>("REFERENCE");
  const [source, setSource] = useState<{
    image: RgbaImage;
    previewUrl: string;
    name: string;
    sourceWidth: number;
    sourceHeight: number;
    decodeMs: number;
  } | null>(null);
  const [detail, setDetail] = useState<ImageDetailLevel>("MEDIUM");
  const [structure, setStructure] = useState<ImageStructureMode>("STRUCTURAL");
  const [background, setBackground] = useState<ImageBackgroundMode>("AUTO");
  const [simplify, setSimplify] = useState(1);
  const [count, setCount] = useState(project.droneCount);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Revoke the object URL when the reference image changes or the panel unmounts.
  useEffect(() => {
    const url = source?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [source?.previewUrl]);

  // Analysis is pure library work and never sets state during render: failures
  // are returned as data so the panel can show them next to the STRUCTURE stage.
  const analysed = useMemo((): {
    result: ImageAnalysisResult | null;
    errorCode: string | null;
  } => {
    if (!source) return { result: null, errorCode: null };
    try {
      return {
        result: analyzeImage(source.image, {
          detail,
          structure,
          background,
          simplify,
          sourceName: source.name,
        }),
        errorCode: null,
      };
    } catch (err) {
      return {
        result: null,
        errorCode: err instanceof ImageAnalysisError ? err.code : "DECODE_FAILED",
      };
    }
  }, [background, detail, simplify, source, structure]);

  const analysis = analysed.result;
  const analysisError = analysed.errorCode
    ? t(`image.error.${analysed.errorCode}` as "image.error.DECODE_FAILED")
    : null;

  const extracted = useMemo(
    () => (analysis ? designFromAnalysis(analysis, { sourceName: source?.name }) : null),
    [analysis, source?.name],
  );

  // The structure editor owns the editable draft; the extraction stays intact.
  const editor = useStructureEditor(extracted);
  const design = editor?.draft ?? null;

  const compiled = useMemo(() => {
    if (!design) return null;
    const t0 = performance.now();
    try {
      const result = compileVisualFormation(design, Math.max(1, Math.floor(count)), {
        width: 120,
        altitude: 60,
      });
      return { result, compileMs: Number((performance.now() - t0).toFixed(2)) };
    } catch {
      return null;
    }
  }, [count, design]);


  const pick = async (file: File | undefined) => {
    if (!file) return;
    setSaved(null);
    try {
      const decoded = await decodeImageFile(file);
      setSource({
        image: decoded.image,
        previewUrl: decoded.previewUrl,
        name: file.name,
        sourceWidth: decoded.sourceWidth,
        sourceHeight: decoded.sourceHeight,
        decodeMs: decoded.decodeMs,
      });
      setStage("STRUCTURE");
      setError(null);
    } catch (err) {
      setError(
        err instanceof ImageAnalysisError
          ? t(`image.error.${err.code}` as "image.error.DECODE_FAILED")
          : String(err),
      );
    }
  };

  const save = async () => {
    if (!compiled || !design) return;
    const name = `${design.name} ${compiled.result.points.length}`;
    const formation = formationFromCompiled(compiled.result, {
      id: `vf-img-${design.id}-${Date.now().toString(36)}`,
      name,
    });
    const edited = editor?.edited ?? false;
    const asset = await library.saveFormation(formation, {
      name,
      // Provenance follows the DESIGN, never the button that saved it. Manual
      // structure edits do NOT downgrade an imported asset to USER.
      source: assetSourceForDesign(design),
      // Identity of the origin only — no pixels, no base64, no ImageData.
      sourceRef: {
        kind: "IMAGE",
        name: source?.name,
        fingerprint: analysis?.fingerprint,
        params: {
          detail,
          structure,
          background,
          simplify,
          edited,
          editOps: editor?.editOps ?? 0,
          designVersion: design.version,
        },
      },
      tags: edited
        ? ["image", `detail:${detail}`, `structure:${structure}`, "edited"]
        : ["image", `detail:${detail}`, `structure:${structure}`],
    });
    setSaved(asset ? asset.name : null);
  };

  const diag = analysis?.diagnostics;

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <ImageIcon className="size-3.5" /> {t("image.title")}
      </h2>
      <p className="text-[11px] text-muted-foreground">{t("image.intro")}</p>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.currentTarget.value = "";
        }}
      />

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="chip-btn" onClick={() => fileRef.current?.click()}>
          <Upload className="size-3" /> {source ? t("image.replace") : t("image.pick")}
        </button>
        {source && (
          <button
            type="button"
            className="chip-btn"
            onClick={() => {
              setSource(null);
              setStage("REFERENCE");
              setSaved(null);
              setError(null);
            }}
          >
            <X className="size-3" /> {t("image.clear")}
          </button>
        )}
      </div>

      {(error ?? analysisError) && (
        <p className="text-[11px] text-destructive">{error ?? analysisError}</p>
      )}

      {source && (
        <>
          <div className="flex gap-1">
            {STAGES.map((s) => (
              <button
                key={s}
                type="button"
                className="chip-btn flex-1 justify-center"
                aria-pressed={stage === s}
                data-active={stage === s ? "true" : undefined}
                onClick={() => setStage(s)}
              >
                {t(`image.stage.${s}` as "image.stage.REFERENCE")}
              </button>
            ))}
          </div>

          {stage === "REFERENCE" && (
            <img
              src={source.previewUrl}
              alt={source.name}
              className="w-full rounded border border-border/70 bg-background object-contain"
              style={{ height: H }}
            />
          )}
          {stage === "STRUCTURE" && analysis && design && editor && (
            <div className="space-y-1.5">
              <StructureEditorToolbar editor={editor} />
              <StructureCanvas
                design={design}
                analysisWidth={analysis.diagnostics.analysisWidth}
                analysisHeight={analysis.diagnostics.analysisHeight}
                editor={editor}
              />
              <p className="text-[10px] text-muted-foreground">
                {editor.tool === "DRAW" ? t("image.editor.drawHint") : t("image.editor.intro")}
              </p>
              {editor.edited && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {t("image.editor.editedBadge", { ops: editor.editOps })}
                </p>
              )}
              <StructureInspector editor={editor} />
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("image.editor.list")}
              </div>
              <StructureList editor={editor} />
              <p className="text-[10px] text-muted-foreground">
                {t("image.editor.resetOnControls")}
              </p>
            </div>
          )}
          {stage === "DRONES" && compiled && <PointsCanvas points={compiled.result.points} />}

          <div className="grid grid-cols-2 gap-1.5">
            <label className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("image.detail")}
              </span>
              <select
                value={detail}
                onChange={(e) => setDetail(e.target.value as ImageDetailLevel)}
                className="studio-input w-full"
              >
                {DETAILS.map((d) => (
                  <option key={d} value={d}>
                    {t(`image.detail.${d}` as "image.detail.LOW")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("image.structure")}
              </span>
              <select
                value={structure}
                onChange={(e) => setStructure(e.target.value as ImageStructureMode)}
                className="studio-input w-full"
              >
                {STRUCTURES.map((s) => (
                  <option key={s} value={s}>
                    {t(`image.structure.${s}` as "image.structure.OUTLINE")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("image.background")}
              </span>
              <select
                value={background}
                onChange={(e) => setBackground(e.target.value as ImageBackgroundMode)}
                className="studio-input w-full"
              >
                {BACKGROUNDS.map((b) => (
                  <option key={b} value={b}>
                    {t(`image.background.${b}` as "image.background.AUTO")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("image.droneCount")}
              </span>
              <input
                type="number"
                min={1}
                max={2000}
                step={1}
                value={count}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setCount(Math.min(2000, Math.max(1, Math.round(n))));
                }}
                className="studio-input w-full font-mono text-[11px]"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("image.simplify")} {simplify.toFixed(2)}×
            </span>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.05}
              value={simplify}
              onChange={(e) => setSimplify(Number(e.target.value))}
              className="w-full"
            />
          </label>

          {diag && (
            <div className="space-y-0.5 rounded border border-border/60 bg-muted/20 p-1.5 font-mono text-[10px] text-muted-foreground">
              <div className="uppercase tracking-[0.14em]">{t("image.diagnostics")}</div>
              <div>
                {t("image.diag.components", {
                  kept: diag.componentsKept,
                  found: diag.componentsFound,
                  dropped: diag.componentsDropped,
                })}
              </div>
              <div>{t("image.diag.holes", { kept: diag.holesKept, found: diag.holesFound })}</div>
              <div>
                {t("image.diag.contour", {
                  raw: diag.rawContourPoints,
                  simplified: diag.simplifiedContourPoints,
                })}
              </div>
              <div>
                {t("image.diag.analysis", {
                  width: diag.analysisWidth,
                  height: diag.analysisHeight,
                  polarity: diag.polarity,
                })}
              </div>
              <div>
                {t("image.diag.timing", {
                  decode: source.decodeMs,
                  analysis: diag.analysisMs ?? 0,
                  compile: compiled?.compileMs ?? 0,
                })}
              </div>
              {compiled && (
                <div>
                  points {compiled.result.points.length} · primitives{" "}
                  {compiled.result.report.primitivesUsed}/{compiled.result.report.primitivesTotal} ·
                  fleet {project.droneCount}
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">{t("image.noSemantics")}</p>

          <button
            type="button"
            className="chip-btn"
            disabled={!compiled || library.busy}
            onClick={() => void save()}
          >
            <Save className="size-3" /> {t("image.saveToLibrary")}
          </button>
          {saved && <p className="text-[10px] text-muted-foreground">{t("image.savedHint")}</p>}
        </>
      )}
    </section>
  );
}
