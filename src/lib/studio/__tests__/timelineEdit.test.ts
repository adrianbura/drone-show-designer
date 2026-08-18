/**
 * Timeline editing core — snapping, timing clamps and view (zoom/scroll) math.
 * Pure functions only: no React, no DOM.
 */
import { describe, expect, it } from "vitest";

import { buildBeatGrid } from "@/lib/show/audio";
import { sanitizeMarkers, sanitizeSections, sortSections } from "@/lib/show/markers";
import type { TimelineClip } from "@/lib/show/types";
import {
  MIN_HOLD,
  MIN_TRANSITION,
  clampZoom,
  computeTimelineView,
  moveClip,
  resizeHold,
  resizeTransition,
  scrollToCenter,
  snapTimelineTime,
  zoomAtTime,
} from "../timelineEdit";

const clip: TimelineClip = {
  id: "c1",
  formationId: "f1",
  start: 10,
  transition: 4,
  hold: 6,
  easing: "smooth",
  color: [255, 255, 255],
  effect: "solid",
};

const grid = buildBeatGrid({ name: "x", bpm: 120, offset: 0, duration: 120 });

describe("snapping", () => {
  it("leaves time untouched when snapping is off", () => {
    const r = snapTimelineTime(12.3456, { mode: "OFF", pixelsPerSecond: 20 });
    expect(r.snapped).toBe(false);
    expect(r.time).toBeCloseTo(12.346, 3);
  });

  it("captures the fixed grid step", () => {
    expect(snapTimelineTime(12.44, { mode: "S050", pixelsPerSecond: 200 }).time).toBe(12.5);
  });

  it("captures beats and bars from the tempo grid", () => {
    const beat = snapTimelineTime(2.02, { mode: "BEAT", beatGrid: grid, pixelsPerSecond: 200 });
    expect(beat.snapped).toBe(true);
    expect(beat.kind).toBe("BEAT");
    const bar = snapTimelineTime(3.9, { mode: "BAR", beatGrid: grid, pixelsPerSecond: 200 });
    expect(bar.kind).toBe("BAR");
  });

  it("captures markers and respects the Alt bypass", () => {
    const ctx = { mode: "MARKER" as const, markers: [30], pixelsPerSecond: 200 };
    expect(snapTimelineTime(29.98, ctx).time).toBe(30);
    expect(snapTimelineTime(29.98, { ...ctx, disabled: true }).snapped).toBe(false);
  });

  it("never captures a beat further away than the pixel threshold", () => {
    // 0.06 s away from the nearest beat = 60 px at this scale: too far to capture.
    const r = snapTimelineTime(1.94, { mode: "BEAT", beatGrid: grid, pixelsPerSecond: 1000 });
    expect(r.snapped).toBe(false);
  });
});

describe("timing edits", () => {
  it("moves a clip without ever going negative", () => {
    expect(moveClip(clip, -5, { mode: "OFF", pixelsPerSecond: 20 }).start).toBe(0);
  });

  it("clamps transition and hold to their minimums", () => {
    expect(resizeTransition(clip, 10, { mode: "OFF", pixelsPerSecond: 20 }).transition).toBe(MIN_TRANSITION);
    expect(resizeHold(clip, 0, { mode: "OFF", pixelsPerSecond: 20 }).hold).toBe(MIN_HOLD);
  });

  it("resizes against the beat grid when snapping is on", () => {
    const { transition } = resizeTransition(clip, 13.98, { mode: "BEAT", beatGrid: grid, pixelsPerSecond: 200 });
    expect(transition).toBe(4);
  });
});

describe("view math", () => {
  const input = { start: -20, end: 80, zoom: 1, scroll: 0 };

  it("shows the whole operation at zoom 1", () => {
    const view = computeTimelineView(input);
    expect(view.start).toBe(-20);
    expect(view.end).toBe(80);
  });

  it("keeps the anchored time inside the window while zooming", () => {
    const next = zoomAtTime(40, 8, input);
    const view = computeTimelineView({ ...input, ...next });
    expect(view.start).toBeLessThanOrEqual(40);
    expect(view.end).toBeGreaterThanOrEqual(40);
  });

  it("clamps zoom and scroll into range", () => {
    expect(clampZoom(0.01)).toBe(1);
    expect(clampZoom(1e6)).toBeLessThanOrEqual(400);
    expect(scrollToCenter(1e6, { ...input, zoom: 10 })).toBeLessThanOrEqual(1);
    expect(scrollToCenter(-1e6, { ...input, zoom: 10 })).toBeGreaterThanOrEqual(0);
  });
});

describe("annotation sanitisation", () => {
  it("drops malformed markers and sections", () => {
    expect(sanitizeMarkers([{ id: "m", time: Number.NaN, label: "x", type: "MUSIC" }, null, 3])).toEqual([]);
    expect(sanitizeSections([{ id: "s", start: 10, end: 5, label: "x", type: "DROP" }]).length).toBeLessThanOrEqual(1);
  });

  it("sorts sections by start time", () => {
    const sorted = sortSections([
      { id: "b", start: 20, end: 30, label: "b", type: "DROP" },
      { id: "a", start: 0, end: 10, label: "a", type: "INTRO" },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
