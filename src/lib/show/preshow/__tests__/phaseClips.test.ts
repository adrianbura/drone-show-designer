/**
 * AUTOMATIC PHASE CLIPS are pure timeline maths. These tests pin the canonical
 * contract: TAKEOFF is first at t = 0, LANDING is last, the authored body keeps
 * its order and relative spacing, and durations come from the project's own
 * altitudes and flight envelope (no new safety rule is invented).
 */
import { describe, expect, it } from "vitest";

import { createDefaultProject } from "@/lib/show/defaultProject";
import type { TimelineClip } from "@/lib/show/types";
import {
  defaultLandingParams,
  defaultTakeoffParams,
  hasPhaseClip,
  suggestVerticalDuration,
  withLandingClip,
  withTakeoffClip,
} from "@/lib/show/preshow/phaseClips";

function clip(part: Partial<TimelineClip>): TimelineClip {
  return {
    id: "c1",
    formationId: "f1",
    start: 0,
    transition: 8,
    hold: 6,
    easing: "minJerk",
    color: [255, 255, 255],
    effect: "solid",
    phase: "SHOW",
    ...part,
  } as TimelineClip;
}

describe("suggestVerticalDuration", () => {
  it("derives the duration from altitude and the authored maximum velocity", () => {
    expect(suggestVerticalDuration(40, 5)).toBe(20);
  });

  it("never suggests less than four seconds", () => {
    expect(suggestVerticalDuration(1, 8)).toBe(4);
  });
});

describe("withTakeoffClip", () => {
  it("puts the take-off first and shifts the body forward by its length", () => {
    const body = [clip({ id: "a", start: 0 }), clip({ id: "b", start: 14 })];
    const next = withTakeoffClip(body, { id: "t", formationId: "f1" }, {
      transition: 10,
      hold: 4,
    });
    expect(next[0]!.id).toBe("t");
    expect(next[0]!.phase).toBe("TAKEOFF");
    expect(next[0]!.start).toBe(0);
    expect(next[1]!.start).toBe(14);
    expect(next[2]!.start).toBe(28);
  });

  it("clamps a non-positive transition so a climb-out can never be instant", () => {
    const next = withTakeoffClip([], { id: "t", formationId: "f1" }, { transition: 0, hold: -3 });
    expect(next[0]!.transition).toBe(0.5);
    expect(next[0]!.hold).toBe(0);
  });
});

describe("withLandingClip", () => {
  it("appends the landing after the whole authored body", () => {
    const body = [clip({ id: "a", start: 0, transition: 8, hold: 6 })];
    const next = withLandingClip(body, { id: "l", formationId: "f1" }, {
      transition: 12,
      hold: 2,
    });
    expect(next).toHaveLength(2);
    expect(next[1]!.phase).toBe("LANDING");
    expect(next[1]!.start).toBe(14);
  });
});

describe("project defaults", () => {
  it("reads the durations from the project altitudes and limits", () => {
    const project = createDefaultProject(50);
    expect(defaultTakeoffParams(project).transition).toBe(
      suggestVerticalDuration(project.altitudes.takeoff, project.limits.maxVelocity),
    );
    expect(defaultLandingParams(project).transition).toBe(
      suggestVerticalDuration(project.altitudes.show, project.limits.maxVelocity),
    );
  });

  it("reports which phases the timeline already has", () => {
    const timeline = [clip({ phase: "TAKEOFF" })];
    expect(hasPhaseClip(timeline, "TAKEOFF")).toBe(true);
    expect(hasPhaseClip(timeline, "LANDING")).toBe(false);
  });
});
