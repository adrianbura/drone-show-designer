/**
 * TIMELINE EDITING ENGINE (pure, Sprint 7.2).
 *
 * The single deterministic source of truth for turning pointer positions into
 * CANONICAL clip timing. There is no second timeline model: every helper here
 * returns a patch for the authoritative `TimelineClip` fields (`start`,
 * `transition`, `hold`).
 *
 * Nothing in this module knows about React, the DOM or flight computation.
 */
import type { BeatGrid } from "../show/audio";
import type { TimelineClip } from "../show/types";

/** Canonical domain floors used by the authoring layer. */
export const MIN_TRANSITION = 0.5;
export const MIN_HOLD = 0;
/** Editor assumption when the project carries no time signature. */
export const EDITOR_BEATS_PER_BAR = 4;

export const SNAP_MODES = ["OFF", "S010", "S050", "S100", "BEAT", "BAR", "MARKER"] as const;
export type SnapMode = (typeof SNAP_MODES)[number];

/** Fixed grid step of the numeric snap modes, in seconds. */
const GRID_STEP: Partial<Record<SnapMode, number>> = { S010: 0.1, S050: 0.5, S100: 1 };

export interface SnapContext {
  readonly mode: SnapMode;
  /** Canonical beat grid derived from the project tempo (respects audio.offset). */
  readonly beatGrid?: BeatGrid;
  /** Project-owned marker times, seconds in show time. */
  readonly markers?: readonly number[];
  /** Current timeline scale — makes the snap threshold pixel-aware. */
  readonly pixelsPerSecond: number;
  /** Maximum pointer distance, in pixels, at which a target may capture. */
  readonly thresholdPx?: number;
  /** Temporary override (Alt held): snapping is bypassed for this gesture. */
  readonly disabled?: boolean;
}

export interface SnapResult {
  /** Snapped (or untouched) time, rounded to millisecond precision. */
  readonly time: number;
  readonly snapped: boolean;
  /** Machine-readable target kind — never shown raw to the operator. */
  readonly kind?: "GRID" | "BEAT" | "BAR" | "MARKER";
  /** Beat/bar ordinal when the captured target came from the tempo grid. */
  readonly index?: number;
}

export function roundTime(t: number): number {
  return Math.round(t * 1000) / 1000;
}

/** Rejects NaN / Infinity before any canonical value is written. */
export function safeTime(t: number, fallback = 0): number {
  return Number.isFinite(t) ? t : fallback;
}

function nearest(
  time: number,
  candidates: readonly number[],
  maxDistance: number,
): { value: number; index: number } | null {
  let best: { value: number; index: number } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const d = Math.abs(c - time);
    if (d > maxDistance) continue;
    if (!best || d < Math.abs(best.value - time)) best = { value: c, index: i };
  }
  return best;
}

/**
 * ONE snapping utility for the whole editor. Grid modes always quantise; beat,
 * bar and marker modes only capture a target that is visually close to the
 * pointer (pixel-aware threshold), so a distant beat never hijacks the drag.
 */
export function snapTimelineTime(time: number, context: SnapContext): SnapResult {
  const t = roundTime(safeTime(time));
  if (context.disabled || context.mode === "OFF") return { time: t, snapped: false };

  const step = GRID_STEP[context.mode];
  if (step) {
    const snapped = roundTime(Math.round(t / step) * step);
    return { time: snapped, snapped: snapped !== t, kind: "GRID" };
  }

  const pps = Math.max(0.0001, context.pixelsPerSecond);
  const maxDistance = Math.max(0.001, (context.thresholdPx ?? 10) / pps);

  if (context.mode === "BEAT" || context.mode === "BAR") {
    const grid = context.beatGrid;
    if (!grid) return { time: t, snapped: false };
    const candidates = context.mode === "BEAT" ? grid.beats : grid.bars;
    const hit = nearest(t, candidates, maxDistance);
    if (!hit) return { time: t, snapped: false };
    return {
      time: roundTime(hit.value),
      snapped: true,
      kind: context.mode,
      index: context.mode === "BEAT" ? hit.index : hit.index,
    };
  }

  const hit = nearest(t, context.markers ?? [], maxDistance);
  if (!hit) return { time: t, snapped: false };
  return { time: roundTime(hit.value), snapped: true, kind: "MARKER", index: hit.index };
}

/** Formation-ready moment of a clip: the transition/hold boundary. */
export function clipReadyTime(clip: TimelineClip): number {
  return clip.start + clip.transition;
}

export function clipEndTime(clip: TimelineClip): number {
  return clip.start + clip.transition + clip.hold;
}

/**
 * TRANSITION RESIZE — dragging the formation-ready boundary.
 *
 * `hold` is deliberately untouched: the clip end follows the boundary, which is
 * exactly the existing Studio semantics (`end = start + transition + hold`).
 */
