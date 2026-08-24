/**
 * TIMELINE POINTER BUTTON CONTRACT.
 *
 * Right click must resolve to the context menu only: no drag gesture, no
 * pointer capture, no project mutation. Primary pointer (mouse left, touch,
 * pen) keeps every existing authoring gesture.
 */
import { describe, expect, it } from "vitest";

import { shouldBeginTimelineGesture } from "../timelineEdit";

describe("shouldBeginTimelineGesture", () => {
  it("accepts the primary mouse button", () => {
    expect(shouldBeginTimelineGesture({ button: 0, isPrimary: true, pointerType: "mouse" })).toBe(true);
  });

  it("rejects right click", () => {
    expect(shouldBeginTimelineGesture({ button: 2, isPrimary: true, pointerType: "mouse" })).toBe(false);
  });

  it("rejects middle click so timeline pan keeps ownership", () => {
    expect(shouldBeginTimelineGesture({ button: 1, isPrimary: true, pointerType: "mouse" })).toBe(false);
  });

  it("accepts primary touch and pen contacts", () => {
    expect(shouldBeginTimelineGesture({ button: 0, isPrimary: true, pointerType: "touch" })).toBe(true);
    expect(shouldBeginTimelineGesture({ button: 0, isPrimary: true, pointerType: "pen" })).toBe(true);
  });

  it("rejects secondary touch contacts (pinch/zoom fingers)", () => {
    expect(shouldBeginTimelineGesture({ button: 0, isPrimary: false, pointerType: "touch" })).toBe(false);
  });

  it("treats an unknown primary flag as primary (jsdom / synthetic events)", () => {
    expect(shouldBeginTimelineGesture({ button: 0 })).toBe(true);
  });
});
