/**
 * REFERENCE-ASSISTED SCENE EDITING — acceptance cover.
 *
 * Every show is synthetic and described in code, so the ghost geometry, the
 * membership filtering and the deviation numbers are all reproducible.
 */
import { describe, expect, it } from "vitest";

import { buildSyntheticEssp } from "../../codec";
import { buildReferenceShow } from "../../reference";
import { analyzeReferenceShow } from "../../forensics/report";
import { extractReferenceTimeline } from "../extract";
import {
  comparisonReferenceTime,
  correspondenceLines,
  extractedComparisonTime,
  objectSourceDroneIds,
  referenceGhostFrame,
  sceneDeviationReport,
} from "../comparison";
import {
  canResetSceneObject,
  duplicateSceneAsEditableCopy,
  resetSceneObjectToExtracted,
} from "../sceneEditing";
import { patchObjectTransform } from "../../../../show/scene/edit";
import { sceneForClip, upsertScene } from "../../../../show/scene/migrate";
import { createDefaultProject } from "../../../../show/defaultProject";
import type { ShowProject } from "../../../../show/types";
import { sampleReferenceShow } from "../../playback";

const RATE = 8;

function blob(cx: number, cz: number, spacing: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 9; i++) {
    out.push([cx + ((i % 3) - 1) * spacing, cz + (Math.floor(i / 3) - 1) * spacing]);
  }
  return out;
}

function trajectory(x: number, y: number): number[][] {
  const out: number[][] = [];
  const push = (seconds: number, z: (t: number) => number, dx = 0) => {
    for (let f = 0; f < seconds * RATE; f += 1) {
      const t = f / RATE;
      out.push([Math.round(x * 100 + dx * t), Math.round(y * 100), Math.round(z(t))]);
    }
  };
  push(12, (t) => (t / 12) * 3000);
  push(20, () => 3000);
  push(16, () => 3000, 60);
  push(20, () => 3000);
  push(12, (t) => 3000 * (1 - t / 12));
  return out;
}

async function extract(positions: readonly [number, number][]) {
  const files = positions.map(([x, y], i) => {
    const xyz = trajectory(x, y);
    const rgb = xyz.map((_, f) => [(f * 3) % 256, 40, 90]);
    return { name: `${i + 1}.essp`, bytes: buildSyntheticEssp({ xyz, rgb }) };
  });
  const show = await buildReferenceShow(files);
  const report = analyzeReferenceShow(show);
  return { show, result: extractReferenceTimeline(show, report) };
}

function projectFrom(result: Awaited<ReturnType<typeof extract>>["result"]): ShowProject {
  const base = createDefaultProject(result.droneCount);
  return {
    ...base,
    droneCount: result.droneCount,
    formations: [...result.formations],
    dynamicFormations: [...result.dynamicFormations],
    scenes: [...result.scenes],
    timeline: [...result.timeline],
    lighting: result.lighting,
  };
}

const TWO_SEPARATED = [...blob(-40, 0, 5), ...blob(40, 0, 5)];
const ONE_GROUP = blob(0, 0, 5);

async function composedFixture() {
  const { show, result } = await extract(TWO_SEPARATED);
  const project = projectFrom(result);
  const scene = project.scenes![0]!;
  const clip = project.timeline.find((c) => c.id === scene.id)!;
  const binding = result.layer.bindings.find((b) => b.clipId === clip.id)!;
  return { show, result, project, scene, clip, binding };
}

describe("reference ghost", () => {
  it("reproduces the imported positions at the extracted frame", async () => {
    const { show, project, scene, clip, binding } = await composedFixture();
    const ghost = referenceGhostFrame({
      show,
      project,
      scene,
      clip,
      binding,
      frame: "EXTRACTED",
      currentTime: 0,
    });
    expect(ghost.referenceTime).toBeCloseTo(extractedComparisonTime(binding), 6);
    const samples = sampleReferenceShow(show, ghost.referenceTime);
    const byId = new Map(show.drones.map((d, i) => [d.sourceId, i]));
    for (const group of ghost.groups) {
      group.sourceDroneIds.forEach((id, k) => {
        expect(group.points[k]).toEqual(samples[byId.get(id)!]!.position);
      });
    }
  });

  it("uses the current playhead in CURRENT mode, clamped to the binding", async () => {
    const { clip, binding } = await composedFixture();
    const inside = comparisonReferenceTime(binding, clip, "CURRENT", clip.start + 1);
    expect(inside).toBeCloseTo(binding.referenceStart + 1, 6);
    const after = comparisonReferenceTime(binding, clip, "CURRENT", clip.start + 1e6);
    expect(after).toBeCloseTo(binding.referenceEnd, 6);
  });
});