export function resizeTransition(
  clip: TimelineClip,
  pointerTime: number,
  context: SnapContext,
): { readonly transition: number; readonly snap: SnapResult } {
  const snap = snapTimelineTime(pointerTime, context);
  const transition = roundTime(Math.max(MIN_TRANSITION, snap.time - clip.start));
  return { transition, snap };
}

/** HOLD RESIZE — dragging the right edge of the clip. */
export function resizeHold(
  clip: TimelineClip,
  pointerTime: number,
  context: SnapContext,
): { readonly hold: number; readonly snap: SnapResult } {
  const snap = snapTimelineTime(pointerTime, context);
  const hold = roundTime(Math.max(MIN_HOLD, snap.time - clipReadyTime(clip)));
  return { hold, snap };
}

/** CLIP MOVE — dragging the clip body. Show content never starts before t = 0. */
export function moveClip(
  clip: TimelineClip,
  pointerStartTime: number,
  context: SnapContext,
): { readonly start: number; readonly snap: SnapResult } {
  const snap = snapTimelineTime(pointerStartTime, context);
  return { start: roundTime(Math.max(0, snap.time)), snap };
}

/** Pointer position -> canonical show time on a shared linear time axis. */
export function timeFromPixel(
  clientX: number,
  rect: { readonly left: number; readonly width: number },
  view: { readonly start: number; readonly end: number },
): number {
  const span = Math.max(0.001, view.end - view.start);
  const ratio = (clientX - rect.left) / Math.max(1, rect.width);
  return view.start + ratio * span;
}

export function pixelsPerSecond(width: number, view: { readonly start: number; readonly end: number }): number {
  return Math.max(1, width) / Math.max(0.001, view.end - view.start);
}

/** m:ss.ff (25 fps sub-second field) — the Studio's canonical time read-out. */
export function formatShowTime(t: number, decimalComma = false): string {
  const value = safeTime(t);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  const f = Math.floor((abs % 1) * 25);
  const text = `${sign}${m}:${s.toString().padStart(2, "0")}.${f.toString().padStart(2, "0")}`;
  return decimalComma ? text.replace(".", ",") : text;
}

/** Seconds with one decimal, localised decimal separator. */
export function formatSeconds(t: number, decimalComma = false): string {
  const text = safeTime(t).toFixed(1);
  return decimalComma ? text.replace(".", ",") : text;
}

// ---- Zoom / horizontal navigation (EDITOR STATE ONLY) --------------------
// Zoom and scroll never touch the project: they cannot mark it dirty and they
// cannot invalidate a validation report.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 400;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, safeTime(zoom, 1)));
}

export interface TimelineViewInput {
  /** Full editable range (pre-show start .. view end). */
  readonly start: number;
  readonly end: number;
  readonly zoom: number;
  /** Left edge of the visible window as a 0..1 fraction of the full range. */
  readonly scroll: number;
}

export interface TimelineView {
  readonly start: number;
  readonly end: number;
}

/** Visible time window shared by the clip track, waveform and every overlay. */
export function computeTimelineView(input: TimelineViewInput): TimelineView {
  const full = Math.max(0.001, input.end - input.start);
  const zoom = clampZoom(input.zoom);
  const span = full / zoom;
  const maxStart = full - span;
  const offset = Math.min(maxStart, Math.max(0, safeTime(input.scroll) * maxStart));
  const start = input.start + offset;
  return { start, end: start + span };
}

/** Scroll fraction that centres `time`, used by zoom-at-cursor and follow. */
export function scrollToCenter(time: number, input: TimelineViewInput): number {
  const full = Math.max(0.001, input.end - input.start);
  const span = full / clampZoom(input.zoom);
  const maxStart = full - span;
  if (maxStart <= 0) return 0;
  const desired = time - input.start - span / 2;
  return Math.min(1, Math.max(0, desired / maxStart));
}

/**
 * Zoom around an anchor time: the anchor keeps its screen position instead of
 * snapping the window back to time zero.
 */
export function zoomAtTime(
  anchorTime: number,
  nextZoom: number,
  input: TimelineViewInput,
): { readonly zoom: number; readonly scroll: number } {
  const view = computeTimelineView(input);
  const ratio = (anchorTime - view.start) / Math.max(0.001, view.end - view.start);
  const zoom = clampZoom(nextZoom);
  const full = Math.max(0.001, input.end - input.start);
  const span = full / zoom;
  const maxStart = full - span;
  if (maxStart <= 0) return { zoom, scroll: 0 };
  const start = anchorTime - ratio * span;
  return { zoom, scroll: Math.min(1, Math.max(0, (start - input.start) / maxStart)) };
}

