/**
 * ESSP TRUE SCENE DECOMPOSITION — deterministic acceptance cover.
 *
 * Every show here is synthetic and fully described in code: the evidence that
 * decides one object vs several objects is therefore reproducible.
 */
import { describe, expect, it } from "vitest";

import { buildSyntheticEssp } from "../../codec";
import { buildReferenceShow } from "../../reference";
import { analyzeReferenceShow } from "../../forensics/report";
import { sequenceFromReferenceShow } from "../../forensics/adapter";
import { extractReferenceTimeline } from "../extract";
import { proposeSceneDecomposition } from "../decomposition";
import { reconcileReferenceLayer, reseedReferenceSignatures } from "../intervals";
import {
  assetFromScene,
  collectSceneDependencies,
  instantiateSceneAsset,
} from "../../../../library";
import { patchObjectTransform } from "../../../../show/scene/edit";
import { resolveSceneAt } from "../../../../show/scene/resolve";
import { createDefaultProject } from "../../../../show/defaultProject";
import type { ShowProject } from "../../../../show/types";

const RATE = 8;

/** One 3x3 blob of drones, centred at (cx, cz), with `spacing` metres pitch. */
function blob(cx: number, cz: number, spacing: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 9; i++) {
    out.push([cx + ((i % 3) - 1) * spacing, cz + (Math.floor(i / 3) - 1) * spacing]);
  }
  return out;
}

/** ESSP units are centimetres; the profile encodes 8 Hz positions. */
function trajectory(x: number, y: number): number[][] {
  const out: number[][] = [];
  const push = (seconds: number, z: (t: number) => number, dx = 0) => {
    for (let f = 0; f < seconds * RATE; f += 1) {
      const t = f / RATE;
      out.push([Math.round(x * 100 + dx * t), Math.round(y * 100), Math.round(z(t))]);
    }
  };
  push(12, (t) => (t / 12) * 3000); // ascent to 30 m
  push(20, () => 3000); // static formation
  push(16, () => 3000, 60); // slow global translation
  push(20, () => 3000); // static formation
  push(12, (t) => 3000 * (1 - t / 12)); // descent
  return out;
}

async function showFrom(positions: readonly [number, number][]) {
  const files = positions.map(([x, y], i) => {
    const xyz = trajectory(x, y);
    const rgb = xyz.map((_, f) => [(f * 3) % 256, 40, 90]);
    return { name: `${i + 1}.essp`, bytes: buildSyntheticEssp({ xyz, rgb }) };
  });
  return buildReferenceShow(files);
}

const ONE_GROUP = blob(0, 0, 5);
const TWO_SEPARATED = [...blob(-40, 0, 5), ...blob(40, 0, 5)];
const AMBIGUOUS = [...blob(-4, 0, 5), ...blob(4, 0, 5)];

async function extract(positions: readonly [number, number][]) {
  const show = await showFrom(positions);
  const report = analyzeReferenceShow(show);
  return { show, report, result: extractReferenceTimeline(show, report) };
}

function sceneClips(result: Awaited<ReturnType<typeof extract>>["result"]) {
  return result.diagnostics.filter((d) => d.kind === "SCENE");
}

