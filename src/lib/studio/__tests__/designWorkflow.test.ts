/**
 * DESIGN WORKFLOW — deterministic contracts of the fast design tools.
 *
 * These tests protect the properties a designer relies on: converting a static
 * clip changes the editing surface WITHOUT changing what is flown, duplicating a
 * clip never reuses an id, alignment/distribution is exact and order-stable, and
 * an ESSP-derived source clip is never rewritten by editing its copy.
 */
import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../../show/defaultProject";
import {
  alignSceneObjectsBy,
  applySceneDesignAction,
  objectCentre,
  projectScene,
  resolveSceneAt,
  sceneForClip,
  timelineThumbnails,
  upsertScene,
} from "../../show/scene";
import { IDENTITY_INSTANCE_TRANSFORM } from "../../show/scene/types";
import type { FormationScene } from "../../show/scene";
import { makeFormation } from "../../show/formations";
import type { ShowProject, TimelineClip } from "../../show/types";
import { canConvertClipToScene, convertClipToScene, duplicateShowClip } from "../clipDesign";

const IDS = { clipId: "clip-copy", lightingEffectId: (i: number) => `fx-copy-${i}` };

const N = 12;

function clip(over: Partial<TimelineClip> & Pick<TimelineClip, "id" | "formationId">): TimelineClip {
  return {
    start: 0,
    transition: 8,
    hold: 6,
    easing: "minJerk",
    color: [120, 200, 255],
    effect: "solid",
    phase: "SHOW",
    ...over,
  };
}

/** Static SHOW clip + LANDING, no authored scene: the design entry point. */
function base(): ShowProject {
  const project = createDefaultProject(N);
  const fa = makeFormation("f-a", "A", "grid", N, project.area);
  return {
    ...project,
    formations: [fa],
    timeline: [
      clip({ id: "clip-a", formationId: fa.id, start: 0 }),
      clip({ id: "clip-landing", formationId: fa.id, start: 20, phase: "LANDING" }),
    ],
  };
}

function showClipId(project: ShowProject): string {
  const clip = project.timeline.find((c) => (c.phase ?? "SHOW") === "SHOW");
  expect(clip).toBeTruthy();
  return clip!.id;
}

describe("static clip -> editable scene", () => {
  it("materialises exactly one object with identity transform and no new formation", () => {
    const project = base();
    const clipId = showClipId(project);
    expect(canConvertClipToScene(project, clipId)).toBe(true);

    const result = convertClipToScene(project, clipId)!;
    const scene = projectScene(result.project, clipId)!;
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0]!.transform).toEqual(IDENTITY_INSTANCE_TRANSFORM);
    expect(result.project.formations).toHaveLength(project.formations.length);
    expect(result.sceneObjectIds).toEqual(scene.objects.map((o) => o.id));
  });

  it("preserves the visible geometry, timing and lighting exactly", () => {
    const project = base();
    const clipId = showClipId(project);
    const clip = project.timeline.find((c) => c.id === clipId)!;
    const before = resolveSceneAt(project, sceneForClip(project, clip), 0).points;

    const converted = convertClipToScene(project, clipId)!.project;
    const clipAfter = converted.timeline.find((c) => c.id === clipId)!;
    const after = resolveSceneAt(converted, sceneForClip(converted, clipAfter), 0).points;

    expect(after).toEqual(before);
    expect(clipAfter.start).toBe(clip.start);
    expect(clipAfter.transition).toBe(clip.transition);
    expect(clipAfter.hold).toBe(clip.hold);
    expect(clipAfter.effect).toBe(clip.effect);
    expect(converted.lighting?.effects ?? []).toEqual(project.lighting?.effects ?? []);
  });

  it("is not offered twice for the same clip", () => {
    const project = base();
    const clipId = showClipId(project);
    const converted = convertClipToScene(project, clipId)!.project;
    expect(canConvertClipToScene(converted, clipId)).toBe(false);
    expect(convertClipToScene(converted, clipId)).toBeNull();
  });
});

