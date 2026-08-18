/**
 * LIGHTING TRACK — timeline row for the lighting, reveal and colour effects of
 * the selected scene (Sprint 7.4).
 *
 * PRESENTATION ONLY. Effect times are stored relative to an ANCHOR; this row
 * converts anchor-relative time to absolute show time for display, and converts
 * a pointer delta back into an anchor-relative offset on commit. One drag is
 * exactly one undoable store mutation.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { emittedColor } from "@/lib/show/lighting";
import type { LightingAnchor, LightingEffectInstance } from "@/lib/show/lighting";
import { rgbToHex } from "@/lib/show/lights";
import { useStudio } from "@/lib/studio/store";
import type { TimelineClip } from "@/lib/show/types";

/** Absolute show time an anchor resolves to for one clip. */
export function anchorBaseTime(clip: TimelineClip, anchor: LightingAnchor): number {
  switch (anchor) {
    case "SCENE_START":
      return clip.start;
    case "FORMATION_READY":
      return clip.start + clip.transition;
    case "SCENE_END":
      return clip.start + clip.transition + clip.hold;
    case "ABSOLUTE":
    default:
      return 0;
  }
}

const TYPE_TINT: Record<string, string> = {
  FADE_IN: "bg-safe/70",
  FADE_OUT: "bg-muted-foreground/70",
  DIRECTIONAL_REVEAL: "bg-accent/70",
  RADIAL_REVEAL: "bg-accent/50",
  COLOR_TRANSITION: "bg-primary/70",
  COLOR_SWEEP: "bg-primary/50",
  PULSE: "bg-warning/70",
  STROBE: "bg-warning/50",
  GROUP_SEQUENCE: "bg-secondary/70",
};

type Draft = { id: string; kind: "MOVE" | "DURATION"; start: number; duration: number };

export default function LightingTrack({
  viewStart,
  viewEnd,
}: {
  viewStart: number;
  viewEnd: number;
}) {
  const { t } = useI18n();
  const {
    project,
    selectedClipId,
    lightingEffects,
    selectedLightingEffectId,
    selectLightingEffect,
    commitLightingTiming,
    lightingPreview,
  } = useStudio();

  const laneRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: string;
    kind: "MOVE" | "DURATION";
    x: number;
    start: number;
    duration: number;
  } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const clip = useMemo(
    () => project.timeline.find((c) => c.id === selectedClipId) ?? null,
    [project.timeline, selectedClipId],
  );
  const span = Math.max(0.001, viewEnd - viewStart);
  const pct = (v: number) => `${((v - viewStart) / span) * 100}%`;
  const widthPct = (v: number) => `${(v / span) * 100}%`;

  const secondsPerPixel = useCallback(() => {
    const width = laneRef.current?.getBoundingClientRect().width ?? 1;
    return span / Math.max(1, width);
  }, [span]);

  const begin = (effect: LightingEffectInstance, kind: "MOVE" | "DURATION", clientX: number) => {
    gesture.current = {
      id: effect.id,
      kind,
      x: clientX,
      start: effect.start,
      duration: effect.duration,
    };
    setDraft({ id: effect.id, kind, start: effect.start, duration: effect.duration });
    selectLightingEffect(effect.id);
  };

  const move = (clientX: number) => {
    const g = gesture.current;
    if (!g) return;
    const delta = (clientX - g.x) * secondsPerPixel();
    if (g.kind === "MOVE") {
      setDraft({ id: g.id, kind: g.kind, start: g.start + delta, duration: g.duration });
    } else {
      setDraft({
        id: g.id,
        kind: g.kind,
        start: g.start,
        duration: Math.max(0.1, g.duration + delta),
      });
    }
  };

  const end = () => {
    const g = gesture.current;
    const d = draft;
    gesture.current = null;
    setDraft(null);
    if (!g || !d) return;
    if (d.start === g.start && d.duration === g.duration) return;
    commitLightingTiming(g.id, { start: d.start, duration: d.duration });
  };

  const cancel = () => {
    gesture.current = null;
    setDraft(null);
  };

  if (!clip) return null;

  return (
    <div className="mt-1">
      <div className="mb-0.5 flex items-center justify-between px-1">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {t("lighting.track")}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {lightingPreview ? t("lighting.previewOn") : t("lighting.previewOff")}
        </span>
      </div>
      <div
        ref={laneRef}
        className="relative h-7 overflow-hidden rounded border border-border bg-panel-2"
        onPointerMove={(e) => move(e.clientX)}
        onPointerUp={end}
        onPointerLeave={cancel}
      >
        {lightingEffects.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
            {t("lighting.trackEmpty")}
          </p>
        )}
        {lightingEffects.map((effect) => {
          const live = draft && draft.id === effect.id ? draft : null;
          const relStart = live ? live.start : effect.start;
          const duration = Math.max(0.1, live ? live.duration : effect.duration);
          const absolute = anchorBaseTime(clip, effect.anchor) + relStart;
          const selected = selectedLightingEffectId === effect.id;
          const color = effect.parameters.color ?? effect.parameters.toColor;
          return (
            <div
              key={effect.id}
              role="button"
              tabIndex={0}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                begin(effect, "MOVE", e.clientX);
              }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const step = e.shiftKey ? 1 : 0.1;
                commitLightingTiming(effect.id, {
                  start: effect.start + (e.key === "ArrowLeft" ? -step : step),
                });
              }}
              title={`${effect.type} · ${absolute.toFixed(2)}s · ${duration.toFixed(2)}s`}
              className={`absolute inset-y-0.5 cursor-grab touch-none rounded border text-[10px] ${
                TYPE_TINT[effect.type] ?? "bg-muted"
              } ${selected ? "border-accent" : "border-border"} ${effect.enabled ? "" : "opacity-40"}`}
              style={{ left: pct(absolute), width: widthPct(duration), minWidth: 8 }}
            >
              <span className="pointer-events-none absolute inset-0 flex items-center gap-1 truncate px-1 text-foreground">
                {color ? (
                  <span
                    className="size-2 shrink-0 rounded-full border border-border"
                    style={{ background: rgbToHex(color) }}
                  />
                ) : null}
                <span className="truncate">{t(`lighting.type.${effect.type}` as "lighting.type.FADE_IN")}</span>
              </span>
              <span
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  begin(effect, "DURATION", e.clientX);
                }}
                title={t("lighting.resize")}
                className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none bg-accent/0 hover:bg-accent/50"
              />
            </div>
          );
        })}
      </div>
      {/* Live read-out mirrors the LED colour of drone 0 for a sanity check. */}
      {draft ? (
        <p className="px-1 pt-0.5 font-mono text-[10px] text-accent">
          {draft.start.toFixed(2)}s · {draft.duration.toFixed(2)}s
        </p>
      ) : null}
    </div>
  );
}

/** Exposed for tests: LED colour of a state, gamma-free and clamped. */
export const ledHex = (state: Parameters<typeof emittedColor>[0]) => rgbToHex(emittedColor(state));
