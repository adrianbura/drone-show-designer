/**
 * TIMELINE — professional choreography editor (presentation layer only).
 *
 * All timing mathematics (snapping, resize clamping, zoom/scroll windows) lives
 * in `src/lib/studio/timelineEdit.ts`; all canonical mutations go through the
 * store. A pointer gesture drafts locally and commits exactly ONCE on release,
 * so one drag is one undoable edit and never a stream of project writes.
 */
import {
  Bookmark,
  Crosshair,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat,
  SkipBack,
  Square,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { rgbToHex } from "@/lib/show/lights";
import { markerTimes } from "@/lib/show/markers";
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from "@/lib/studio/clock";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  SNAP_MODES,
  formatSeconds,
  formatShowTime,
  moveClip,
  pixelsPerSecond,
  resizeHold,
  resizeTransition,
  timeFromPixel,
  type SnapMode,
  type SnapResult,
} from "@/lib/studio/timelineEdit";
import { useStudio } from "@/lib/studio/store";
import AudioWaveformTrack from "./AudioWaveformTrack";
import LightingTrack from "./LightingTrack";
import TimelineAnnotations from "./TimelineAnnotations";

/** Subtle tint per inferred forensic category (semantic tokens only). */
const FORENSIC_TINT: Record<string, string> = {
  GROUND_STATIC: "bg-muted",
  TAKEOFF_ASCENT: "bg-accent/70",
  STATIC_FORMATION: "bg-muted-foreground/60",
  POSSIBLE_STAGING: "bg-accent/40",
  GLOBAL_TRANSLATION: "bg-primary/60",
  GLOBAL_ROTATION: "bg-primary/80",
  RIGID_MOTION: "bg-primary",
  DYNAMIC_DEFORMATION: "bg-warning",
  FORMATION_TRANSITION: "bg-secondary",
  LANDING_DESCENT: "bg-accent/50",
  UNKNOWN: "bg-border",
};

type GestureKind = "MOVE" | "TRANSITION" | "HOLD";

interface Gesture {
  readonly id: string;
  readonly kind: GestureKind;
  readonly startX: number;
  /** Pointer offset from the clip start at grab time (move gestures only). */
  readonly grabOffset: number;
  readonly orig: { start: number; transition: number; hold: number };
  moved: boolean;
}

interface Draft {
  readonly id: string;
  readonly kind: GestureKind;
  readonly start: number;
  readonly transition: number;
  readonly hold: number;
  readonly snap: SnapResult;
}

