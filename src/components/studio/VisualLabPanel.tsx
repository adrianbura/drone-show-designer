/**
 * VISUAL FORMATION LAB — presentation only.
 *
 * The panel compiles a built-in `VisualFormationDesign` to EXACTLY the requested
 * formation drone count through the deterministic Drone Art Compiler, previews
 * it, and saves it to the Formation Library.
 *
 * PRODUCT DECISION: saving an asset NEVER touches the show timeline. The user
 * places the asset on the timeline themselves, chooses transition / hold and
 * synchronises it with the music manually.
 */
import { Bug, Download, Palette, RefreshCw, Save, Wand2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { useLibrary } from "@/lib/library/provider";
import { useStudio } from "@/lib/studio/store";
import {
  BUILT_IN_DESIGNS,
  animatableParts,
  compileVisualFormation,
  dynamicFromCompiled,
  formationFromCompiled,
  type VisualStyle,
} from "@/lib/visual";

const STYLES: VisualStyle[] = ["OUTLINE", "STRUCTURAL", "BALANCED", "FILLED"];

/** Top-down XY preview of the compiled artwork. Pure canvas, no per-point state. */
function Preview({
  points,
  colors,
  debug,
  sources,
}: {
  points: readonly (readonly [number, number, number])[];
  colors: readonly (readonly [number, number, number])[];
  debug: boolean;
  sources: readonly { readonly part?: string | undefined }[];
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const W = 268;
  const H = 200;

  const draw = (canvas: HTMLCanvasElement | null) => {
    ref.current = canvas;
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
    const partHue = new Map<string, number>();
    points.forEach((p, i) => {
      const x = W / 2 + (p[0] - cx) * scale;
      const y = H / 2 - (p[1] - cy) * scale;
      let fill: string;
      if (debug) {
        const part = sources[i]?.part ?? "UNASSIGNED";
        if (!partHue.has(part)) partHue.set(part, (partHue.size * 47) % 360);
        fill = `hsl(${partHue.get(part)!} 85% 62%)`;
      } else {
        const c = colors[i] ?? [255, 255, 255];
        fill = `rgb(${c[0]} ${c[1]} ${c[2]})`;
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  return (
    <canvas
      ref={draw}
      width={W}
      height={H}
      className="w-full rounded border border-border/70 bg-background"
      role="img"
      aria-label="Compiled formation preview"
    />
  );
}

export default function VisualLabPanel() {
  const { t } = useI18n();
  const { project } = useStudio();
  const library = useLibrary();

  const [designId, setDesignId] = useState(BUILT_IN_DESIGNS[0]!.id);
  // Default to the project fleet: a bigger asset than the fleet cannot be used
  // in the show at all, which made "Use in show" silently unavailable.
  const [count, setCount] = useState(project.droneCount);
  const [countTouched, setCountTouched] = useState(false);
  const [style, setStyle] = useState<VisualStyle>("STRUCTURAL");
  const [width, setWidth] = useState(120);
  const [altitude, setAltitude] = useState(60);
  const [debug, setDebug] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Follow the fleet until the user overrides the count themselves.
  useEffect(() => {
    if (!countTouched) setCount(project.droneCount);
  }, [countTouched, project.droneCount]);

  const design = useMemo(
    () => BUILT_IN_DESIGNS.find((d) => d.id === designId) ?? BUILT_IN_DESIGNS[0]!,
    [designId],
  );

  // Compilation is pure library work; React only consumes the result.
  const compiled = useMemo(() => {
    void nonce;
    try {
      return compileVisualFormation(design, Math.max(1, Math.floor(count)), {
        style,
        width,
        altitude,
      });
    } catch {
      return null;
    }
  }, [altitude, count, design, nonce, style, width]);

  const parts = compiled ? animatableParts(design, compiled) : [];

  const save = async (dynamic: boolean) => {
    if (!compiled) return;
    const name = `${design.name} ${compiled.points.length}`;
    const formation = formationFromCompiled(compiled, {
      id: `vf-${design.id}-${Date.now().toString(36)}`,
      name,
    });
    const asset = dynamic
      ? await library.saveDynamicFormation(
          dynamicFromCompiled(formation, design, compiled, {
            id: `vd-${design.id}-${Date.now().toString(36)}`,
            name: `${name} (dynamic)`,
          }),
          { name: `${name} (dynamic)`, source: "AI_GENERATED", tags: ["visual-design", design.id] },
        )
      : await library.saveFormation(formation, {
          name,
          source: "AI_GENERATED",
          tags: ["visual-design", design.id],
        });
    // The asset is only stored in the library — never added to the timeline.
    setSaved(asset ? asset.name : null);
  };

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <Palette className="size-3.5" /> {t("visualLab.title")}
      </h2>
      <p className="text-[11px] text-muted-foreground">{t("visualLab.intro")}</p>

      <label className="space-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {t("visualLab.design")}
        </span>
        <select
          value={designId}
          onChange={(e) => setDesignId(e.target.value)}
          className="studio-input w-full"
        >
          {BUILT_IN_DESIGNS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        <label className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("visualLab.droneCount")}
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
        <label className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("visualLab.style")}
          </span>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value as VisualStyle)}
            className="studio-input w-full"
          >
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {t(`visualLab.style.${s}` as "visualLab.style.OUTLINE")}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("visualLab.width")}
          </span>
          <input
            type="number"
            min={5}
            max={600}
            step={5}
            value={width}
            onChange={(e) => setWidth(Math.min(600, Math.max(5, Number(e.target.value) || 5)))}
            className="studio-input w-full font-mono text-[11px]"
          />
        </label>
        <label className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("visualLab.altitude")}
          </span>
          <input
            type="number"
            min={2}
            max={500}
            step={5}
            value={altitude}
            onChange={(e) => setAltitude(Math.min(500, Math.max(2, Number(e.target.value) || 2)))}
            className="studio-input w-full font-mono text-[11px]"
          />
        </label>
      </div>

      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>
          {t("visualLab.requested")} {count} · {t("visualLab.generated")}{" "}
          <span className="text-foreground">{compiled?.points.length ?? 0}</span>
        </span>
        <span>{t("visualLab.fleetContext", { fleet: project.droneCount })}</span>
      </div>

      {compiled && (
        <Preview
          points={compiled.points}
          colors={compiled.colors}
          sources={compiled.sources}
          debug={debug}
        />
      )}

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="chip-btn" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw className="size-3" /> {t("visualLab.recompile")}
        </button>
        <button
          type="button"
          className="chip-btn"
          disabled={!compiled || library.busy}
          onClick={() => void save(false)}
        >
          <Save className="size-3" /> {t("visualLab.saveToLibrary")}
        </button>
        {parts.length > 0 && (
          <button
            type="button"
            className="chip-btn"
            disabled={!compiled || library.busy}
            onClick={() => void save(true)}
          >
            <Wand2 className="size-3" /> {t("visualLab.createDynamic")}
          </button>
        )}
        <button type="button" className="chip-btn" onClick={() => setDebug((d) => !d)}>
          <Bug className="size-3" /> {t("visualLab.debug")}
        </button>
      </div>

      {saved && <p className="text-[11px] text-muted-foreground">{t("visualLab.savedHint")}</p>}
      {library.error && (
        <p className="text-[11px] text-destructive">
          {library.error.code}: {library.error.message}
        </p>
      )}

      {compiled && (
        <>
          <button
            type="button"
            className="chip-btn w-full justify-center"
            onClick={() => setAdvanced((a) => !a)}
          >
            <Download className="size-3" /> {t("visualLab.diagnostics")}
          </button>
          {advanced && (
            <div className="space-y-1.5 rounded border border-border/70 p-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("visualLab.semanticParts")}
              </p>
              <ul className="grid grid-cols-2 gap-x-2 font-mono text-[10px] text-muted-foreground">
                {Object.entries(compiled.report.allocationByPart).map(([part, n]) => (
                  <li key={part}>
                    {part} <span className="text-foreground">{n}</span>
                  </li>
                ))}
              </ul>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("visualLab.primitives", {
                  used: compiled.report.primitivesUsed,
                  total: compiled.report.primitivesTotal,
                })}
                {" · "}
                {t("visualLab.dropped", { count: compiled.report.droppedPrimitiveIds.length })}
                {" · "}
                {t("visualLab.spacing", { value: compiled.report.minSpacing.toFixed(2) })}
              </p>
              {compiled.report.issues.length > 0 && (
                <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
                  {compiled.report.issues.map((issue) => (
                    <li key={`${issue.code}-${JSON.stringify(issue.detail)}`}>
                      {t(`visualLab.issue.${issue.code}` as "visualLab.issue.DETAILS_OMITTED", {
                        ...issue.detail,
                      })}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground">{t("visualLab.notSafety")}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
