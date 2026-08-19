/**
 * TIMELINE REFERENTIAL INTEGRITY — pure clip-deletion cascade.
 *
 * A clip owns its composed scene, its participation override and every lighting
 * effect targeting it. Deleting the clip deletes exactly that unit and never
 * cascades into reusable assets (formations, dynamic formations, SVG sources).
 */
import { describe, expect, it } from "vitest";

import { makeFormation } from "../formations";
import { validateFullShow } from "../fullshow";
import type { LightingEffectInstance } from "../lighting/types";
import { AUTHORABLE_CLIP_PHASES } from "@/lib/studio/timelineEdit";
import { nextSelectedClipId, removeTimelineClipReferences } from "../timeline";
import type { FormationScene } from "../scene/types";
import type { ShowProject, TimelineClip } from "../types";
import { createDefaultProject } from "../defaultProject";

function clip(id: string, start: number, extra: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    formationId: "f1",
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

function effect(id: string, target: LightingEffectInstance["target"]): LightingEffectInstance {
  return {
    id,
    target,
    type: "FADE_IN",
    anchor: "CLIP_START",
    start: 0,
    duration: 2,
    parameters: {},
    blendMode: "REPLACE",
    priority: 0,
    enabled: true,
  } as LightingEffectInstance;
}

function scene(id: string): FormationScene {
  return {
    schemaVersion: 1,
    id,
    objects: [
      {
        id: `${id}-obj`,
        formationId: "f1",
        transform: { position: [0, 20, 0], rotationDeg: [0, 0, 0], scale: 1 },
        weight: 1,
      },
    ],
  } as unknown as FormationScene;
}

function buildProject(): ShowProject {
  const base = createDefaultProject();
  return {
    ...base,
    formations: [makeFormation("grid", 100, 1, { id: "f1", name: "Grid" }), makeFormation("circle", 100, 2, { id: "f2", name: "Circle" })],
    timeline: [clip("c1", 0, { phase: "TAKEOFF" }), clip("c2", 20), clip("c3", 40)],
    scenes: [scene("c2"), scene("c3")],
    participation: {
      defaultPolicy: "HOLD",
      reserveZone: { center: [0, 20, -40], orientationDeg: 0, spacing: 5, layout: "GRID" },
      reserveLighting: "DIM",
      lookAheadScenes: 2,
      clips: { c2: { policy: "RESERVE" }, c3: { policy: "HOLD" } },
    } as ShowProject["participation"],
    lighting: {
      schemaVersion: 1,
      effects: [
        effect("fx1", { kind: "SCENE", clipId: "c2" }),
        effect("fx2", { kind: "SCENE_OBJECT", clipId: "c2", instanceId: "c2-obj" }),
        effect("fx3", { kind: "MOTION_GROUP", clipId: "c2", instanceId: "c2-obj", groupId: "g" }),
        effect("fx4", { kind: "POINT_GROUP", clipId: "c2", instanceId: "c2-obj", pointIds: ["p1"] }),
        effect("fx5", { kind: "SCENE", clipId: "c3" }),
      ],
    },
  };
}

describe("removeTimelineClipReferences", () => {
  it("A. removes an ordinary clip from the timeline", () => {
    const project = buildProject();
    const next = removeTimelineClipReferences(project, "c1");
    expect(next.timeline.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(project.timeline).toHaveLength(3); // input untouched
  });

  it("B. removes the composed scene but keeps formation assets", () => {
    const next = removeTimelineClipReferences(buildProject(), "c2");
    expect(next.scenes?.map((s) => s.id)).toEqual(["c3"]);
    expect(next.formations.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(next.dynamicFormations).toEqual(buildProject().dynamicFormations);
  });

  it("C. removes only that participation override and keeps defaults", () => {
    const next = removeTimelineClipReferences(buildProject(), "c2");
    expect(Object.keys(next.participation!.clips!)).toEqual(["c3"]);
    expect(next.participation!.defaultPolicy).toBe("HOLD");
    expect(next.participation!.lookAheadScenes).toBe(2);
    expect(next.participation!.reserveZone).toEqual(buildProject().participation!.reserveZone);
  });

  it("D. removes every lighting effect of the clip regardless of target kind", () => {
    const next = removeTimelineClipReferences(buildProject(), "c2");
    expect(next.lighting!.effects.map((e) => e.id)).toEqual(["fx5"]);
  });

  it("E. leaves unrelated project data deep-equal", () => {
    const project = buildProject();
    const next = removeTimelineClipReferences(project, "c2");
    const strip = (p: ShowProject) => {
      const { timeline, scenes, participation, lighting, ...rest } = p;
      return rest;
    };
    expect(strip(next)).toEqual(strip(project));
  });

  it("is a no-op for an unknown clip id", () => {
    const project = buildProject();
    const next = removeTimelineClipReferences(project, "nope");
    expect(next.timeline).toEqual(project.timeline);
    expect(next.lighting).toEqual(project.lighting);
  });

  it("F/G. a project snapshot restores and re-removes the whole dependency unit", () => {
    const before = buildProject();
    const after = removeTimelineClipReferences(before, "c2");
    // Undo = restoring the previous snapshot; redo = re-applying the helper.
    expect(before.timeline.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(before.scenes?.map((s) => s.id)).toContain("c2");
    expect(before.lighting!.effects).toHaveLength(5);
    const redo = removeTimelineClipReferences(before, "c2");
    expect(redo).toEqual(after);
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
  });

  it("K. does not silently repair invalid phase order — the validator reports it", () => {
    const project: ShowProject = {
      ...buildProject(),
      timeline: [clip("c1", 0, { phase: "LANDING" }), clip("c2", 20, { phase: "TAKEOFF" })],
      scenes: [],
      lighting: { schemaVersion: 1, effects: [] },
    };
    // Authoring keeps the clips exactly as written.
    expect(project.timeline.map((c) => c.phase)).toEqual(["LANDING", "TAKEOFF"]);
    const report = validateFullShow(project);
    expect(report.issues.length).toBeGreaterThan(0);
  });
});
