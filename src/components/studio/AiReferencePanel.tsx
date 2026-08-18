/**
 * AI VISUAL CREATOR — presentation only (Sprint 8C).
 *
 * The panel collects a prompt, a drone count and a visual style, asks the
 * provider in src/lib/ai/visual for a REFERENCE IMAGE, and hands the raster to
 * the existing 8B1 analysis via the parent panel. It contains no provider
 * protocol, no geometry, no timeline access and no compiler logic.
 */
import { Ban, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { useRef, useState } from "react";

import { useI18n } from "@/i18n";
import {
  VISUAL_REFERENCE_STYLES,
  VisualReferenceError,
  gatewayVisualReferenceProvider,
  type VisualReferenceProvider,
  type VisualReferenceResult,
  type VisualReferenceStyle,
} from "@/lib/ai/visual";

export interface AiReferenceMeta {
  readonly prompt: string;
  readonly instruction?: string;
  readonly style: VisualReferenceStyle;
  readonly enrichedPrompt: string;
  readonly model: string;
  readonly providerId: string;
  readonly usedContext: boolean;
}

/** base64 -> File so the AI raster goes through the exact same decode path. */
export function fileFromBase64(base64: string, mimeType: string, name: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mimeType });
}

export default function AiReferencePanel({
  droneCount,
  onReference,
  provider = gatewayVisualReferenceProvider,
}: {
  droneCount: number;
  onReference: (file: File, meta: AiReferenceMeta) => void | Promise<void>;
  provider?: VisualReferenceProvider;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [style, setStyle] = useState<VisualReferenceStyle>("REALISTIC_STRUCTURAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<VisualReferenceResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async (mode: "GENERATE" | "REFINE" | "RETRY") => {
    const text = prompt.trim();
    if (text.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const useContext = mode === "REFINE" && last !== null;
      const result = await provider.generate({
        prompt: text,
        droneCount,
        style,
        ...(mode === "REFINE" && instruction.trim().length > 0
          ? { instruction: instruction.trim() }
          : {}),
        ...(useContext
          ? { context: { imageBase64: last!.imageBase64, mimeType: last!.mimeType } }
          : {}),
        signal: controller.signal,
      });
      setLast(result);
      await onReference(
        fileFromBase64(result.imageBase64, result.mimeType, `ai-reference-${Date.now()}.png`),
        {
          prompt: text,
          ...(mode === "REFINE" && instruction.trim().length > 0
            ? { instruction: instruction.trim() }
            : {}),
          style,
          enrichedPrompt: result.enrichedPrompt,
          model: result.model,
          providerId: result.providerId,
          usedContext: result.usedContext,
        },
      );
    } catch (err) {
      if (err instanceof VisualReferenceError) {
        setError(
          err.code === "CANCELLED"
            ? t("ai.visual.cancelled")
            : `${err.code}: ${err.message.slice(0, 240)}`,
        );
      } else {
        setError(String(err));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="space-y-1.5 rounded border border-border/70 p-2">
      <p className="panel-title">
        <Sparkles className="size-3.5" /> {t("ai.visual.title")}
      </p>
      <p className="text-[11px] text-muted-foreground">{t("ai.visual.intro")}</p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t("ai.visual.promptPlaceholder")}
        rows={2}
        className="studio-input resize-none"
        aria-label={t("ai.visual.title")}
      />

      <label className="space-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {t("ai.visual.style")}
        </span>
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value as VisualReferenceStyle)}
          className="studio-input w-full"
        >
          {VISUAL_REFERENCE_STYLES.map((s) => (
            <option key={s} value={s}>
              {t(`ai.visual.style.${s}` as "ai.visual.style.SILHOUETTE")}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="chip-btn"
          disabled={busy || prompt.trim().length === 0}
          onClick={() => void run("GENERATE")}
        >
          <Wand2 className="size-3" /> {busy ? t("ai.visual.busy") : t("ai.visual.generate")}
        </button>
        {last && (
          <button
            type="button"
            className="chip-btn"
            disabled={busy}
            onClick={() => void run("RETRY")}
          >
            <RotateCcw className="size-3" /> {t("ai.visual.retry")}
          </button>
        )}
        {busy && (
          <button
            type="button"
            className="chip-btn"
            onClick={() => abortRef.current?.abort()}
          >
            <Ban className="size-3" /> {t("ai.visual.cancel")}
          </button>
        )}
      </div>

      <div className="flex gap-1.5">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t("ai.visual.refinePlaceholder")}
          className="studio-input flex-1"
          aria-label={t("ai.visual.refine")}
        />
        <button
          type="button"
          className="chip-btn"
          disabled={busy || !last || instruction.trim().length === 0}
          onClick={() => void run("REFINE")}
        >
          {t("ai.visual.refine")}
        </button>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}
      {last && !error && (
        <p className="font-mono text-[10px] text-muted-foreground">
          {t("ai.visual.meta", {
            model: last.model,
            context: last.usedContext ? "edit" : "new",
          })}
        </p>
      )}
    </div>
  );
}
