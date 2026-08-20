/**
 * Timeline mouse navigation — pure intent resolution (no React, no DOM).
 */
import { describe, expect, it } from "vitest";

import {
  clampScroll,
  middlePanScroll,
  normalizeWheelDelta,
  resolveTimelineWheel,
  SHIFT_PAN_MULTIPLIER,
  scrollDeltaForPixels,
} from "../timelineNavigation";

const view = { zoom: 8, trackWidth: 1000 };
const base = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };

describe("wheel intent", () => {
  it("keeps Ctrl/Cmd + wheel as zoom, unchanged in both directions", () => {
    const zoomIn = resolveTimelineWheel({ ...base, deltaY: -100, ctrlKey: true }, view);
    const zoomOut = resolveTimelineWheel({ ...base, deltaY: 100, metaKey: true }, view);
    expect(zoomIn.kind).toBe("ZOOM");
    expect(zoomOut.kind).toBe("ZOOM");
    if (zoomIn.kind !== "ZOOM" || zoomOut.kind !== "ZOOM") throw new Error("unreachable");
    expect(zoomIn.zoomFactor).toBeCloseTo(Math.exp(0.15), 6);
    expect(zoomOut.zoomFactor).toBeCloseTo(Math.exp(-0.15), 6);
  });

  it("pans horizontally from a plain vertical wheel", () => {
    const down = resolveTimelineWheel({ ...base, deltaY: 120 }, view);
    const up = resolveTimelineWheel({ ...base, deltaY: -120 }, view);
    if (down.kind !== "PAN" || up.kind !== "PAN") throw new Error("expected pan");
    expect(down.scrollDelta).toBeGreaterThan(0); // later / right
    expect(up.scrollDelta).toBeLessThan(0); // earlier / left
    expect(down.scrollDelta).toBeCloseTo(-up.scrollDelta, 12);
  });

  it("uses deltaX alone when the device reports horizontal travel", () => {
    const horizontalOnly = resolveTimelineWheel({ ...base, deltaX: 60 }, view);
    const both = resolveTimelineWheel({ ...base, deltaX: 60, deltaY: 200 }, view);
    if (horizontalOnly.kind !== "PAN" || both.kind !== "PAN") throw new Error("expected pan");
    expect(both.scrollDelta).toBeCloseTo(horizontalOnly.scrollDelta, 12);
  });

  it("accelerates predictably with Shift", () => {
    const plain = resolveTimelineWheel({ ...base, deltaY: 100 }, view);
    const fast = resolveTimelineWheel({ ...base, deltaY: 100, shiftKey: true }, view);
    if (plain.kind !== "PAN" || fast.kind !== "PAN") throw new Error("expected pan");
    expect(fast.scrollDelta).toBeCloseTo(plain.scrollDelta * SHIFT_PAN_MULTIPLIER, 12);
  });

  it("does nothing when the whole range is visible or the delta is noise", () => {
    expect(resolveTimelineWheel({ ...base, deltaY: 120 }, { ...view, zoom: 1 }).kind).toBe("NONE");
    expect(resolveTimelineWheel({ ...base, deltaY: 0.2 }, view).kind).toBe("NONE");
  });

  it("normalises line and page wheel modes", () => {
    expect(normalizeWheelDelta(3, 1)).toBe(48);
    expect(normalizeWheelDelta(1, 2)).toBe(100);
    expect(normalizeWheelDelta(120, 0)).toBe(120);
  });
});

describe("pan clamping", () => {
  it("never leaves the 0..1 window", () => {
    expect(clampScroll(-4)).toBe(0);
    expect(clampScroll(4)).toBe(1);
    expect(clampScroll(Number.NaN)).toBe(0);
  });

  it("clamps middle-drag pan at both timeline bounds", () => {
    const session = { startX: 500, startScroll: 0.5 };
    expect(middlePanScroll(session, 500, 1000, 8)).toBeCloseTo(0.5, 12);
    expect(middlePanScroll(session, -100000, 1000, 8)).toBe(1);
    expect(middlePanScroll(session, 100000, 1000, 8)).toBe(0);
  });

  it("moves the view opposite to the grab direction", () => {
    const session = { startX: 500, startScroll: 0.5 };
    expect(middlePanScroll(session, 400, 1000, 8)).toBeCloseTo(0.5 + scrollDeltaForPixels(100, 1000, 8), 12);
  });

  it("pans pixel-for-pixel: a full track width of travel moves one window", () => {
    // At zoom z, one window is 1/(z-1) of the hidden range.
    expect(scrollDeltaForPixels(1000, 1000, 11)).toBeCloseTo(0.1, 12);
    expect(scrollDeltaForPixels(1000, 1000, 2)).toBeCloseTo(1, 12);
    expect(scrollDeltaForPixels(1000, 1000, 1)).toBe(0);
  });
});

describe("view-only guarantee", () => {
  it("exposes no project, clip or history surface", () => {
    const intents = [
      resolveTimelineWheel({ ...base, deltaY: 100 }, view),
      resolveTimelineWheel({ ...base, deltaY: 100, ctrlKey: true }, view),
    ];
    for (const intent of intents) {
      expect(Object.keys(intent).every((k) => ["kind", "zoomFactor", "scrollDelta"].includes(k))).toBe(true);
    }
    const session = { startX: 0, startScroll: 0 };
    expect(typeof middlePanScroll(session, 120, 800, 8)).toBe("number");
  });
});
