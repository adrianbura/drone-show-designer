import { describe, expect, it } from "vitest";
import { buildSyntheticEssp } from "../../codec";
import { buildReferenceShow } from "../../reference";
import { esspToStudio } from "../../coordinates";
import { buildExactSceneAsset, sampledColorAt } from "../sceneLibrary";
import type { ReferenceClipBinding } from "../types";
import { sampleDynamicFormation } from "@/lib/show/dynamic/sampler";
import { LocalFormationAssetRepository, MemoryKeyValueStore } from "@/lib/library/repository";
import { insertLibraryAsset } from "@/lib/studio/assetInsertion";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { lightingContextAt } from "@/lib/show/lighting/engine";

const N = 6;
const POS_HZ = 8;
const SECONDS = 10;
async function show() {
  return buildReferenceShow(
    Array.from({ length: N }, (_, d) => ({
      name: `${d + 1}.essp`,
      bytes: buildSyntheticEssp({
        // dynamic: every drone moves on its own non-rigid path
        xyz: Array.from({ length: SECONDS * POS_HZ + 1 }, (_, f) => [
          d * 300 + Math.round(50 * Math.sin(f / 5 + d)),
          f * 4,
          3000 + d * 100 + Math.round(30 * Math.cos(f / 3)),
        ]),
        // animated RGB unique per drone and frame
        rgb: Array.from({ length: SECONDS * 12 + 1 }, (_, f) => [(d * 40 + f) % 256, (f * 7) % 256, d * 9]),
      }),
    })),
  );
}
const binding: ReferenceClipBinding = {
  clipId: "c-src",
  order: 1,
  kind: "SCENE",
  sourceSegmentId: "seg-1",
  sourceClassification: "DYNAMIC_DEFORMATION",
  referenceStart: 1,
  referenceHoldStart: 2,
  referenceEnd: 7,
  owner: "REFERENCE",
  signature: "",
};

describe("imported scene -> library -> editable copy", () => {
  it("keeps exact XYZ, exact RGB, timing and provenance; source untouched", async () => {
    const s = await show();
    const before = s.drones.map((d) => [Array.from(d.positionSamples), Array.from(d.rgbSamples)]);
    const r = buildExactSceneAsset(s, binding, { name: "Scene X", formationId: "dyn-x" });
    expect(r.error).toBeNull();
    const asset = r.asset!;
    expect(asset.source).toBe("ESSP_DERIVED");
    expect(asset.assetType).toBe("DYNAMIC_FORMATION");
    expect(asset.droneCount).toBe(N);
    expect(asset.sourceRef?.params?.holdStart).toBe(2);
    expect(asset.sourceRef?.params?.end).toBe(7);
    expect(asset.sourceRef?.params?.effectRecipe).toBe("UNKNOWN");
    expect(asset.sourceRef?.params?.droneCountAdaptation).toBe("UNAVAILABLE_VALIDATION_PENDING");
    if (asset.formationData.kind !== "DYNAMIC") throw new Error("kind");
    const f = asset.formationData.formation;
    expect(f.duration).toBeCloseTo(5, 6);
    // XYZ: every source sample of the hold reproduced
    for (let k = 0; k <= 5 * POS_HZ; k++) {
      const pts = sampleDynamicFormation(f, k / POS_HZ);
      for (let d = 0; d < N; d++) {
        const raw = s.drones[d]!.positionSamples;
        const j = (2 * POS_HZ + k) * 3;
        const want = esspToStudio([raw[j]!, raw[j + 1]!, raw[j + 2]!]);
        for (let a = 0; a < 3; a++) expect(Math.abs(pts[d]![a]! - want[a]!)).toBeLessThan(1e-6);
      }
    }
    // RGB: byte-exact per point at 12 Hz
    const colors = f.sampledColors!;
    expect(colors.rateHz).toBe(12);
    expect(colors.frameCount).toBe(60);
    expect(colors.sourceStartFrame).toBe(24);
    for (let d = 0; d < N; d++) {
      const pid = f.points[d]!.id;
      for (const k of [0, 13, 59]) {
        const raw = s.drones[d]!.rgbSamples;
        expect(sampledColorAt(colors, pid, k / 12)).toEqual([
          raw[(24 + k) * 3],
          raw[(24 + k) * 3 + 1],
          raw[(24 + k) * 3 + 2],
        ]);
      }
    }
    expect(s.drones.map((d) => [Array.from(d.positionSamples), Array.from(d.rgbSamples)])).toEqual(before);
  });

  it("persists through the library and instantiates an independent editable copy", async () => {
    const s = await show();
    const asset = buildExactSceneAsset(s, binding, { name: "Scene X", formationId: "dyn-x" }).asset!;
    const repo = new LocalFormationAssetRepository(new MemoryKeyValueStore());
    const saved = await repo.save(asset);
    const reloaded = (await new LocalFormationAssetRepository(
      // same store re-read: JSON round-trip
      (repo as unknown as { store: MemoryKeyValueStore }).store,
    ).get(saved.id))!;
    expect(reloaded.formationData).toEqual(asset.formationData);
    const frozen = JSON.stringify(reloaded);
    const project = createDefaultProject(10);
    const result = insertLibraryAsset(project, reloaded, {
      clipId: "c1",
      formationId: (i) => `c1-f-${i}`,
      dynamicFormationId: (i) => `c1-dyn-${i}`,
    });
    const copy = result.project.dynamicFormations!.find((d) => d.id !== "dyn-x" && d.sampledColors)!;
    expect(copy.id).not.toBe("dyn-x");
    expect(copy.sampledColors).toEqual(
      (reloaded.formationData as { formation: { sampledColors: unknown } }).formation.sampledColors,
    );
    // edit the copy: library asset must not change
    (copy.points as { base: number[] }[])[0]!.base[0] = 999;
    (copy.sampledColors!.byPoint[copy.points[0]!.id] as number[])[0] = 1;
    expect(JSON.stringify(reloaded)).toBe(frozen);
    // drone count larger than fleet stays partial (reserve), never resampled
    expect(copy.points).toHaveLength(N);

    // lighting: during hold the exact recorded colour is the base colour
    const clip = result.project.timeline.find((c) => c.id === result.clipId)!;
    const t = clip.start + clip.transition + 1.5; // local frame 18
    const pid = copy.points[2]!.id;
    const plan = {
      clipId: clip.id,
      activeGroups: [],
      drones: Array.from({ length: 10 }, (_, i) => ({
        droneIndex: i,
        role: "ACTIVE_FORMATION",
        groupId: null,
        formationPointId: i === 0 ? pid : undefined,
        target: [0, 0, 0],
      })),
    };
    const ctx = lightingContextAt(
      { project: result.project, participation: [plan as never] },
      t,
    )!;
    const raw = s.drones[2]!.rgbSamples;
    expect(ctx.points[0]!.baseColor).toEqual([raw[42 * 3], raw[42 * 3 + 1], raw[42 * 3 + 2]]);
  });

  it("refuses takeoff/landing and too-short intervals", async () => {
    const s = await show();
    expect(buildExactSceneAsset(s, { ...binding, kind: "TAKEOFF" }, { name: "x", formationId: "a" }).error).toBe(
      "TAKEOFF_OR_LANDING",
    );
    expect(
      buildExactSceneAsset(s, { ...binding, referenceHoldStart: 6.8 }, { name: "x", formationId: "a" }).error,
    ).toBe("INTERVAL_TOO_SHORT");
  });
});
