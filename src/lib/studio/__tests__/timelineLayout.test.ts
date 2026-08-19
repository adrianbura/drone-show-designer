import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../../show/defaultProject";
import type { TimelineClip } from "../../show/types";
import { packTimelineClipLanes, timelineContentRange } from "../timelineLayout";

function clip(id: string, start: number, transition: number, hold: number): TimelineClip {
  return {
    id,
    formationId: "formation-1",
    start,
    transition,
    hold,
    easing: "minJerk",
    color: [255, 255, 255],
    effect: "solid",
    phase: "SHOW",
  };
}

describe("adaptive timeline content range", () => {
  it("extends to authored markers and music sections", () => {
    const project = createDefaultProject(12);
    project.timeline = [clip("c1", 0, 2, 3)];
    project.markers = [{ id: "m1", time: -4, label: "pre", type: "GENERAL" }];
    project.musicSections = [{ id: "s1", start: 8, end: 18, label: "Outro", type: "CUSTOM" }];
    expect(timelineContentRange(project, -2)).toEqual({ start: -4, end: 18 });
  });

  it("includes an attached audio file on either side of show zero", () => {
    const project = createDefaultProject(12);
    project.timeline = [];
    project.audio = { ...project.audio, attached: true, offset: -3.5, duration: 12 };
    expect(timelineContentRange(project, 0)).toEqual({ start: -3.5, end: 8.5 });
  });

  it("includes canonically anchored lighting effect timing", () => {
    const project = createDefaultProject(12);
    project.timeline = [clip("c1", 10, 4, 6)];
    project.lighting = {
      schemaVersion: 1,
      effects: [
        {
          id: "fx1",
          target: { kind: "SCENE", clipId: "c1" },
          type: "FADE_OUT",
          anchor: "SCENE_END",
          start: 2,
          duration: 5,
          parameters: {},
          blendMode: "REPLACE",
          priority: 0,
          enabled: true,
        },
      ],
    };
    // Scene ends at 20, effect begins at 22 and ends at 27.
    expect(timelineContentRange(project, 0)).toEqual({ start: 0, end: 27 });
  });

  it("keeps a usable range for an empty project", () => {
    const project = createDefaultProject(12);
    project.timeline = [];
    project.markers = [];
    project.musicSections = [];
    project.audio = { ...project.audio, attached: false };
    expect(timelineContentRange(project, 0)).toEqual({ start: 0, end: 1 });
  });
});

describe("adaptive timeline lane packing", () => {
  it("keeps sequential clips in one lane", () => {
    const layout = packTimelineClipLanes([
      clip("a", 0, 1, 2),
      clip("b", 3, 1, 1),
      clip("c", 5, 1, 2),
    ]);
    expect(layout.laneCount).toBe(1);
    expect(layout.laneByClipId).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("adds only as many lanes as simultaneous overlaps require", () => {
    const layout = packTimelineClipLanes([
      clip("a", 0, 1, 9),
      clip("b", 1, 1, 7),
      clip("c", 2, 1, 5),
      clip("d", 10, 1, 1),
    ]);
    expect(layout.laneCount).toBe(3);
    expect(layout.laneByClipId.a).toBe(0);
    expect(layout.laneByClipId.b).toBe(1);
    expect(layout.laneByClipId.c).toBe(2);
    expect(layout.laneByClipId.d).toBe(0);
  });

  it("is deterministic regardless of input order", () => {
    const a = clip("a", 0, 1, 5);
    const b = clip("b", 0, 1, 5);
    const c = clip("c", 6, 1, 1);
    expect(packTimelineClipLanes([a, b, c])).toEqual(packTimelineClipLanes([c, b, a]));
  });
});
