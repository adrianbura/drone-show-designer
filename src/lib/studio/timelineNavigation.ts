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
 * PIXEL-ACCURATE PAN. `pixels` of pointer/wheel travel move the view by the
 * same number of pixels of show time, expressed in the ONLY view authority
 * (the 0..1 scroll fraction of the hidden range):
 *
 *   scrollDelta = pixels / (trackWidth * (zoom - 1))
 *
 * because the hidden range is `authoredSpan * (1 - 1/zoom)` while one pixel is
 * `authoredSpan / (zoom * trackWidth)`. Zoom-independent scaling used to make a
 * single wheel tick jump multiple windows at high zoom, which is what made
 * content feel unreachable.
 */
export function scrollDeltaForPixels(pixels: number, trackWidth: number, zoom: number): number {
  const z = Number.isFinite(zoom) ? zoom : 1;
  if (z <= 1) return 0;
  return pixels / Math.max(1, trackWidth) / (z - 1);
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
    return { kind: "PAN", scrollDelta: scrollDeltaForPixels(dx, view.trackWidth, view.zoom) };
  }

  if (Math.abs(dy) < HORIZONTAL_DELTA_EPSILON || view.zoom <= 1) return { kind: "NONE" };
  const pixels = dy * (input.shiftKey ? SHIFT_PAN_MULTIPLIER : 1);
  return { kind: "PAN", scrollDelta: scrollDeltaForPixels(pixels, view.trackWidth, view.zoom) };
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
export function middlePanScroll(
  session: MiddlePanSession,
  clientX: number,
  trackWidth: number,
  zoom: number,
): number {
  return clampScroll(
    session.startScroll - scrollDeltaForPixels(clientX - session.startX, trackWidth, zoom),
  );
}
