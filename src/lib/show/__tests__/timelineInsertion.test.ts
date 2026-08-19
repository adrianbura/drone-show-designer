import { describe, expect, it } from "vitest";

import type { TimelineClip } from "../types";
import { authoredClipSpan, insertBeforeLanding, timelineBodyEnd } from "../timelineInsertion";

const clip = (
  id: string,
  start: number,
  transition: number,
  hold: number,
  phase: TimelineClip["phase"] = "SHOW",
): TimelineClip => ({
  id,
  formationId: `f-${id}`,
  start,
  transition,
  hold,
  easing: "minJerk",
  color: [100, 150, 200],
  effect: "solid",
  phase,
});

describe("timeline insertion", () => {
  it("computes authored span defensively", () => {
    expect(authoredClipSpan(clip("a", 0, 3, 4))).toBe(7);
    expect(authoredClipSpan(clip("b", 0, -3, 4))).toBe(4);
    expect(authoredClipSpan(clip("c", 0, -3, -4))).toBe(0);
  });

  it("uses the latest non-LANDING authored end", () => {
    const timeline = [
      clip("a", 0, 2, 3, "TAKEOFF"),
      clip("b", 10, 4, 6, "SHOW"),
      clip("land", 30, 4, 2, "LANDING"),
    ];
    expect(timelineBodyEnd(timeline)).toBe(20);
  });

  it("treats a legacy clip with an absent phase as authored body content", () => {
    const legacy = { ...clip("legacy", 12, 2, 5) };
    delete legacy.phase;
    const timeline: TimelineClip[] = [legacy, clip("landing", 30, 3, 2, "LANDING")];

    expect(timelineBodyEnd(timeline)).toBe(19);
    expect(insertBeforeLanding(timeline, clip("new", 0, 1, 2)).clip.start).toBe(19);
  });

  it("inserts before LANDING and shifts LANDING by exactly the inserted span", () => {
    const timeline = [
      clip("takeoff", 0, 4, 4, "TAKEOFF"),
      clip("show", 8, 3, 7, "SHOW"),
      clip("landing", 18, 5, 2, "LANDING"),
    ];
    const sourceLandingStart = timeline[2]!.start;
    const candidate = clip("new", 999, 2, 6, "SHOW");

    const result = insertBeforeLanding(timeline, candidate);

    expect(result.clip.start).toBe(18);
    expect(result.timeline.map((item) => item.id)).toEqual(["takeoff", "show", "new", "landing"]);
    expect(result.timeline.at(-1)?.phase).toBe("LANDING");
    expect(result.timeline.at(-1)?.start).toBe(sourceLandingStart + 8);
    expect(timeline[2]!.start).toBe(sourceLandingStart);
  });

  it("returns fresh timeline objects without mutating the candidate clip", () => {
    const timeline = [clip("show", 0, 2, 3), clip("landing", 5, 2, 2, "LANDING")];
    const candidate = clip("new", 999, 1, 4);

    const result = insertBeforeLanding(timeline, candidate);

    expect(candidate.start).toBe(999);
    expect(result.clip).not.toBe(candidate);
    expect(result.timeline).not.toBe(timeline);
    expect(result.timeline.find((item) => item.id === "landing")).not.toBe(timeline[1]);
  });

  it("keeps repeated insertions deterministic and LANDING final", () => {
    const initial = [
      clip("takeoff", 0, 2, 3, "TAKEOFF"),
      clip("landing", 5, 3, 2, "LANDING"),
    ];

    const first = insertBeforeLanding(initial, clip("one", 0, 1, 4, "SHOW"));
    const second = insertBeforeLanding(first.timeline, clip("two", 0, 2, 3, "SHOW"));

    expect(second.timeline.map((item) => item.id)).toEqual(["takeoff", "one", "two", "landing"]);
    expect(second.timeline.at(-1)?.phase).toBe("LANDING");
    expect(second.timeline.at(-1)?.start).toBe(15);
    expect(second.timeline.find((item) => item.id === "one")?.start).toBe(5);
    expect(second.timeline.find((item) => item.id === "two")?.start).toBe(10);
  });

  it("does not treat PRE_SHOW as LANDING", () => {
    const timeline = [
      clip("pre", -12, 2, 5, "PRE_SHOW"),
      clip("show", 0, 2, 4, "SHOW"),
      clip("landing", 6, 2, 2, "LANDING"),
    ];

    const result = insertBeforeLanding(timeline, clip("new", 0, 1, 3, "SHOW"));

    expect(result.clip.start).toBe(6);
    expect(result.timeline.at(-1)?.start).toBe(10);
  });

  it("places the first authored clip at show time zero when only PRE_SHOW is negative", () => {
    const timeline = [clip("pre", -20, 4, 8, "PRE_SHOW")];
    const result = insertBeforeLanding(timeline, clip("first", 123, 2, 4, "TAKEOFF"));

    expect(result.clip.start).toBe(0);
    expect(result.timeline.map((item) => item.id)).toEqual(["pre", "first"]);
  });
});
