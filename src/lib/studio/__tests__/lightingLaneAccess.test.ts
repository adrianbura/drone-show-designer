/**
 * LIGHTING LANE VERTICAL ACCESSIBILITY — pure scroll math only. No DOM, no
 * pixel snapshots. Guarantees a selected effect can always be brought into the
 * visible lane window without touching timeline time or zoom.
 */
import { describe, expect, it } from "vitest";

import { hiddenLaneCount, laneScrollTop } from "../lightingTimeline";

const LANE = 22;

describe("laneScrollTop", () => {
  it("keeps the offset when the lane is already visible", () => {
    expect(laneScrollTop({ laneIndex: 1, laneHeight: LANE, scrollTop: 0, viewportHeight: 66 })).toBe(0);
  });

  it("scrolls down just enough to reveal a lane below the window", () => {
    expect(
      laneScrollTop({ laneIndex: 4, laneHeight: LANE, scrollTop: 0, viewportHeight: 66, padding: 4 }),
    ).toBe(4 * LANE + LANE + 4 - 66);
  });

  it("scrolls up to the lane top when the lane is above the window", () => {
    expect(laneScrollTop({ laneIndex: 1, laneHeight: LANE, scrollTop: 80, viewportHeight: 66 })).toBe(LANE);
  });

  it("never returns a negative offset", () => {
    expect(
      laneScrollTop({ laneIndex: 0, laneHeight: LANE, scrollTop: 0, viewportHeight: 8, padding: 4 }),
    ).toBeGreaterThanOrEqual(0);
  });

  it("is a no-op for degenerate geometry", () => {
    expect(laneScrollTop({ laneIndex: 2, laneHeight: 0, scrollTop: 12, viewportHeight: 66 })).toBe(12);
    expect(laneScrollTop({ laneIndex: 2, laneHeight: LANE, scrollTop: 12, viewportHeight: 0 })).toBe(12);
    expect(laneScrollTop({ laneIndex: NaN, laneHeight: LANE, scrollTop: 7, viewportHeight: 66 })).toBe(7);
  });

  it("is idempotent — scrolling twice lands on the same offset", () => {
    const once = laneScrollTop({ laneIndex: 6, laneHeight: LANE, scrollTop: 0, viewportHeight: 66 });
    const twice = laneScrollTop({ laneIndex: 6, laneHeight: LANE, scrollTop: once, viewportHeight: 66 });
    expect(twice).toBe(once);
  });
});

describe("hiddenLaneCount", () => {
  it("reports lanes beyond the visible window", () => {
    expect(hiddenLaneCount(5, 3)).toBe(2);
    expect(hiddenLaneCount(3, 3)).toBe(0);
    expect(hiddenLaneCount(1, 3)).toBe(0);
  });

  it("tolerates nonsense input", () => {
    expect(hiddenLaneCount(NaN, 3)).toBe(0);
    expect(hiddenLaneCount(4, NaN)).toBe(0);
  });
});
