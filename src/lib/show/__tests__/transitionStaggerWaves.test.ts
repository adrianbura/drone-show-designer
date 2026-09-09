import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRANSITION_DESIGN,
  describeTransitionDesign,
  effectiveStagger,
  normalizeTransitionDesign,
  normalizeWaveCount,
  staggerClampInfo,
  staggerStartOffsets,
} from "../transition/design";
import type { Vector3Tuple } from "../types";

/** Ten drones spread along X, so LEFT_RIGHT ranking is strictly increasing. */
const LINE: readonly Vector3Tuple[] = Array.from(
  { length: 10 },
  (_, i) => [i * 5, 30, 0] as Vector3Tuple,
);

describe("departure waves", () => {
  it("quantises the ramp into the requested number of distinct departure times", () => {
    const offsets = staggerStartOffsets(LINE, "LEFT_RIGHT", 4, 40, "linear", 4);
    const distinct = [...new Set(offsets)].sort((a, b) => a - b);
    expect(distinct).toHaveLength(4);
    expect(distinct[0]).toBe(0);
    expect(distinct[3]).toBeCloseTo(4, 6);
  });

  it("keeps every drone of a wave on exactly the same departure time", () => {
    const offsets = staggerStartOffsets(LINE, "LEFT_RIGHT", 4, 40, "linear", 2);
    expect(offsets.slice(0, 5).every((v) => v === offsets[0])).toBe(true);
    expect(offsets.slice(5).every((v) => v === offsets[5])).toBe(true);
  });

  it("is deterministic for identical geometry", () => {
    const a = staggerStartOffsets(LINE, "CENTER_OUT", 3, 30, "smooth", 5);
    const b = staggerStartOffsets(LINE, "CENTER_OUT", 3, 30, "smooth", 5);
    expect(a).toEqual(b);
  });

  it("falls back to the continuous ramp below two waves", () => {
    const continuous = staggerStartOffsets(LINE, "LEFT_RIGHT", 4, 40, "linear", 0);
    expect(staggerStartOffsets(LINE, "LEFT_RIGHT", 4, 40, "linear", 1)).toEqual(continuous);
    expect(new Set(continuous).size).toBe(LINE.length);
  });

  it("normalises wave counts and persists them through the design normaliser", () => {
    expect(normalizeWaveCount(1)).toBe(0);
    expect(normalizeWaveCount(3.4)).toBe(3);
    expect(normalizeWaveCount(99)).toBe(12);
    expect(normalizeWaveCount("x")).toBe(DEFAULT_TRANSITION_DESIGN.waveCount);
    expect(normalizeTransitionDesign({ waveCount: 6 }).waveCount).toBe(6);
    // Legacy projects carry no waveCount: they stay continuous.
    expect(normalizeTransitionDesign({ mode: "STAGGERED" }).waveCount).toBe(0);
  });

  it("mentions waves in the designer summary only when they are active", () => {
    const base = normalizeTransitionDesign({ mode: "STAGGERED", totalStagger: 3 });
    expect(describeTransitionDesign(base)).not.toContain("WAVES");
    expect(describeTransitionDesign({ ...base, waveCount: 4 })).toContain("4 WAVES");
  });
});

describe("scheduler stagger bound", () => {
  it("reports the transition duration required to fly the requested stagger", () => {
    const design = normalizeTransitionDesign({ mode: "STAGGERED", totalStagger: 6 });
    const info = staggerClampInfo(design, 8);
    expect(info.requested).toBe(6);
    expect(info.effective).toBe(4);
    expect(info.clamped).toBe(true);
    expect(info.requiredTransitionDuration).toBe(12);
  });

  it("reports no clamping once the transition is long enough", () => {
    const design = normalizeTransitionDesign({ mode: "STAGGERED", totalStagger: 6 });
    const info = staggerClampInfo(design, 12);
    expect(info.effective).toBe(6);
    expect(info.clamped).toBe(false);
  });

  it("never exceeds half the transition, waves included", () => {
    expect(effectiveStagger(9, 6)).toBe(3);
    const offsets = staggerStartOffsets(LINE, "LEFT_RIGHT", 9, 6, "linear", 4);
    expect(Math.max(...offsets)).toBeCloseTo(3, 6);
  });
});