describe("object membership", () => {
  it("filters the ghost by the stored source drone ids, disjointly", async () => {
    const { show, project, scene, clip, binding } = await composedFixture();
    const ghost = referenceGhostFrame({
      show,
      project,
      scene,
      clip,
      binding,
      frame: "EXTRACTED",
      currentTime: 0,
    });
    expect(ghost.groups.length).toBe(scene.objects.length);
    const seen = new Set<string>();
    for (const group of ghost.groups) {
      expect(group.membershipKnown).toBe(true);
      expect(group.points.length).toBe(group.sourceDroneIds.length);
      for (const id of group.sourceDroneIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    for (const object of scene.objects) {
      expect(objectSourceDroneIds(project, object).length).toBeGreaterThan(0);
    }
  });
});

describe("deviation metrics", () => {
  it("is zero on a fresh extraction and non-zero after a move", async () => {
    const { show, project, scene, clip, binding } = await composedFixture();
    const args = {
      show,
      project,
      scene,
      clip,
      binding,
      frame: "EXTRACTED" as const,
      currentTime: 0,
    };
    const fresh = sceneDeviationReport(args)!;
    expect(fresh.comparedCount).toBeGreaterThan(0);
    expect(fresh.rmsMeters).toBeLessThan(0.75);
    expect(fresh.objects.length).toBe(scene.objects.length);

    const movedScene = patchObjectTransform(scene, scene.objects[0]!.id, { position: [0, 20, 0] });
    const moved = sceneDeviationReport({
      ...args,
      project: upsertScene(project, movedScene),
      scene: movedScene,
    })!;
    const a = moved.objects.find((o) => o.objectId === scene.objects[0]!.id)!;
    const b = moved.objects.find((o) => o.objectId === scene.objects[1]!.id)!;
    expect(a.centroidShiftMeters).toBeGreaterThan(15);
    expect(b.rmsMeters).toBeCloseTo(
      fresh.objects.find((o) => o.objectId === b.objectId)!.rmsMeters,
      6,
    );
  });

  it("draws correspondence lines only for the selected object", async () => {
    const { show, project, scene, clip, binding } = await composedFixture();
    const lines = correspondenceLines({
      show,
      project,
      scene,
      clip,
      binding,
      frame: "EXTRACTED",
      currentTime: 0,
      objectId: scene.objects[0]!.id,
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.objectId === scene.objects[0]!.id)).toBe(true);
  });
});

describe("reset to extracted state", () => {
  it("is unavailable without an extraction history", async () => {
    const { scene, clip } = await composedFixture();
    expect(canResetSceneObject(null, clip.id, scene.objects[0]!.id)).toBe(false);
  });

  it("restores geometry and transform from the extraction history", async () => {
    const { show, result, project, scene, clip, binding } = await composedFixture();
    const layer = result.layer;
    const objectId = scene.objects[0]!.id;
    expect(canResetSceneObject(layer, clip.id, objectId)).toBe(true);

    const edited = upsertScene(
      project,
      patchObjectTransform(scene, objectId, { position: [0, 25, 0], scale: 2 }),
    );
    const restored = resetSceneObjectToExtracted(edited, layer, clip.id, objectId)!;
    expect(restored).not.toBeNull();

    const restoredScene = sceneForClip(restored, clip);
    const original = scene.objects.find((o) => o.id === objectId)!;
    const back = restoredScene.objects.find((o) => o.id === objectId)!;
    expect(back.transform).toEqual(original.transform);
    // The untouched sibling is byte-identical.
    expect(restoredScene.objects[1]).toEqual(scene.objects[1]);

    const report = sceneDeviationReport({
      show,
      project: restored,
      scene: restoredScene,
      clip,
      binding,
      frame: "EXTRACTED",
      currentTime: 0,
    })!;
    const fresh = sceneDeviationReport({
      show,
      project,
      scene,
      clip,
      binding,
      frame: "EXTRACTED",
      currentTime: 0,
    })!;
    expect(report.rmsMeters).toBeCloseTo(fresh.rmsMeters, 6);
  });

  it("also records history for a single-object extracted clip", async () => {
    const { result } = await extract(ONE_GROUP);
    const clip = result.timeline[1]!;
    expect(canResetSceneObject(result.layer, clip.id, `${clip.id}-obj-1`)).toBe(true);
  });
});

describe("duplicate scene as editable copy", () => {
  it("copies dependencies under fresh ids and leaves the source clip untouched", async () => {
    const { project, scene, clip } = await composedFixture();
    const copy = duplicateSceneAsEditableCopy(project, clip.id, {
      clipId: "clip-copy",
      formationId: (i) => `f-copy-${i}`,
      dynamicFormationId: (i) => `d-copy-${i}`,
    })!;
    expect(copy).not.toBeNull();
    const next = copy.project;
    // Source clip and its scene are unchanged.
    expect(next.timeline.find((c) => c.id === clip.id)).toEqual(clip);
    expect(sceneForClip(next, clip)).toEqual(scene);

    const copyClip = next.timeline.find((c) => c.id === "clip-copy")!;
    const copyScene = sceneForClip(next, copyClip);
    expect(copyScene.objects.length).toBe(scene.objects.length);
    for (const object of copyScene.objects) {
      const src = object.source;
      if (src.kind === "STATIC") {
        expect(src.formationId.startsWith("f-copy-")).toBe(true);
        expect(next.formations.some((f) => f.id === src.formationId)).toBe(true);
      } else {
        expect(src.dynamicFormationId.startsWith("d-copy-")).toBe(true);
        expect((next.dynamicFormations ?? []).some((d) => d.id === src.dynamicFormationId)).toBe(
          true,
        );
      }
    }
    // LANDING stays last.
    const landing = next.timeline.filter((c) => c.phase === "LANDING");
    for (const l of landing) expect(l.start).toBeGreaterThanOrEqual(copyClip.start);
  });
});