describe("duplicate clip for design", () => {
  it("creates fresh clip, scene and object ids and shares formation assets", () => {
    const source = convertClipToScene(base(), showClipId(base()))!.project;
    const clipId = showClipId(source);
    const result = duplicateShowClip(source, clipId, IDS)!;

    expect(result.clipId).toBe(IDS.clipId);
    const copy = projectScene(result.project, IDS.clipId)!;
    const original = projectScene(result.project, clipId)!;
    expect(copy.id).not.toBe(original.id);
    const copyIds = copy.objects.map((o) => o.id);
    const originalIds = original.objects.map((o) => o.id);
    expect(copyIds.some((id) => originalIds.includes(id))).toBe(false);
    // Assets are SHARED: scene edits only write instance transforms.
    expect(result.project.formations).toHaveLength(source.formations.length);
    expect(copy.objects[0]!.source).toEqual(original.objects[0]!.source);
  });

  it("inserts the duplicate before LANDING and leaves the source untouched", () => {
    const source = convertClipToScene(base(), showClipId(base()))!.project;
    const clipId = showClipId(source);
    const result = duplicateShowClip(source, clipId, IDS)!;
    const order = result.project.timeline.map((c) => c.id);
    const landingIndex = result.project.timeline.findIndex((c) => c.phase === "LANDING");
    if (landingIndex >= 0) {
      expect(order.indexOf(IDS.clipId)).toBeLessThan(landingIndex);
    }
    expect(projectScene(result.project, clipId)).toEqual(projectScene(source, clipId));
  });

  it("refuses non-SHOW clips", () => {
    const project = base();
    const landing = project.timeline.find((c) => c.phase === "LANDING");
    if (!landing) return;
    expect(duplicateShowClip(project, landing.id, IDS)).toBeNull();
  });

  it("editing the copy never mutates an ESSP-derived source scene", () => {
    const converted = convertClipToScene(base(), showClipId(base()))!.project;
    const clipId = showClipId(converted);
    const owned: ShowProject = {
      ...converted,
      scenes: (converted.scenes ?? []).map((s) =>
        s.id === clipId ? { ...s, source: "ESSP_DERIVED" as const } : s,
      ),
    };
    const result = duplicateShowClip(owned, clipId, IDS)!;
    const copy = projectScene(result.project, IDS.clipId)!;
    const edited = applySceneDesignAction(
      result.project,
      copy,
      copy.objects.map((o) => o.id),
      "RAISE",
    );
    const after = upsertScene(result.project, edited);
    expect(projectScene(after, clipId)).toEqual(projectScene(owned, clipId));
    expect(projectScene(after, IDS.clipId)).not.toEqual(copy);
  });
});

describe("fast design actions", () => {
  function twoObjectScene() {
    const project = convertClipToScene(base(), showClipId(base()))!.project;
    const clipId = showClipId(project);
    const scene = projectScene(project, clipId)!;
    const first = scene.objects[0]!;
    const second = {
      ...first,
      id: "obj-2",
      transform: { ...first.transform, position: [30, 12, 18] as [number, number, number] },
    };
    const withTwo = { ...scene, objects: [first, second] };
    return { project: upsertScene(project, withTwo), scene: withTwo, clipId };
  }

  it("CENTER puts the group centre on the origin column and keeps altitude", () => {
    const { project, scene } = twoObjectScene();
    const ids = scene.objects.map((o) => o.id);
    const before = scene.objects.map((o) => objectCentre(project, o));
    const next = applySceneDesignAction(project, scene, ids, "CENTER");
    const centres = next.objects.map((o) => objectCentre(project, o));
    const cx = centres.reduce((s, c) => s + c[0], 0) / centres.length;
    const cz = centres.reduce((s, c) => s + c[2], 0) / centres.length;
    expect(Math.abs(cx)).toBeLessThan(1e-6);
    expect(Math.abs(cz)).toBeLessThan(1e-6);
    centres.forEach((c, i) => expect(c[1]).toBeCloseTo(before[i]![1], 6));
  });

  it("RESET_TRANSFORM restores the exact identity transform", () => {
    const { project, scene } = twoObjectScene();
    const next = applySceneDesignAction(project, scene, ["obj-2"], "RESET_TRANSFORM");
    expect(next.objects.find((o) => o.id === "obj-2")!.transform).toEqual(
      IDENTITY_INSTANCE_TRANSFORM,
    );
    expect(next.objects[0]).toEqual(scene.objects[0]);
  });

  it("RAISE / LOWER are exact inverses", () => {
    const { project, scene } = twoObjectScene();
    const ids = scene.objects.map((o) => o.id);
    const raised = applySceneDesignAction(project, scene, ids, "RAISE");
    const back = applySceneDesignAction(project, raised, ids, "LOWER");
    back.objects.forEach((o, i) =>
      expect(o.transform.position[1]).toBeCloseTo(scene.objects[i]!.transform.position[1], 6),
    );
  });

  it("SCALE_HALF then SCALE_DOUBLE round-trips the geometry", () => {
    const { project, scene } = twoObjectScene();
    const ids = scene.objects.map((o) => o.id);
    const before = resolveSceneAt(project, scene, 0).points;
    const half = applySceneDesignAction(project, scene, ids, "SCALE_HALF");
    const back = applySceneDesignAction(project, half, ids, "SCALE_DOUBLE");
    const after = resolveSceneAt(project, back, 0).points;
    after.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(before[i]![0], 4);
      expect(p[1]).toBeCloseTo(before[i]![1], 4);
      expect(p[2]).toBeCloseTo(before[i]![2], 4);
    });
  });

  it("ORIGIN_XZ moves every object individually onto the origin column", () => {
    const { project, scene } = twoObjectScene();
    const next = applySceneDesignAction(
      project,
      scene,
      scene.objects.map((o) => o.id),
      "ORIGIN_XZ",
    );
    for (const object of next.objects) {
      const centre = objectCentre(project, object);
      expect(Math.abs(centre[0])).toBeLessThan(1e-6);
      expect(Math.abs(centre[2])).toBeLessThan(1e-6);
    }
  });

  it("empty selections and unknown ids are inert", () => {
    const { project, scene } = twoObjectScene();
    expect(applySceneDesignAction(project, scene, [], "CENTER")).toBe(scene);
    expect(applySceneDesignAction(project, scene, ["nope"], "RAISE")).toBe(scene);
  });

  it("is deterministic for identical input", () => {
    const { project, scene } = twoObjectScene();
    const ids = scene.objects.map((o) => o.id);
    expect(applySceneDesignAction(project, scene, ids, "ROTATE_90")).toEqual(
      applySceneDesignAction(project, scene, ids, "ROTATE_90"),
    );
  });
});