/**
 * SCROLL GEOMETRY — the single source of truth for the viewport scrollbar.
 *
 * `scroll` interpolates across the HIDDEN range only:
 *   visibleSpan = authoredSpan / zoom
 *   maxPan      = authoredSpan - visibleSpan
 *   viewStart   = authoredStart + scroll * maxPan
 * so scroll = 0 shows the authored start exactly and scroll = 1 shows the
 * authored end exactly, at any zoom and with a negative PRE_SHOW start.
 */
export interface TimelineScrollGeometry {
  readonly authoredSpan: number;
  readonly visibleSpan: number;
  readonly maxPan: number;
  /** Thumb width as a 0..1 fraction of the track. */
  readonly thumbSize: number;
  /** Thumb left edge as a 0..1 fraction of the track. */
  readonly thumbStart: number;
  /** False when the whole authored range is visible (nothing to pan). */
  readonly scrollable: boolean;
}

export function timelineScrollGeometry(input: TimelineViewInput): TimelineScrollGeometry {
  const authoredSpan = Math.max(0.001, input.end - input.start);
  const zoom = clampZoom(input.zoom);
  const visibleSpan = authoredSpan / zoom;
  const maxPan = Math.max(0, authoredSpan - visibleSpan);
  const thumbSize = Math.min(1, visibleSpan / authoredSpan);
  const scroll = Math.min(1, Math.max(0, safeTime(input.scroll)));
  return {
    authoredSpan,
    visibleSpan,
    maxPan,
    thumbSize,
    thumbStart: maxPan <= 0 ? 0 : scroll * (1 - thumbSize),
    scrollable: maxPan > 0,
  };
}

/** Scroll fraction whose visible window starts exactly at `viewStart`. */
export function scrollForViewStart(viewStart: number, input: TimelineViewInput): number {
  const { maxPan } = timelineScrollGeometry(input);
  if (maxPan <= 0) return 0;
  return Math.min(1, Math.max(0, (safeTime(viewStart) - input.start) / maxPan));
}

/**
 * Track-relative click/drag position (0..1) -> scroll fraction, accounting for
 * the thumb width so the thumb centre lands under the pointer.
 */
export function scrollFromThumbPosition(trackFraction: number, input: TimelineViewInput): number {
  const { thumbSize } = timelineScrollGeometry(input);
  const usable = Math.max(1e-6, 1 - thumbSize);
  return Math.min(1, Math.max(0, (safeTime(trackFraction) - thumbSize / 2) / usable));
}

/**
 * CONTENT RANGE CHANGE WHILE ZOOMED.
 *
 * Adding a clip, shifting LANDING or extending audio/markers grows the authored
 * range. The operator keeps their zoom and their approximate viewed window: the
 * previous view start is re-expressed in the new range and only clamped when it
 * no longer fits. Never a silent Fit, never a jump to scroll = 0.
 */
export function preserveScrollAcrossRange(
  previous: TimelineViewInput,
  next: { readonly start: number; readonly end: number },
): number {
  const previousView = computeTimelineView(previous);
  return scrollForViewStart(previousView.start, {
    start: next.start,
    end: next.end,
    zoom: previous.zoom,
    scroll: previous.scroll,
  });
}

/**
 * PHASES AUTHORABLE FROM THE TIMELINE UI.
 *
 * PRE_SHOW is deliberately absent: it belongs to the dedicated pre-show system
 * and only ever occupies negative show time.
 */
export const AUTHORABLE_CLIP_PHASES = ["TAKEOFF", "SHOW", "LANDING"] as const;
export type AuthorableClipPhase = (typeof AUTHORABLE_CLIP_PHASES)[number];

/**
 * Phase a newly added clip should get: the very first clip on an empty timeline
 * is the explicit fleet departure (TAKEOFF); everything else is SHOW. A LANDING
 * clip is never invented automatically.
 */
export function defaultPhaseForNewClip(timeline: readonly TimelineClip[]): AuthorableClipPhase {
  return timeline.length === 0 ? "TAKEOFF" : "SHOW";
}

/**
 * POINTER BUTTON CONTRACT for timeline gestures.
 *
 * Only the PRIMARY pointer (left mouse button, primary touch contact, pen tip)
 * may start a drag/resize. Right click (button 2), middle click (button 1) and
 * secondary contacts must fall through so the context menu / pan logic owns the
 * event — never a drag gesture and never a pointer capture.
 */
export function shouldBeginTimelineGesture(pointer: {
  readonly button: number;
  readonly isPrimary?: boolean;
  readonly pointerType?: string;
}): boolean {
  if (pointer.isPrimary === false) return false;
  return pointer.button === 0;
}

