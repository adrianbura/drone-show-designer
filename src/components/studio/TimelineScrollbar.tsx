/**
 * TIMELINE VIEWPORT SCROLLBAR (presentation only).
 *
 * The track is the FULL authored time range, the thumb is the visible window:
 * its width is `visibleSpan / authoredSpan` and its position is the current
 * `timelineScroll`. Dragging or clicking writes through the existing
 * `setTimelineScroll` authority only — no project mutation, no history entry
 * and no browser overflow scrolling as a parallel system.
 */
import { useCallback, useRef } from "react";

import { useI18n } from "@/i18n";
import { formatShowTime } from "@/lib/studio/timelineEdit";
import { clampScroll } from "@/lib/studio/timelineNavigation";
import type { TimelineScrollGeometry } from "@/lib/studio/timelineEdit";

interface Props {
  readonly geometry: TimelineScrollGeometry;
  readonly scroll: number;
  readonly setScroll: (scroll: number) => void;
  readonly view: { readonly start: number; readonly end: number };
  readonly decimalComma?: boolean;
}

export default function TimelineScrollbar({ geometry, scroll, setScroll, view, decimalComma }: Props) {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startScroll: number } | null>(null);

  /** Clicking outside the thumb pages exactly one window towards the pointer. */
  const onTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = trackRef.current;
      if (!el || !geometry.scrollable) return;
      const rect = el.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / Math.max(1, rect.width);
      const page = geometry.thumbSize / Math.max(1e-6, 1 - geometry.thumbSize);
      if (fraction < geometry.thumbStart) setScroll(clampScroll(scroll - page));
      else if (fraction > geometry.thumbStart + geometry.thumbSize) setScroll(clampScroll(scroll + page));
    },
    [geometry, scroll, setScroll],
  );

  /**
   * Thumb drag uses window-level listeners so the gesture survives the thumb
   * re-rendering under the cursor (it moves while dragging).
   */
  const onThumbPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!geometry.scrollable) return;
      const session = { startX: e.clientX, startScroll: scroll };
      dragRef.current = session;
      const thumbSize = geometry.thumbSize;
      const move = (ev: PointerEvent) => {
        const el = trackRef.current;
        if (!el) return;
        const width = Math.max(1, el.getBoundingClientRect().width);
        const travel = Math.max(1e-6, 1 - thumbSize);
        setScroll(clampScroll(session.startScroll + (ev.clientX - session.startX) / width / travel));
      };
      const up = () => {
        dragRef.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [geometry.scrollable, geometry.thumbSize, scroll, setScroll],
  );

  return (
    <div className="mx-1 flex shrink-0 items-center gap-2">
      <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">
        {formatShowTime(view.start, decimalComma)}
      </span>
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className="relative h-3.5 min-h-3.5 flex-1 cursor-pointer rounded-full border border-border/70 bg-surface-sunken"
        role="scrollbar"
        aria-orientation="horizontal"
        aria-label={t("timeline.scroll")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(scroll * 100)}
        aria-valuetext={`${formatShowTime(view.start, decimalComma)} – ${formatShowTime(view.end, decimalComma)}`}
        data-testid="timeline-scrollbar"
      >
        {/* Visible bounds of the whole authored range. */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border" />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-border" />
        <div
          onPointerDown={onThumbPointerDown}
          title={`${formatShowTime(view.start, decimalComma)} – ${formatShowTime(view.end, decimalComma)}`}
          data-testid="timeline-scrollbar-thumb"
          className="absolute inset-y-0 min-w-[24px] touch-none rounded-full border border-accent/60 bg-accent/60 shadow-sm transition-colors hover:bg-accent/80 active:bg-accent"
          style={{
            left: `${geometry.thumbStart * 100}%`,
            width: `${geometry.thumbSize * 100}%`,
          }}
        />
      </div>
      <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">
        {formatShowTime(view.end, decimalComma)}
      </span>
    </div>
  );
}

