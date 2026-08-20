import { describe, expect, it } from "vitest";

import { computeTimelineView, zoomAtTime } from "../timelineEdit";

function screenRatio(time: number, view: { start: number; end: number }): number {
  return (time - view.start) / (view.end - view.start);
}

describe("timeline view endpoint contract", () => {
  it("scroll 0 reaches the authored start at any zoom", () => {
    const view = computeTimelineView({ start: -30, end: 570, zoom: 12, scroll: 0 });
    expect(view.start).toBe(-30);
    expect(view.end - view.start).toBeCloseTo(50, 12);
  });

  it("scroll 1 reaches the authored end exactly at any zoom", () => {
    const view = computeTimelineView({ start: -30, end: 570, zoom: 12, scroll: 1 });
    expect(view.end).toBeCloseTo(570, 12);
    expect(view.start).toBeCloseTo(520, 12);
  });

  it("interpolates over hidden range, including negative PRE_SHOW", () => {
    const left = computeTimelineView({ start: -30, end: 570, zoom: 4, scroll: 0 });
    const middle = computeTimelineView({ start: -30, end: 570, zoom: 4, scroll: 0.5 });
    const right = computeTimelineView({ start: -30, end: 570, zoom: 4, scroll: 1 });
    const hiddenRange = (570 - -30) - (570 - -30) / 4;

    expect(middle.start - left.start).toBeCloseTo(hiddenRange / 2, 12);
    expect(right.start - left.start).toBeCloseTo(hiddenRange, 12);
    expect(right.end).toBeCloseTo(570, 12);
  });

  it("clamps out-of-range scroll without losing either endpoint", () => {
    const before = computeTimelineView({ start: 10, end: 210, zoom: 10, scroll: -99 });
    const after = computeTimelineView({ start: 10, end: 210, zoom: 10, scroll: 99 });
    expect(before.start).toBe(10);
    expect(after.end).toBeCloseTo(210, 12);
  });
});

describe("cursor zoom anchor contract", () => {
  it("preserves the anchor screen ratio when boundaries do not clamp it", () => {
    const input = { start: -20, end: 180, zoom: 2, scroll: 0.35 };
    const before = computeTimelineView(input);
    const anchor = before.start + (before.end - before.start) * 0.73;
    const ratioBefore = screenRatio(anchor, before);

    const next = zoomAtTime(anchor, 8, input);
    const after = computeTimelineView({ ...input, ...next });
    const ratioAfter = screenRatio(anchor, after);

    expect(ratioAfter).toBeCloseTo(ratioBefore, 12);
  });

  it("may move the anchor only when authored boundaries force clamping", () => {
    const input = { start: 0, end: 100, zoom: 1, scroll: 0 };
    const next = zoomAtTime(0, 20, input);
    const view = computeTimelineView({ ...input, ...next });
    expect(view.start).toBe(0);
    expect(view.end).toBeCloseTo(5, 12);
  });
});