describe("ESSP scene decomposition", () => {
  it("A. one coherent group stays a single object", async () => {
    const { result } = await extract(ONE_GROUP);
    for (const clip of sceneClips(result)) {
      expect(clip.representation).not.toBe("COMPOSED_SCENE");
      expect(clip.objects.length).toBe(0);
    }
    expect(result.scenes.length).toBe(0);
  });

  it("B. two strongly separated coherent groups become two scene objects", async () => {
    const { result } = await extract(TWO_SEPARATED);
    const composed = sceneClips(result).filter((d) => d.representation === "COMPOSED_SCENE");
    expect(composed.length).toBeGreaterThan(0);
    const first = composed[0]!;
    expect(first.objects.length).toBe(2);
    expect(first.decompositionConfidence ?? 0).toBeGreaterThanOrEqual(0.6);
    expect(result.scenes.some((s) => s.id === first.clipId)).toBe(true);
  });

  it("C. ambiguous clustering keeps the scene as one object", async () => {
    const { result } = await extract(AMBIGUOUS);
    for (const clip of sceneClips(result)) {
      expect(clip.representation).not.toBe("COMPOSED_SCENE");
    }
  });

  it("D. group drone membership is disjoint and inside the fleet", async () => {
    const { result } = await extract(TWO_SEPARATED);
    for (const clip of sceneClips(result)) {
      const seen = new Set<string>();
      let total = 0;
      for (const object of clip.objects) {
        for (const id of object.sourceDroneIds) {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
        total += object.droneCount;
      }
      expect(total).toBeLessThanOrEqual(result.droneCount);
    }
  });

  it("E. bundled dependency point counts match group membership", async () => {
    const { result } = await extract(TWO_SEPARATED);
    const composed = sceneClips(result).find((d) => d.representation === "COMPOSED_SCENE")!;
    for (const object of composed.objects) {
      const formation = result.formations.find((f) => f.id === object.formationId)!;
      expect(formation.points.length).toBe(object.droneCount);
      expect(String(formation.params.sourceDroneIds).split(" ").length).toBe(object.droneCount);
      if (object.dynamicFormationId) {
        const dynamic = result.dynamicFormations.find((d) => d.id === object.dynamicFormationId)!;
        expect(dynamic.points.length).toBe(object.droneCount);
      }
    }
  });

  it("F. a composed scene asset round-trips with its object structure", async () => {
    const { result } = await extract(TWO_SEPARATED);
    const draft = result.assets.find((a) => a.kind === "SCENE")!;
    expect(draft.kind).toBe("SCENE");
    if (draft.kind !== "SCENE") return;
    const asset = assetFromScene(draft.scene, draft.dependencies, draft.input);
    const copy = instantiateSceneAsset(asset, {
      sceneId: "clip-x",
      formationId: (i) => `f-${i}`,
      dynamicFormationId: (i) => `d-${i}`,
    });
    expect(copy.scene.objects.length).toBe(draft.scene.objects.length);
    expect(copy.scene.objects.map((o) => o.name)).toEqual(draft.scene.objects.map((o) => o.name));
    for (const object of copy.scene.objects) {
      const bundled =
        object.source.kind === "STATIC"
          ? copy.formations.some((f) => f.id === object.source.formationId)
          : copy.dynamicFormations.some(
              (d) => object.source.kind === "DYNAMIC" && d.id === object.source.dynamicFormationId,
            );
      expect(bundled).toBe(true);
    }
  });

  it("J. one-object scenes emit no duplicate scene draft", async () => {
    const { result } = await extract(ONE_GROUP);
    expect(result.assets.some((a) => a.kind === "SCENE")).toBe(false);
    const names = result.assets.map((a) => a.input.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.some((n) => n.endsWith("(scene)"))).toBe(false);
  });

  it("K. grouped lighting only appears when group membership evidence agrees", async () => {
    const { result } = await extract(TWO_SEPARATED);
    // Both groups share one identical LED programme here, so membership cannot
    // be attributed and lighting must stay scene-level.
    for (const effect of result.lighting.effects) {
      expect(effect.target.kind).toBe("SCENE");
    }
  });

  it("proposes no groups when the fleet is one blob", async () => {
    const show = await showFrom(ONE_GROUP);
    const report = analyzeReferenceShow(show);
    const sequence = sequenceFromReferenceShow(show);
    const segment = report.segments.find((s) => s.classification === "STATIC_FORMATION")!;
    const proposal = proposeSceneDecomposition(sequence, segment);
    expect(proposal.representation).toBe("SCENE_CONTAINER");
    expect(proposal.evidence.reasons.length).toBeGreaterThan(0);
  });
});

/** Project view of an extraction, used for the editing / promotion cover. */
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

describe("ESSP composed scene editing", () => {
  const context = { assignmentStrategy: "hungarian", transitionOverrides: {} };

  it("G. moving one object leaves the other group unchanged", async () => {
    const { result } = await extract(TWO_SEPARATED);
    const project = projectFrom(result);
    const scene = project.scenes![0]!;
    const before = resolveSceneAt(project, scene, 0);
    const moved = patchObjectTransform(scene, scene.objects[0]!.id, { position: [0, 12, 0] });
    const after = resolveSceneAt(project, moved, 0);
    const groupB = before.groups[1]!;
    for (let i = 0; i < groupB.pointCount; i++) {
      const k = groupB.offset + i;
      expect(after.points[k]).toEqual(before.points[k]);
    }
    const groupA = before.groups[0]!;
    expect(after.points[groupA.offset]).not.toEqual(before.points[groupA.offset]);
  });

  it("H + I. the edit promotes only its clip, and restoring it restores ownership", async () => {
    const { result } = await extract(TWO_SEPARATED);
    const project = projectFrom(result);
    const layer = reseedReferenceSignatures(project, result.layer, context);
    expect(layer.bindings.every((b) => b.owner === "REFERENCE")).toBe(true);

    const scene = project.scenes![0]!;
    const edited: ShowProject = {
      ...project,
      scenes: project.scenes!.map((s) =>
        s.id === scene.id
          ? patchObjectTransform(s, s.objects[0]!.id, { position: [0, 12, 0] })
          : s,
      ),
    };
    const reconciled = reconcileReferenceLayer(edited, layer, context);
    expect(reconciled.changed).toBe(true);
    expect(reconciled.promotions.map((p) => p.clipId)).toEqual([scene.id]);
    for (const binding of reconciled.layer.bindings) {
      expect(binding.owner).toBe(binding.clipId === scene.id ? "PLANNER" : "REFERENCE");
    }

    // Undo = restoring the previous project + layer snapshot: the signature of
    // the restored composition matches the extracted one again.
    const restored = reconcileReferenceLayer(project, layer, context);
    expect(restored.changed).toBe(false);
    expect(restored.layer.bindings.every((b) => b.owner === "REFERENCE")).toBe(true);
  });
});
