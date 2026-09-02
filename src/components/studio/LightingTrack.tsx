/**
 * LIGHTING TRACK — timeline lane for the authored lighting effects of the
 * selected scene.
 *
 * PRESENTATION ONLY.
 *   - Geometry and gesture math come from `src/lib/studio/lightingTimeline.ts`
 *     (pure), which resolves timing through the CANONICAL anchor authority and
 *     reuses the existing snap engine. No second timeline view model.
 *   - Every mutation goes through the canonical store action
 *     `commitLightingTiming`; one pointer gesture commits exactly once, so one
 *     drag is one undo/redo entry.
 *   - No LED colour is ever evaluated here: swatches show authored PARAMETERS,
 *     the viewport stays the source of truth for actual drone colour.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { emittedColor } from "@/lib/show/lighting";
import type { LightingAnchor } from "@/lib/show/lighting";
import { rgbToHex } from "@/lib/show/lights";
import { effectPresetLabel } from "@/lib/studio/selectionEffects";

import { markerTimes } from "@/lib/show/markers";
import { useStudio } from "@/lib/studio/store";
import type { TimelineClip } from "@/lib/show/types";
import {
  dragEffectStart,
  hiddenLaneCount,
  laneScrollTop,
  layoutLightingEffects,
  lightingGuideTimes,
  resizeEffectDuration,
  resizeEffectStart,
  type EffectColorPresentation,
  type EffectSnapContext,
  type LightingBlock,
} from "@/lib/studio/lightingTimeline";
import { pixelsPerSecond } from "@/lib/studio/timelineEdit";

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
  RADIAL_HIDE: "bg-accent/40",
  COLOR_TRANSITION: "bg-primary/70",
  COLOR_SWEEP: "bg-primary/50",
  PULSE: "bg-warning/70",
  STROBE: "bg-warning/50",
  GROUP_SEQUENCE: "bg-secondary/70",
};

const LANE_HEIGHT = 22;
const MAX_VISIBLE_LANES = 3;

type GestureKind = "MOVE" | "DURATION" | "START";

/** Authored colour parameters as inert swatch markup. */
function ColorSwatch({ color }: { color: EffectColorPresentation }) {
  if (color.kind === "NONE") return null;
  if (color.kind === "SOLID") {
    return (
      <span
        className="size-2 shrink-0 rounded-full border border-border"
        style={{ background: rgbToHex(color.colors[0]!) }}
      />
    );
  }
  if (color.kind === "TRANSITION") {
    return (
      <span className="flex shrink-0 items-center gap-[1px]">
        <span
          className="size-2 rounded-full border border-border"
          style={{ background: rgbToHex(color.colors[0]!) }}
        />
        <span className="text-[8px] text-foreground">→</span>
        <span
          className="size-2 rounded-full border border-border"
          style={{ background: rgbToHex(color.colors[1]!) }}
        />
      </span>
    );
  }
  const stops = color.colors
    .map(
      (c, i) =>
        `${rgbToHex(c)} ${((color.positions[i] ?? i / Math.max(1, color.colors.length - 1)) * 100).toFixed(0)}%`,
    )
    .join(", ");
  return (
    <span
      className="h-2 w-6 shrink-0 rounded-sm border border-border"
      style={{ background: `linear-gradient(90deg, ${stops})` }}
    />
  );
}

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
    selectedScene,
    lightingEffects,
    selectedLightingEffectId,
    selectLightingEffect,
    commitLightingTiming,
    lightingPreview,
    referenceOwnedNow,
    snapMode,
    beatGrid,
    markers,
    time,
  } = useStudio();

  const laneRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: string;
    kind: GestureKind;
    x: number;
    anchorBase: number;
  } | null>(null);
  const [draft, setDraft] = useState<{
    id: string;
    kind: GestureKind;
    start: number;
    duration: number;
    snapped: boolean;
  } | null>(null);

  const clip = useMemo(
    () => project.timeline.find((c) => c.id === selectedClipId) ?? null,
    [project.timeline, selectedClipId],
  );
  const view = useMemo(() => ({ start: viewStart, end: viewEnd }), [viewStart, viewEnd]);
  const objects = selectedScene?.objects ?? [];
  const [trackWidth, setTrackWidth] = useState(1);

  const measure = useCallback((node: HTMLDivElement | null) => {
    laneRef.current = node;
    if (node) setTrackWidth(node.getBoundingClientRect().width || 1);
  }, []);

  const layout = useMemo(
    () =>
      layoutLightingEffects({
        effects: lightingEffects,
        clip,
        view,
        trackWidthPx: trackWidth,
        objects,
        time,
        draft: draft ? { id: draft.id, start: draft.start, duration: draft.duration } : null,
      }),
    [lightingEffects, clip, view, trackWidth, objects, time, draft],
  );

  /**
   * VERTICAL ACCESSIBILITY — when a lighting effect becomes selected (from the
   * panel OR from the timeline) its lane is scrolled into the visible lane
   * window and the whole lane is scrolled into the timeline body. Only vertical
   * offsets change: never the timeline time or zoom.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedLightingEffectId) return;
    const block = layout.blocks.find((b) => b.id === selectedLightingEffectId);
    if (!block) return;
    rootRef.current?.scrollIntoView({ block: "nearest" });
    const lane = laneRef.current;
    if (!lane) return;
    lane.scrollTop = laneScrollTop({
      laneIndex: block.lane,
      laneHeight: LANE_HEIGHT,
      scrollTop: lane.scrollTop,
      viewportHeight: lane.clientHeight,
      padding: 4,
    });
    // Layout identity changes every frame during a gesture; only react to the
    // selected id so a drag never fights the operator's own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLightingEffectId]);

  const snapContext = useCallback(
    (altKey: boolean): EffectSnapContext => ({
      mode: snapMode,
      pixelsPerSecond: pixelsPerSecond(Math.max(1, trackWidth), view),
      guides: clip ? lightingGuideTimes(clip, time) : [],
      beatGrid,
      markers: markerTimes(markers),
      disabled: altKey,
    }),
    [snapMode, trackWidth, view, clip, time, beatGrid, markers],
  );

  const secondsPerPixel = useCallback(() => {
    const width = laneRef.current?.getBoundingClientRect().width ?? trackWidth;
    return Math.max(0.001, view.end - view.start) / Math.max(1, width);
  }, [view, trackWidth]);

  const begin = (block: LightingBlock, kind: GestureKind, clientX: number, altKey: boolean) => {
    if (!clip) return;
    const anchorBase = anchorBaseTime(clip, block.effect.anchor);
    gesture.current = { id: block.id, kind, x: clientX, anchorBase };
    setDraft({
      id: block.id,
      kind,
      start: block.effect.start,
      duration: block.effect.duration,
      snapped: false,
    });
    selectLightingEffect(block.id);
    void altKey;
  };

  const move = (clientX: number, altKey: boolean) => {
    const g = gesture.current;
    if (!g) return;
    const effect = lightingEffects.find((e) => e.id === g.id);
    if (!effect) return;
    const delta = (clientX - g.x) * secondsPerPixel();
    const ctx = snapContext(altKey);
    const next =
      g.kind === "MOVE"
        ? dragEffectStart(effect, g.anchorBase, delta, ctx)
        : g.kind === "DURATION"
          ? resizeEffectDuration(effect, g.anchorBase, delta, ctx)
          : resizeEffectStart(effect, g.anchorBase, delta, ctx);
    setDraft({
      id: g.id,
      kind: g.kind,
      start: next.start,
      duration: next.duration,
      snapped: next.snap.snapped,
    });
  };

  const end = () => {
    const g = gesture.current;
    const d = draft;
    gesture.current = null;
    setDraft(null);
    if (!g || !d) return;
    const effect = lightingEffects.find((e) => e.id === g.id);
    if (!effect) return;
    if (d.start === effect.start && d.duration === effect.duration) return;
    // ONE gesture = ONE canonical store revision = ONE undo entry.
    commitLightingTiming(g.id, { start: d.start, duration: d.duration });
  };

  const cancel = () => {
    gesture.current = null;
    setDraft(null);
  };

  if (!clip) return null;

  const visibleLanes = Math.min(Math.max(1, layout.laneCount), MAX_VISIBLE_LANES);
  const hidden = hiddenLaneCount(layout.laneCount, visibleLanes);

  return (
    <div ref={rootRef} className="mt-1 shrink-0">
      <div className="mb-0.5 flex items-center justify-between px-1">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {t("lighting.track")}
          {layout.blocks.length > 0 ? ` · ${layout.blocks.length}` : ""}
        </span>
        <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {hidden > 0 ? (
            <span
              data-testid="lighting-hidden-lanes"
              className="rounded border border-border bg-panel px-1 font-mono text-[9px] text-muted-foreground"
              title={t("lighting.moreLanes")}
            >
              ↓ {hidden}
            </span>
          ) : null}
          {referenceOwnedNow ? (
            <span
              data-testid="reference-led-badge"
              className="rounded border border-border bg-panel px-1 font-mono text-[9px] text-warning"
            >
              {t("lighting.referenceLed")}
            </span>
          ) : null}
          {lightingPreview ? t("lighting.previewOn") : t("lighting.previewOff")}
        </span>
      </div>
      <div
        ref={measure}
        data-testid="lighting-lane"
        className="relative overflow-x-hidden overflow-y-auto rounded border border-border bg-panel-2"
        style={{
          height: visibleLanes * LANE_HEIGHT + 6,
          maxHeight: MAX_VISIBLE_LANES * LANE_HEIGHT + 6,
        }}
        onPointerMove={(e) => move(e.clientX, e.altKey)}
        onPointerUp={end}
        onPointerLeave={cancel}
      >
        {layout.blocks.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
            {t("lighting.trackEmpty")}
          </p>
        )}
        <div
          style={{ height: Math.max(1, layout.laneCount) * LANE_HEIGHT + 4, position: "relative" }}
        >
          {layout.blocks.map((block) => {
            const selected = selectedLightingEffectId === block.id;
            const effect = block.effect;
            return (
              <div
                key={block.id}
                role="button"
                tabIndex={0}
                data-testid={`lighting-block-${block.id}`}
                data-lane={block.lane}
                data-active={block.active ? "1" : "0"}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  begin(block, "MOVE", e.clientX, e.altKey);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault();
                  const step = e.shiftKey ? 1 : 0.1;
                  commitLightingTiming(block.id, {
                    start: effect.start + (e.key === "ArrowLeft" ? -step : step),
                  });
                }}
                title={`${effect.type} · ${block.target.badge} · ${block.start.toFixed(2)}s · ${block.duration.toFixed(2)}s · ${t(
                  `lighting.anchor.${effect.anchor}` as "lighting.anchor.SCENE_START",
                )}`}
                className={`absolute cursor-grab touch-none rounded border text-[10px] ${
                  TYPE_TINT[effect.type] ?? "bg-muted"
                } ${
                  selected ? "border-accent ring-1 ring-accent" : "border-border"
                } ${block.active ? "brightness-125" : ""} ${effect.enabled ? "" : "opacity-40"}`}
                style={{
                  top: block.lane * LANE_HEIGHT + 3,
                  height: LANE_HEIGHT - 5,
                  left: `${block.leftPct}%`,
                  width: `${block.widthPct}%`,
                  minWidth: 8,
                }}
              >
                <span className="pointer-events-none absolute inset-0 flex items-center gap-1 overflow-hidden px-1 text-foreground">
                  <ColorSwatch color={block.color} />
                  {block.density !== "COMPACT" && (
                    <span className="truncate" data-testid={`lighting-block-label-${block.id}`}>
                      {effectPresetLabel(effect)}
                    </span>
                  )}

                  {block.density === "RICH" && (
                    <span className="truncate text-[9px] text-muted-foreground">
                      {block.target.badge}
                    </span>
                  )}
                </span>

                {/* LEFT handle — moves start, preserves the resolved end. */}
                <span
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    begin(block, "START", e.clientX, e.altKey);
                  }}
                  title={t("lighting.resizeStart")}
                  className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize touch-none bg-accent/0 hover:bg-accent/50"
                />
                {/* RIGHT handle — duration only. */}
                <span
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    begin(block, "DURATION", e.clientX, e.altKey);
                  }}
                  title={t("lighting.resize")}
                  className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none bg-accent/0 hover:bg-accent/50"
                />
              </div>
            );
          })}
        </div>
      </div>
      {draft ? (
        <p className="px-1 pt-0.5 font-mono text-[10px] text-accent">
          {draft.start.toFixed(2)}s · {draft.duration.toFixed(2)}s
          {draft.snapped ? ` · ${t("timeline.snapKind.MARKER")}` : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Exposed for tests: LED colour of a state, gamma-free and clamped. */
export const ledHex = (state: Parameters<typeof emittedColor>[0]) => rgbToHex(emittedColor(state));
