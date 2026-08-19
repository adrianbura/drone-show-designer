/**
 * TIMELINE MOUSE NAVIGATION (pure).
 *
 * Turns raw wheel / drag input into an intent expressed ONLY in the existing
 * view authority (`timelineZoom` + `timelineScroll` fraction). There is no
 * second scroll coordinate system, and nothing here can mutate the project.
 */

/** Firefox reports lines / pages instead of pixels. */
export function normalizeWheelDelta(delta: number, deltaMode: number): number {
  return delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
}

/** Below this many pixels a horizontal delta is considered noise, not intent. */
export const HORIZONTAL_DELTA_EPSILON = 1;
/** Bounded acceleration for Shift + vertical wheel. */
export const SHIFT_PAN_MULTIPLIER = 3;
/** Pixels of pointer travel that equal a full-window pan (matches drag feel). */
const PAN_PIXELS_PER_VIEWPORT = 4;

export interface WheelInputLike {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export type TimelineWheelIntent =
  | { readonly kind: "ZOOM"; readonly zoomFactor: number }
  | { readonly kind: "PAN"; readonly scrollDelta: number }
  | { readonly kind: "NONE" };

/**
 * Fraction of the full range covered by `pixels` of pointer/wheel travel at the
 * current track width. Independent of zoom, exactly like the existing deltaX pan.
 */
export function scrollDeltaForPixels(pixels: number, trackWidth: number): number {
  return pixels / Math.max(1, trackWidth * PAN_PIXELS_PER_VIEWPORT);
}

/**
 * PRIORITY: Ctrl/Cmd = zoom at cursor (unchanged) > native horizontal delta >
 * vertical delta panning horizontally. deltaX and deltaY are never summed, so a
 * trackpad that already reports horizontal travel cannot double-scroll.
 */
export function resolveTimelineWheel(
  input: WheelInputLike,
  view: { readonly zoom: number; readonly trackWidth: number },
): TimelineWheelIntent {
  const dy = normalizeWheelDelta(input.deltaY, input.deltaMode);
  if (input.ctrlKey || input.metaKey) {
    return { kind: "ZOOM", zoomFactor: Math.exp(-dy * 0.0015) };
  }

  const dx = normalizeWheelDelta(input.deltaX, input.deltaMode);
  if (Math.abs(dx) >= HORIZONTAL_DELTA_EPSILON) {
    if (view.zoom <= 1) return { kind: "NONE" };
    return { kind: "PAN", scrollDelta: scrollDeltaForPixels(dx, view.trackWidth) };
  }

  if (Math.abs(dy) < HORIZONTAL_DELTA_EPSILON || view.zoom <= 1) return { kind: "NONE" };
  const pixels = dy * (input.shiftKey ? SHIFT_PAN_MULTIPLIER : 1);
  return { kind: "PAN", scrollDelta: scrollDeltaForPixels(pixels, view.trackWidth) };
}

/** Clamped view scroll fraction — the only value a navigation gesture writes. */
export function clampScroll(scroll: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(scroll) ? scroll : 0));
}

export interface MiddlePanSession {
  readonly startX: number;
  readonly startScroll: number;
}

/** Grab-pan: dragging left shows later time, exactly like a hand tool. */
export function middlePanScroll(session: MiddlePanSession, clientX: number, trackWidth: number): number {
  return clampScroll(session.startScroll - scrollDeltaForPixels(clientX - session.startX, trackWidth));
}
