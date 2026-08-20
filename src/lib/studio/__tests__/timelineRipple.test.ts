/**
 * RIPPLE RESIZE — pure timing cascade. No React, no store, no DOM.
 */
import { describe, expect, it } from "vitest";

import type { TimelineClip } from "@/lib/show/types";
import {
  followingClips,
  hasTimelineOverlap,
  landingIsFinal,
  rippleClipTiming,
} from "../timelineRipple";

function clip(id: string, start: number, transition: number, hold: number, phase?: TimelineClip["phase"]): TimelineClip {
  return {
    id,
    formationId: `f-${id}`,
    start,
    transition,
    hold,
    easing: "minJerk",
    color: [255, 255, 255],
    effect: "solid",
    ...(phase ? { phase } : {}),
  };
}

// take-off, three show scenes with an intentional 2 s gap, landing last.
const timeline: TimelineClip[] = [
  clip("takeoff", 0, 4, 6, "TAKEOFF"),
  clip("a", 10, 3, 7, "SHOW"),
  clip("b", 20, 3, 7, "SHOW"),
  clip("c", 32, 3, 7, "SHOW"), // 2 s gap before it
  clip("landing", 42, 4, 8, "LANDING"),
];

const end = (c: TimelineClip) => c.start + c.transition + c.hold;
const byId = (list: readonly TimelineClip[], id: string) => list.find((c) => c.id === id)!;

describe("ordering", () => {
  it("selects only the chronologically following clips", () => {
    expect(followingClips(timeline, byId(timeline, "b")).map((c) => c.id)).toEqual(["c", "landing"]);
    expect(followingClips(timeline, byId(timeline, "landing")).map((c) => c.id)).toEqual([]);
  });
});

describe("right edge (hold)", () => {
  it("shifts every following clip by +delta and leaves earlier clips untouched", () => {
    const r = rippleClipTiming(timeline, "b", { hold: 12 });
    expect(r.delta).toBe(5);
    expect(byId(r.timeline, "takeoff").start).toBe(0);
    expect(byId(r.timeline, "a").start).toBe(10);
    expect(byId(r.timeline, "b").start).toBe(20);
    expect(byId(r.timeline, "c").start).toBe(37);
    expect(byId(r.timeline, "landing").start).toBe(47);
    expect(hasTimelineOverlap(r.timeline)).toBe(false);
    expect(landingIsFinal(r.timeline)).toBe(true);
  });

  it("shrinking pulls the following clips earlier and preserves relative gaps", () => {
    const r = rippleClipTiming(timeline, "b", { hold: 4 });
    expect(r.delta).toBe(-3);
    expect(byId(r.timeline, "c").start).toBe(29);
    expect(byId(r.timeline, "landing").start).toBe(39);
    // the authored 2 s gap between b and c survives.
    expect(byId(r.timeline, "c").start - end(byId(r.timeline, "b"))).toBe(2);
    expect(hasTimelineOverlap(r.timeline)).toBe(false);
  });

  it("clamps hold at the domain floor without breaking ordering", () => {
    const r = rippleClipTiming(timeline, "b", { hold: -50 });
    expect(byId(r.timeline, "b").hold).toBe(0);
    expect(hasTimelineOverlap(r.timeline)).toBe(false);
  });

  it("is deterministic and composable", () => {
    const once = rippleClipTiming(timeline, "b", { hold: 12 }).timeline;
    const twice = rippleClipTiming(once, "b", { hold: 12 }).timeline;
    expect(rippleClipTiming(timeline, "b", { hold: 12 }).timeline).toEqual(once);
    expect(byId(twice, "landing").start).toBe(47);
  });
});

describe("left edge (transition = formation-ready boundary)", () => {
  it("keeps clip.start and ripples the following clips by the duration change", () => {
    const r = rippleClipTiming(timeline, "b", { transition: 6 });
    expect(byId(r.timeline, "b").start).toBe(20);
    expect(byId(r.timeline, "b").transition).toBe(6);
    expect(r.delta).toBe(3);
    expect(byId(r.timeline, "c").start).toBe(35);
    expect(byId(r.timeline, "landing").start).toBe(45);
    expect(hasTimelineOverlap(r.timeline)).toBe(false);
  });

  it("respects the transition floor", () => {
    expect(byId(rippleClipTiming(timeline, "b", { transition: 0 }).timeline, "b").transition).toBe(0.5);
  });
});

describe("free mode", () => {
  it("edits only the resized clip, allowing intentional overlap", () => {
    const r = rippleClipTiming(timeline, "b", { hold: 30 }, "FREE");
    expect(r.delta).toBe(0);
    expect(byId(r.timeline, "c").start).toBe(32);
    expect(r.changedClipIds).toEqual(["b"]);
    expect(hasTimelineOverlap(r.timeline)).toBe(true);
  });
});

describe("phases", () => {
  it("landing stays final in both directions", () => {
    for (const hold of [0, 1, 20, 60]) {
      const r = rippleClipTiming(timeline, "c", { hold });
      expect(landingIsFinal(r.timeline)).toBe(true);
      expect(hasTimelineOverlap(r.timeline)).toBe(false);
    }
  });

  it("resizing take-off ripples the whole artistic sequence", () => {
    const r = rippleClipTiming(timeline, "takeoff", { hold: 10 });
    expect(r.delta).toBe(4);
    expect(byId(r.timeline, "a").start).toBe(14);
    expect(byId(r.timeline, "landing").start).toBe(46);
  });

  it("never pushes a following clip into negative show time", () => {
    const r = rippleClipTiming(timeline, "takeoff", { hold: 0 });
    expect(Math.min(...r.timeline.map((c) => c.start))).toBeGreaterThanOrEqual(0);
  });

  it("returns the timeline unchanged for a no-op patch", () => {
    const r = rippleClipTiming(timeline, "b", { hold: 7 });
    expect(r.changedClipIds).toEqual([]);
    expect(r.timeline).toEqual(timeline);
  });

  it("ignores an unknown clip id", () => {
    expect(rippleClipTiming(timeline, "nope", { hold: 1 }).changedClipIds).toEqual([]);
  });
});