export default function Timeline() {
  const {
    project,
    duration,
    time,
    playing,
    togglePlay,
    stop,
    speed,
    setSpeed,
    loop,
    setLoop,
    setTime,
    selectedClipId,
    selectClip,
    removeClip,
    beatGrid,
    addClip,
    fullShowReport,
    focusIssue,
    preShowPlan,
    forensicsReport,
    selectedForensicSegmentId,
    selectForensicSegment,
    audioPeaks,
    audioAttached,
    audioMuted,
    setAudioMuted,
    audioVolume,
    setAudioVolume,
    // Sprint 7.2 editor surface
    timelineView,
    timelineZoom,
    timelineScroll,
    snapMode,
    setSnapMode,
    followPlayhead,
    setFollowPlayhead,
    setTimelineZoom,
    setTimelineScroll,
    commitClipTiming,
    undoTimeline,
    redoTimeline,
    timelineHistoryDepth,
    markers,
    musicSections,
    addMarker,
    patchMarker,
    removeMarker,
    addMusicSection,
    patchMusicSection,
    removeMusicSection,
  } = useStudio();
  const { t, language } = useI18n();
  const comma = language === "ro";
  const trackRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const viewStart = timelineView.start;
  const viewEndTime = timelineView.end;
  const span = Math.max(0.001, viewEndTime - viewStart);
  const pct = useCallback((v: number) => `${((v - viewStart) / span) * 100}%`, [viewStart, span]);
  const widthPct = useCallback((v: number) => `${(v / span) * 100}%`, [span]);

  const snapTargets = useMemo(() => markerTimes(markers), [markers]);

  /** Snap context for the current gesture — pixel-aware, Alt bypasses it. */
  const snapContext = useCallback(
    (altKey: boolean) => ({
      mode: snapMode,
      beatGrid,
      markers: snapTargets,
      pixelsPerSecond: pixelsPerSecond(trackRef.current?.getBoundingClientRect().width ?? 1, timelineView),
      disabled: altKey,
    }),
    [snapMode, beatGrid, snapTargets, timelineView],
  );

  const pointerTime = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      return timeFromPixel(clientX, el.getBoundingClientRect(), timelineView);
    },
    [timelineView],
  );

  const scrub = useCallback((clientX: number) => setTime(pointerTime(clientX)), [pointerTime, setTime]);

  const beginGesture = useCallback(
    (kind: GestureKind, clipId: string, clientX: number) => {
      const clip = project.timeline.find((c) => c.id === clipId);
      if (!clip) return;
      gestureRef.current = {
        id: clipId,
        kind,
        startX: clientX,
        grabOffset: pointerTime(clientX) - clip.start,
        orig: { start: clip.start, transition: clip.transition, hold: clip.hold },
        moved: false,
      };
      setDraft({
        id: clipId,
        kind,
        start: clip.start,
        transition: clip.transition,
        hold: clip.hold,
        snap: { time: clip.start, snapped: false },
      });
    },
    [project.timeline, pointerTime],
  );

  /** Live drafting: no canonical write happens here. */
  const updateGesture = useCallback(
    (clientX: number, altKey: boolean) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      if (Math.abs(clientX - gesture.startX) > 2) gesture.moved = true;
      const clip = { id: gesture.id, ...gesture.orig } as Parameters<typeof moveClip>[0];
      const ctx = snapContext(altKey);
      const pt = pointerTime(clientX);
      if (gesture.kind === "MOVE") {
        const { start, snap } = moveClip(clip, pt - gesture.grabOffset, ctx);
        setDraft({ id: gesture.id, kind: gesture.kind, ...gesture.orig, start, snap });
      } else if (gesture.kind === "TRANSITION") {
        const { transition, snap } = resizeTransition(clip, pt, ctx);
        setDraft({ id: gesture.id, kind: gesture.kind, ...gesture.orig, transition, snap });
      } else {
        const { hold, snap } = resizeHold(clip, pt, ctx);
        setDraft({ id: gesture.id, kind: gesture.kind, ...gesture.orig, hold, snap });
      }
    },
    [snapContext, pointerTime],
  );

  /** ONE commit per gesture; a no-op drag writes nothing at all. */
  const endGesture = useCallback(() => {
    const gesture = gestureRef.current;
    const current = draft;
    gestureRef.current = null;
    setDraft(null);
    if (!gesture || !current || !gesture.moved) return;
    if (
      current.start === gesture.orig.start &&
      current.transition === gesture.orig.transition &&
      current.hold === gesture.orig.hold
    ) {
      return;
    }
    commitClipTiming(gesture.id, {
      start: current.start,
      transition: current.transition,
      hold: current.hold,
    });
  }, [draft, commitClipTiming]);

  const cancelGesture = useCallback(() => {
    gestureRef.current = null;
    setDraft(null);
  }, []);

  // ESC aborts an in-flight gesture and leaves the project untouched.
  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelGesture();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, cancelGesture]);

  /** Keyboard nudging of the selected clip's timing (accessible resize). */
  const nudge = useCallback(
    (kind: GestureKind, clipId: string, delta: number) => {
      const clip = project.timeline.find((c) => c.id === clipId);
      if (!clip) return;
      if (kind === "MOVE") commitClipTiming(clipId, { start: Math.max(0, clip.start + delta) });
      else if (kind === "TRANSITION") commitClipTiming(clipId, { transition: clip.transition + delta });
      else commitClipTiming(clipId, { hold: clip.hold + delta });
    },
    [project.timeline, commitClipTiming],
  );

  const handleKey = (kind: GestureKind, clipId: string) => (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const step = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowLeft" ? -1 : 1);
    nudge(kind, clipId, step);
  };

  // Ctrl/Cmd + wheel zooms at the cursor; plain wheel scrolls the window.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const anchor = timeFromPixel(e.clientX, el.getBoundingClientRect(), timelineView);
        setTimelineZoom(timelineZoom * Math.exp(-dy * 0.0015), anchor);
        return;
      }
      const dx = e.deltaX * (e.deltaMode === 1 ? 16 : 1);
      if (Math.abs(dx) < 1) return;
      e.preventDefault();
      setTimelineScroll(timelineScroll + dx / Math.max(1, el.getBoundingClientRect().width * 4));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [timelineView, timelineZoom, timelineScroll, setTimelineZoom, setTimelineScroll]);

  const draftedClip = (clipId: string) => (draft?.id === clipId ? draft : null);

  return (
    <section className="flex h-full flex-col bg-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <button
          onClick={() => setTime(viewStart)}
          className="control-btn"
          aria-label={preShowPlan ? "Return to pre-show start" : "Return to show start"}
        >
          <SkipBack className="size-4" />
        </button>
        <button onClick={togglePlay} className="control-btn control-btn-accent" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <button onClick={stop} className="control-btn" aria-label="Stop and rewind">
          <Square className="size-3.5" />
        </button>
        <span className="font-mono text-sm tabular-nums text-accent">{formatShowTime(time, comma)}</span>
        <span className="font-mono text-xs text-muted-foreground">/ {formatShowTime(duration, comma)}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {/* SNAP — the operator always sees which grid is capturing. */}
          <select
            value={snapMode}
            onChange={(e) => setSnapMode(e.target.value as SnapMode)}
            className="studio-input w-24 py-0.5 text-[11px]"
            aria-label={t("timeline.snap")}
            title={t("timeline.snapHint")}
          >
            {SNAP_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`timeline.snap.${mode}` as "timeline.snap.OFF")}
              </option>
            ))}
          </select>
          <button
            onClick={() => addMarker(time)}
            className="control-btn"
            aria-label={t("timeline.addMarker")}
            title={t("timeline.addMarker")}
          >
            <Bookmark className="size-4" />
          </button>
          <button
            onClick={() => addMusicSection(Math.max(0, time), Math.max(0, time) + 20)}
            className="control-btn text-[10px]"
            aria-label={t("timeline.addSection")}
            title={t("timeline.addSection")}
          >
            §
          </button>
          <button
            onClick={undoTimeline}
            disabled={timelineHistoryDepth.past === 0}
            className="control-btn disabled:opacity-40"
            aria-label={t("timeline.undo")}
          >
            <Undo2 className="size-4" />
          </button>
          <button
            onClick={redoTimeline}
            disabled={timelineHistoryDepth.future === 0}
            className="control-btn disabled:opacity-40"
            aria-label={t("timeline.redo")}
          >
            <Redo2 className="size-4" />
          </button>
          <button
            onClick={() => setTimelineZoom(timelineZoom / 1.6, time)}
            disabled={timelineZoom <= MIN_ZOOM}
            className="control-btn disabled:opacity-40"
            aria-label={t("timeline.zoomOut")}
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="font-mono text-[10px] tabular-nums">{timelineZoom.toFixed(1)}x</span>
          <button
            onClick={() => setTimelineZoom(timelineZoom * 1.6, time)}
            disabled={timelineZoom >= MAX_ZOOM}
            className="control-btn disabled:opacity-40"
            aria-label={t("timeline.zoomIn")}
          >
            <ZoomIn className="size-4" />
          </button>
          <button
            onClick={() => setFollowPlayhead(!followPlayhead)}
            className={`control-btn ${followPlayhead ? "text-accent" : ""}`}
            aria-label={t("timeline.follow")}
            aria-pressed={followPlayhead}
          >
            <Crosshair className="size-4" />
          </button>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) as PlaybackSpeed)}
            className="studio-input w-16 py-0.5 font-mono text-[11px]"
            aria-label="Playback speed"
          >
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <button
            onClick={() => setLoop(!loop)}
            className={`control-btn ${loop ? "text-accent" : ""}`}
            aria-label="Toggle loop"
            aria-pressed={loop}
          >
            <Repeat className="size-4" />
          </button>
          <span>{project.audio.bpm} BPM</span>
          {audioAttached && (
            <>
              <button
                onClick={() => setAudioMuted(!audioMuted)}
                className={`control-btn ${audioMuted ? "text-destructive" : "text-accent"}`}
                aria-label={t("audio.mute")}
                aria-pressed={audioMuted}
              >
                {audioMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={audioVolume}
                onChange={(e) => setAudioVolume(Number(e.target.value))}
                className="w-16"
                aria-label={t("audio.volume")}
              />
            </>
          )}
          <span>{project.timeline.length} clips</span>
          <button
            onClick={() => addClip(project.formations[0]?.id ?? "")}
            className="control-btn"
            aria-label="Append clip"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </header>

      <div className="relative flex flex-1 flex-col gap-1 overflow-hidden px-4 pb-3 pt-2">
        <TimelineAnnotations
          markers={markers}
          sections={musicSections}
          view={timelineView}
          onSeek={setTime}
          onPatchMarker={patchMarker}
          onRemoveMarker={removeMarker}
          onPatchSection={patchMusicSection}
          onRemoveSection={removeMusicSection}
        />

        <div
          ref={trackRef}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e.clientX);
          }}
          onPointerMove={(e) => {
            if (gestureRef.current) return;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e.clientX);
          }}
          className="relative min-h-20 flex-1 cursor-ew-resize touch-none rounded-md border border-border bg-surface-sunken"
        >
          {/* PRE-SHOW region: negative show time, launch + staging */}
          {preShowPlan ? (
            <>
              <div
                className="pointer-events-none absolute top-0 h-full border-r border-dashed border-accent/60 bg-accent/[0.06]"
                style={{ left: pct(Math.min(0, viewStart)), width: widthPct(Math.max(0, -Math.min(0, viewStart))) }}
              >
                <span className="absolute left-1.5 top-1 text-[10px] uppercase tracking-[0.18em] text-accent/80">
                  Pre-show · launch + staging
                </span>
              </div>
              <div className="pointer-events-none absolute top-0 h-full w-px bg-accent/80" style={{ left: pct(0) }}>
                <span className="absolute -top-0.5 left-1 text-[10px] font-medium uppercase tracking-[0.18em] text-accent">
                  Show start
                </span>
              </div>
            </>
          ) : null}

          {/* Beat grid — bars are always drawn; beats only when they stay readable. */}
          {beatGrid.beats
            .filter(() => pixelsPerSecond(1000, timelineView) > 24)
            .map((b) => (
              <div
                key={`beat-${b}`}
                className="pointer-events-none absolute top-0 h-full w-px bg-border/30"
                style={{ left: pct(b) }}
              />
            ))}
          {beatGrid.bars.map((b) => (
            <div
              key={`bar-${b}`}
              className="pointer-events-none absolute top-0 h-full w-px bg-border/70"
              style={{ left: pct(b) }}
            />
          ))}

          {/* Marker guides mirrored into the clip track for alignment. */}
          {markers.map((m) => (
            <div
              key={`mg-${m.id}`}
              className="pointer-events-none absolute top-0 h-full w-px bg-accent/25"
              style={{ left: pct(m.time) }}
            />
          ))}

          {/* Full-show validation markers (errors and warnings, in show time) */}
          {fullShowReport?.issues
            .filter((i) => typeof i.time === "number" && i.severity !== "info")
            .slice(0, 400)
            .map((issue) => (
              <button
                key={`iss-${issue.id}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  focusIssue(issue);
                }}
                title={issue.message}
                aria-label={issue.message}
                className={`absolute bottom-0 h-2.5 w-[3px] ${
                  issue.severity === "error" ? "bg-destructive" : "bg-warning"
                }`}
                style={{ left: pct(issue.time ?? 0) }}
              />
            ))}

          {/* Reference forensics segments (inferred, read-only overlay) */}
          {forensicsReport?.segments.map((s) => (
            <button
              key={`fx-${s.id}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                selectForensicSegment(s.id);
              }}
              title={`${s.label} — ${s.classification} (inferred)`}
              aria-label={`${s.label}, ${s.classification}`}
              className={`absolute bottom-3 h-1.5 rounded-sm opacity-70 hover:opacity-100 ${
                FORENSIC_TINT[s.classification]
              } ${s.id === selectedForensicSegmentId ? "ring-1 ring-accent opacity-100" : ""}`}
              style={{ left: pct(s.startTime), width: widthPct(Math.max(0.2, s.duration)) }}
            />
          ))}

          {/* Clips — body drags, edges resize transition / hold. */}
          {project.timeline.map((clip, row) => {
            const formation = project.formations.find((f) => f.id === clip.formationId);
            const d = draftedClip(clip.id);
            const start = d?.start ?? clip.start;
            const transition = d?.transition ?? clip.transition;
            const hold = d?.hold ?? clip.hold;
            const total = Math.max(0.01, transition + hold);
            const selected = clip.id === selectedClipId;
            const name =
              project.dynamicFormations?.find((x) => x.id === clip.dynamicFormationId)?.name ??
              formation?.name ??
              "Missing formation";
            return (
              <div
                key={clip.id}
                className={`clip-block ${selected ? "clip-block-selected" : ""} ${d ? "z-20 ring-1 ring-accent" : ""}`}
                style={{
                  left: pct(start),
                  width: widthPct(total),
                  top: `${8 + (row % 3) * 34}px`,
                  borderColor: rgbToHex(clip.color),
                  background: `linear-gradient(90deg, ${rgbToHex(clip.color)}33, ${rgbToHex(clip.color)}12)`,
                }}
              >
                {/* BODY — move gesture */}
                <button
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    selectClip(clip.id);
                    e.currentTarget.setPointerCapture(e.pointerId);
                    beginGesture("MOVE", clip.id, e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (!gestureRef.current) return;
                    e.stopPropagation();
                    updateGesture(e.clientX, e.altKey);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    endGesture();
                  }}
                  onPointerCancel={cancelGesture}
                  onKeyDown={handleKey("MOVE", clip.id)}
                  title={`${name} · T ${formatSeconds(transition, comma)} · H ${formatSeconds(hold, comma)} — ${t(
                    "timeline.dragHint",
                  )}`}
                  className="absolute inset-0 cursor-grab touch-none px-1.5 text-left active:cursor-grabbing"
                >
                  <span className="block truncate">
                    {clip.dynamicFormationId ? "◈ " : ""}
                    {name}
                  </span>
                  <span className="block truncate font-mono text-[9px] text-muted-foreground">
                    T {formatSeconds(transition, comma)} · H {formatSeconds(hold, comma)}
                  </span>
                </button>

                {/* Transition / hold boundary = formation-ready moment */}
                <span
                  className="pointer-events-none absolute inset-y-0 left-0 border-r border-dashed opacity-60"
                  style={{
                    width: `${(transition / total) * 100}%`,
                    borderColor: rgbToHex(clip.color),
                  }}
                />

                {/* TRANSITION handle — drags the formation-ready boundary */}
                <button
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    selectClip(clip.id);
                    e.currentTarget.setPointerCapture(e.pointerId);
                    beginGesture("TRANSITION", clip.id, e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (!gestureRef.current) return;
                    e.stopPropagation();
                    updateGesture(e.clientX, e.altKey);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    endGesture();
                  }}
                  onPointerCancel={cancelGesture}
                  onKeyDown={handleKey("TRANSITION", clip.id)}
                  title={t("timeline.transitionHandle")}
                  aria-label={t("timeline.transitionHandle")}
                  className="absolute inset-y-0 w-2 -translate-x-1 cursor-col-resize touch-none bg-accent/0 hover:bg-accent/40"
                  style={{ left: `${(transition / total) * 100}%` }}
                />

                {/* HOLD handle — drags the clip end */}
                <button
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    selectClip(clip.id);
                    e.currentTarget.setPointerCapture(e.pointerId);
                    beginGesture("HOLD", clip.id, e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (!gestureRef.current) return;
                    e.stopPropagation();
                    updateGesture(e.clientX, e.altKey);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    endGesture();
                  }}
                  onPointerCancel={cancelGesture}
                  onKeyDown={handleKey("HOLD", clip.id)}
                  title={t("timeline.holdHandle")}
                  aria-label={t("timeline.holdHandle")}
                  className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none bg-accent/0 hover:bg-accent/40"
                />
              </div>
            );
          })}

          {/* Live gesture read-out: exact timings + what captured the snap. */}
          {draft && (
            <div className="pointer-events-none absolute right-2 top-1 z-30 rounded border border-border bg-panel px-2 py-1 font-mono text-[10px] text-foreground">
              {formatShowTime(draft.start, comma)} · T {formatSeconds(draft.transition, comma)} · H{" "}
              {formatSeconds(draft.hold, comma)} · {t("timeline.ready")} {formatShowTime(
                draft.start + draft.transition,
                comma,
              )}
              {draft.snap.snapped && draft.snap.kind ? (
                <span className="ml-1 text-accent">
                  ⟶ {t(`timeline.snapKind.${draft.snap.kind}` as "timeline.snapKind.GRID")}
                </span>
              ) : null}
            </div>
          )}

          {/* Clean startup: an empty timeline says what to do next. */}
          {project.timeline.length === 0 && (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11px] text-muted-foreground">
              {t("timeline.empty")}
            </p>
          )}

          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-0 h-full w-[2px] bg-accent shadow-[0_0_12px_var(--accent)]"
            style={{ left: pct(Math.max(viewStart, Math.min(time, viewEndTime))) }}
          >
            <div className="absolute -left-[5px] top-0 size-3 rotate-45 bg-accent" />
          </div>
        </div>

        {/* Horizontal navigation of the zoomed window. */}
        {timelineZoom > MIN_ZOOM && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={timelineScroll}
            onChange={(e) => setTimelineScroll(Number(e.target.value))}
            className="w-full"
            aria-label={t("timeline.scroll")}
          />
        )}

        {audioAttached && (
          <AudioWaveformTrack
            peaks={audioPeaks}
            startTime={viewStart}
            endTime={viewEndTime}
            offset={project.audio.offset}
            audioDuration={project.audio.duration}
            time={time}
            label={project.audio.name || t("audio.track")}
            onSeek={setTime}
          />
        )}

        {/* LIGHTING TRACK — effects of the selected scene, in show time. */}
        <LightingTrack viewStart={viewStart} viewEnd={viewEndTime} />

        {selectedClipId && (
          <button
            onClick={() => removeClip(selectedClipId)}
            className="absolute bottom-4 right-6 flex items-center gap-1.5 rounded border border-border bg-panel px-2 py-1 text-[11px] uppercase tracking-widest text-destructive hover:border-destructive"
          >
            <Trash2 className="size-3" /> Delete clip
          </button>
        )}
      </div>
    </section>
  );
}
