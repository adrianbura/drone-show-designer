/**
 * TIMELINE REFERENTIAL INTEGRITY — pure clip-deletion cascade.
 *
 * A clip owns its composed scene, its participation override and every lighting
 * effect targeting it. Deleting the clip deletes exactly that unit and never
 * cascades into reusable assets (formations, dynamic formations, SVG sources).
 */
import { describe, expect, it } from "vitest";

import { AUTHORABLE_CLIP_PHASES } from "@/lib/studio/timelineEdit";
import { createDefaultProject } from "../defaultProject";
import { validateTimelineStructure } from "../fullshow/timeline";
import type { LightingEffectInstance, LightingTarget } from "../lighting/types";
import { sceneForClip } from "../scene";
import { nextSelectedClipId, removeTimelineClipReferences } from "../timeline";
import type { ShowProject, TimelineClip } from "../types";

function clip(id: string, start: number, extra: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    formationId: "f-grid",
    start,
    transition: 4,
    hold: 6,
    easing: "smooth",
    color: [255, 255, 255],
    effect: "solid",
    phase: "SHOW",
    ...extra,
  };
}

function effect(id: string, target: LightingTarget): LightingEffectInstance {
  return {
    id,
    target,
    type: "FADE_IN",
    anchor: "SCENE_START",
    start: 0,
    duration: 2,
    parameters: {},
    blendMode: "REPLACE",
    priority: 0,
    enabled: true,
  };
}

function buildProject(): ShowProject {
  const base = createDefaultProject(60);
  const formations = base.formations.map((f, i) => ({ ...f, id: i === 0 ? "f-grid" : f.id }));
  const timeline = [clip("c1", 0, { phase: "TAKEOFF" }), clip("c2", 20), clip("c3", 40)];
  const withTimeline: ShowProject = { ...base, formations, timeline };
  const scenes = [sceneForClip(withTimeline, timeline[1]!), sceneForClip(withTimeline, timeline[2]!)];
  const objectId = scenes[0]!.objects[0]!.id;

  return {
    ...withTimeline,
    scenes,
    participation: {
      defaultPolicy: "SMART_PREPARE",
      reserveZone: { center: [0, 20, -40], orientationDeg: 0, spacing: 5, layout: "GRID" },
      reserveLighting: "OFF",
      lookAheadScenes: 2,
      clips: { c2: { policy: "RESERVE_FORMATION" }, c3: { policy: "HOLD_CURRENT" } },
    },
    lighting: {
      schemaVersion: 1,
      effects: [
        effect("fx1", { kind: "SCENE", clipId: "c2" }),
        effect("fx2", { kind: "SCENE_OBJECT", clipId: "c2", instanceId: objectId }),
        effect("fx5", { kind: "SCENE", clipId: "c3" }),
      ],
    },
  };
}

describe("removeTimelineClipReferences", () => {
  it("A. removes an ordinary clip from the timeline without mutating the input", () => {
    const project = buildProject();
    const next = removeTimelineClipReferences(project, "c1");
    expect(next.timeline.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(project.timeline).toHaveLength(3);
  });

  it("B. removes the composed scene but keeps formation assets", () => {
    const project = buildProject();
    const next = removeTimelineClipReferences(project, "c2");
    expect(next.scenes?.map((s) => s.id)).toEqual(["c3"]);
    expect(next.formations).toEqual(project.formations);
    expect(next.dynamicFormations).toEqual(project.dynamicFormations);
  });

  it("C. removes only that participation override and keeps global settings", () => {
    const project = buildProject();
    const next = removeTimelineClipReferences(project, "c2");
    expect(Object.keys(next.participation!.clips!)).toEqual(["c3"]);
    expect(next.participation!.defaultPolicy).toBe("SMART_PREPARE");
    expect(next.participation!.lookAheadScenes).toBe(2);
    expect(next.participation!.reserveZone).toEqual(project.participation!.reserveZone);
  });

  it("D. removes every lighting effect of the clip regardless of target kind", () => {
    const next = removeTimelineClipReferences(buildProject(), "c2");
    expect(next.lighting!.effects.map((e) => e.id)).toEqual(["fx5"]);
  });

  it("E. leaves unrelated project data deep-equal", () => {
    const project = buildProject();
    const next = removeTimelineClipReferences(project, "c2");
    const strip = ({ timeline, scenes, participation, lighting, ...rest }: ShowProject) => rest;
    expect(strip(next)).toEqual(strip(project));
  });

  it("is a no-op for an unknown clip id", () => {
    const project = buildProject();
    const next = removeTimelineClipReferences(project, "nope");
    expect(next.timeline).toEqual(project.timeline);
    expect(next.lighting).toEqual(project.lighting);
    expect(next.scenes).toEqual(project.scenes);
  });

  it("F/G. undo restores the whole unit and redo removes it identically", () => {
    const before = buildProject();
    const after = removeTimelineClipReferences(before, "c2");
    expect(before.timeline.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(before.scenes?.map((s) => s.id)).toContain("c2");
    expect(before.lighting!.effects).toHaveLength(3);
    expect(removeTimelineClipReferences(before, "c2")).toEqual(after);
  });
});

describe("nextSelectedClipId", () => {
  it("picks the nearest surviving clip in show time", () => {
    const remaining = [clip("c1", 0), clip("c3", 40)];
    expect(nextSelectedClipId(remaining, clip("c2", 36))).toBe("c3");
    expect(nextSelectedClipId(remaining, clip("c2", 4))).toBe("c1");
  });

  it("falls back to the first clip, then to null", () => {
    expect(nextSelectedClipId([clip("c9", 12)], undefined)).toBe("c9");
    expect(nextSelectedClipId([], clip("c2", 20))).toBeNull();
  });
});

describe("phase authoring invariants", () => {
  it("J. never offers PRE_SHOW as an authorable clip phase", () => {
    expect(AUTHORABLE_CLIP_PHASES).toEqual(["TAKEOFF", "SHOW", "LANDING"]);
    expect(AUTHORABLE_CLIP_PHASES).not.toContain("PRE_SHOW");
  });

  it("K. does not silently repair invalid phase order — the validator reports it", () => {
    const base = buildProject();
    const project: ShowProject = {
      ...base,
      timeline: [clip("c1", 0, { phase: "LANDING" }), clip("c2", 20, { phase: "TAKEOFF" })],
      scenes: [],
      lighting: { schemaVersion: 1, effects: [] },
    };
    expect(project.timeline.map((c) => c.phase)).toEqual(["LANDING", "TAKEOFF"]);
    expect(validateTimelineStructure(project).issues.length).toBeGreaterThan(0);
  });
});