describe("alignment and distribution", () => {
  function threeObjectScene() {
    const project = convertClipToScene(base(), showClipId(base()))!.project;
    const clipId = showClipId(project);
    const scene = projectScene(project, clipId)!;
    const first = scene.objects[0]!;
    const make = (id: string, x: number, y: number, z: number) => ({
      ...first,
      id,
      transform: { ...first.transform, position: [x, y, z] as [number, number, number] },
    });
    const objects = [make("a", 0, 10, 0), make("b", 40, 20, 5), make("c", 10, 30, 60)];
    const built = { ...scene, objects };
    return { project: upsertScene(project, built), scene: built };
  }

  it("aligns to min / max / centre on X", () => {
    const { project, scene } = threeObjectScene();
    const ids = ["a", "b", "c"];
    const xs = (s: FormationScene) => s.objects.map((o) => objectCentre(project, o)[0]);
    const min = Math.min(...xs(scene));
    const left = alignSceneObjectsBy(project, scene, ids, "ALIGN_MIN_X");
    xs(left).forEach((x) => expect(x).toBeCloseTo(min, 6));
    const max = Math.max(...xs(scene));
    const right = alignSceneObjectsBy(project, scene, ids, "ALIGN_MAX_X");
    xs(right).forEach((x) => expect(x).toBeCloseTo(max, 6));
    const mean = xs(scene).reduce((s, v) => s + v, 0) / 3;
    const centre = alignSceneObjectsBy(project, scene, ids, "ALIGN_CENTER_X");
    xs(centre).forEach((x) => expect(x).toBeCloseTo(mean, 6));
  });

  it("matches altitude without touching X/Z", () => {
    const { project, scene } = threeObjectScene();
    const ids = ["a", "b", "c"];
    const before = scene.objects.map((o) => objectCentre(project, o));
    const next = alignSceneObjectsBy(project, scene, ids, "MATCH_ALTITUDE");
    const mean = before.reduce((s, c) => s + c[1], 0) / before.length;
    next.objects.forEach((o, i) => {
      const c = objectCentre(project, o);
      expect(c[1]).toBeCloseTo(mean, 6);
      expect(c[0]).toBeCloseTo(before[i]![0], 6);
      expect(c[2]).toBeCloseTo(before[i]![2], 6);
    });
  });

  it("distributes evenly on Z with equal gaps and stable order", () => {
    const { project, scene } = threeObjectScene();
    const next = alignSceneObjectsBy(project, scene, ["a", "b", "c"], "DISTRIBUTE_Z");
    const zs = next.objects.map((o) => objectCentre(project, o)[2]).sort((x, y) => x - y);
    expect(zs[1]! - zs[0]!).toBeCloseTo(zs[2]! - zs[1]!, 6);
    expect(next.objects.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("needs at least two objects", () => {
    const { project, scene } = threeObjectScene();
    expect(alignSceneObjectsBy(project, scene, ["a"], "ALIGN_MIN_X")).toBe(scene);
  });
});

describe("clip thumbnails", () => {
  it("produces normalised, decimated, deterministic points per clip", () => {
    const project = base();
    const thumbs = timelineThumbnails(project, 16);
    expect(Object.keys(thumbs).sort()).toEqual(project.timeline.map((c) => c.id).sort());
    for (const points of Object.values(thumbs)) {
      expect(points.length).toBeLessThanOrEqual(16);
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
    expect(timelineThumbnails(project, 16)).toEqual(thumbs);
  });
});
