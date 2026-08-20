/**
 * FULL-RANGE NAVIGATION — every authored moment must stay reachable at any zoom.
 * Pure view math only: no React, no DOM, no project mutation.
 */
import { describe, expect, it } from "vitest";

import {
  computeTimelineView,
  preserveScrollAcrossRange,
  scrollForViewStart,
  scrollFromThumbPosition,
  timelineScrollGeometry,
  zoomAtTime,
} from "../timelineEdit";
import { middlePanScroll, resolveTimelineWheel, scrollDeltaForPixels } from "../timelineNavigation";

const range = { start: -30, end: 570 }; // negative PRE_SHOW + long show

describe("view range", () => {
  it("shows the whole authored range at zoom 1", () => {
    const view = computeTimelineView({ ...range, zoom: 1, scroll: 0 });
    expect(view.start).toBe(range.start);
    expect(view.end).toBeCloseTo(range.end, 9);
  });

  it("reaches the authored start at scroll 0 and the authored end at scroll 1", () => {
    for (const zoom of [2, 10, 47.5, 400]) {
      const left = computeTimelineView({ ...range, zoom, scroll: 0 });
      const right = computeTimelineView({ ...range, zoom, scroll: 1 });
      expect(left.start).toBeCloseTo(range.start, 9);
      expect(right.end).toBeCloseTo(range.end, 9);
    }
  });

  it("interpolates across the hidden range only", () => {
    const zoom = 10;
    const geo = timelineScrollGeometry({ ...range, zoom, scroll: 0.5 });
    expect(geo.visibleSpan).toBeCloseTo(600 / 10, 9);
    expect(geo.maxPan).toBeCloseTo(600 - 60, 9);
    const mid = computeTimelineView({ ...range, zoom, scroll: 0.5 });
    expect(mid.start).toBeCloseTo(range.start + geo.maxPan * 0.5, 9);
    expect(mid.end - mid.start).toBeCloseTo(geo.visibleSpan, 9);
  });

  it("keeps every authored time reachable by some scroll value", () => {
    const zoom = 25;
    for (const target of [-30, -1, 0, 123.4, 569.9, 570]) {
      const scroll = scrollForViewStart(target - 5, { ...range, zoom, scroll: 0 });
      const view = computeTimelineView({ ...range, zoom, scroll });
      expect(target).toBeGreaterThanOrEqual(view.start - 1e-6);
      expect(target).toBeLessThanOrEqual(view.end + 1e-6);
    }
  });
});

describe("scrollbar geometry", () => {
  it("fills the track at zoom 1 and narrows as zoom grows", () => {
    expect(timelineScrollGeometry({ ...range, zoom: 1, scroll: 0 }).thumbSize).toBe(1);
    expect(timelineScrollGeometry({ ...range, zoom: 1, scroll: 0 }).scrollable).toBe(false);
    const ten = timelineScrollGeometry({ ...range, zoom: 10, scroll: 0 });
    expect(ten.thumbSize).toBeCloseTo(0.1, 9);
    expect(ten.scrollable).toBe(true);
    expect(timelineScrollGeometry({ ...range, zoom: 40, scroll: 0 }).thumbSize).toBeLessThan(ten.thumbSize);
  });

  it("places the thumb inside the track at both extremes", () => {
    const left = timelineScrollGeometry({ ...range, zoom: 8, scroll: 0 });
    const right = timelineScrollGeometry({ ...range, zoom: 8, scroll: 1 });
    expect(left.thumbStart).toBe(0);
    expect(right.thumbStart + right.thumbSize).toBeCloseTo(1, 9);
  });

  it("maps a track position back to a scroll fraction", () => {
    const input = { ...range, zoom: 4, scroll: 0 };
    expect(scrollFromThumbPosition(0, input)).toBe(0);
    expect(scrollFromThumbPosition(1, input)).toBe(1);
    expect(scrollFromThumbPosition(0.5, input)).toBeCloseTo(0.5, 9);
  });
});

describe("zoom anchor", () => {
  it("keeps the anchored show time under the cursor", () => {
    const input = { ...range, zoom: 4, scroll: 0.3 };
    const before = computeTimelineView(input);
    const anchor = before.start + (before.end - before.start) * 0.42;
    const next = zoomAtTime(anchor, 16, input);
    const after = computeTimelineView({ ...input, ...next });
    const ratio = (anchor - after.start) / (after.end - after.start);
    expect(ratio).toBeCloseTo(0.42, 6);
  });

  it("clamps at the authored boundaries instead of leaving the range", () => {
    const input = { ...range, zoom: 2, scroll: 0 };
    const next = zoomAtTime(range.start, 20, input);
    const view = computeTimelineView({ ...input, ...next });
    expect(view.start).toBeCloseTo(range.start, 9);
    expect(next.scroll).toBe(0);
  });
});

describe("content range growth while zoomed", () => {
  it("preserves zoom and the viewed window, never jumping to scroll 0", () => {
    const previous = { ...range, zoom: 10, scroll: 0.5 };
    const viewed = computeTimelineView(previous);
    const grown = { start: -30, end: 900 };
    const scroll = preserveScrollAcrossRange(previous, grown);
    const view = computeTimelineView({ ...grown, zoom: 10, scroll });
    expect(scroll).toBeGreaterThan(0);
    expect(view.start).toBeCloseTo(viewed.start, 6);
  });

  it("clamps when the old window no longer fits the new range", () => {
    const previous = { ...range, zoom: 10, scroll: 1 };
    const shrunk = { start: -30, end: 120 };
    const scroll = preserveScrollAcrossRange(previous, shrunk);
    expect(scroll).toBeLessThanOrEqual(1);
    const view = computeTimelineView({ ...shrunk, zoom: 10, scroll });
    expect(view.end).toBeLessThanOrEqual(shrunk.end + 1e-9);
  });
});

describe("gesture panning reaches both ends", () => {
  const base = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };

  it("wheel panning walks from the authored start to the authored end", () => {
    const zoom = 12;
    let scroll = 0;
    for (let i = 0; i < 2000; i++) {
      const intent = resolveTimelineWheel({ ...base, deltaY: 120 }, { zoom, trackWidth: 1000 });
      if (intent.kind !== "PAN") break;
      scroll = Math.min(1, Math.max(0, scroll + intent.scrollDelta));
      if (scroll >= 1) break;
    }
    expect(scroll).toBe(1);
    expect(computeTimelineView({ ...range, zoom, scroll }).end).toBeCloseTo(range.end, 9);

    for (let i = 0; i < 2000 && scroll > 0; i++) {
      const intent = resolveTimelineWheel({ ...base, deltaX: -60 }, { zoom, trackWidth: 1000 });
      if (intent.kind !== "PAN") break;
      scroll = Math.min(1, Math.max(0, scroll + intent.scrollDelta));
    }
    expect(scroll).toBe(0);
    expect(computeTimelineView({ ...range, zoom, scroll }).start).toBeCloseTo(range.start, 9);
  });

  it("middle-drag pan clamps exactly at both bounds", () => {
    const session = { startX: 400, startScroll: 0.5 };
    expect(middlePanScroll(session, -99999, 1000, 12)).toBe(1);
    expect(middlePanScroll(session, 99999, 1000, 12)).toBe(0);
  });

  it("pans one visible window per track width of travel", () => {
    const zoom = 6;
    const perWidth = scrollDeltaForPixels(1000, 1000, zoom);
    const geo = timelineScrollGeometry({ ...range, zoom, scroll: 0 });
    expect(perWidth * geo.maxPan).toBeCloseTo(geo.visibleSpan, 6);
  });
});
