/** Make editable: source-derived profile, nothing promoted, source data untouched. */
import { describe, expect, it } from "vitest";

import { buildSyntheticEssp } from "../../codec";
import { buildReferenceShow } from "../../reference";
import { analyzeReferenceShow } from "../../forensics/report";
import { sampleReferenceShow } from "../../playback";
import { extractReferenceTimeline } from "../extract";
import { reconcileReferenceLayer, reseedReferenceSignatures } from "../intervals";
import { deriveImportedSafetyProfile } from "../safetyProfile";
import { createDefaultProject, DEFAULT_LIMITS } from "../../../../show/defaultProject";
import type { ShowProject } from "../../../../show/types";

const RATE = 8;

async function show() {
  // 6 drones, 1.8 m apart (below the 2.5 m default), static at 30 m.
  const files = Array.from({ length: 6 }, (_, i) => {
    const xyz: number[][] = [];
    const x = (i % 3) * 180;
    const y = Math.floor(i / 3) * 180;
    for (let f = 0; f < 70 * RATE; f += 1) xyz.push([x, y, 3000]);
    return {
      name: `${i + 1}.essp`,
      bytes: buildSyntheticEssp({ xyz, rgb: xyz.map((_, f) => [f % 256, 40, 90]) }),
    };
  });
  return { files, show: await buildReferenceShow(files) };
}

describe("imported safety profile + extraction", () => {
  it("derives separation from the source, floored, never above default", async () => {
    const { show: s } = await show();
    const d = deriveImportedSafetyProfile(s, analyzeReferenceShow(s));
    expect(d.profile.measured.minAirborneSeparation).toBeCloseTo(1.8, 3);
    expect(d.limits.minSeparation).toBeCloseTo(1.8, 3);
    expect(d.limits.minSeparation).toBeLessThanOrEqual(DEFAULT_LIMITS.minSeparation);
    expect(d.limits.maxVelocity).toBeGreaterThanOrEqual(DEFAULT_LIMITS.maxVelocity);
    expect(d.limits.maxYawRate).toBe(DEFAULT_LIMITS.maxYawRate);
    expect(d.profile.measured.maxYawRate).toBeNull();
  });

  it("extraction with the derived profile promotes nothing and leaves source data untouched", async () => {
    const { files, show: s } = await show();
    const bytesBefore = files.map((f) => Array.from(f.bytes));
    const report = analyzeReferenceShow(s);
    const reportBefore = JSON.stringify(report);
    const times = [0, 3.3, 10, 22.125, 40, 69.875];
    const playBefore = JSON.stringify(times.map((t) => sampleReferenceShow(s, t)));
    const result = extractReferenceTimeline(s, report);
    const derived = deriveImportedSafetyProfile(s, report);
    const project: ShowProject = {
      ...createDefaultProject(),
      droneCount: result.droneCount,
      formations: [...result.formations],
      timeline: [...result.timeline],
      dynamicFormations: [...result.dynamicFormations],
      scenes: [...result.scenes],
      lighting: result.lighting,
      area: derived.area,
      altitudes: derived.altitudes,
      limits: derived.limits,
      safetyProfile: derived.profile,
    };
    const ctx = { assignmentStrategy: "hungarian", transitionOverrides: {} } as never;
    const layer = reseedReferenceSignatures(project, result.layer, ctx);
    const rec = reconcileReferenceLayer(project, layer, ctx);
    expect(rec.promotions).toEqual([]);
    expect(layer.bindings.every((b) => b.owner === "REFERENCE")).toBe(true);
    expect(JSON.stringify(report)).toBe(reportBefore);
    expect(JSON.stringify(times.map((t) => sampleReferenceShow(s, t)))).toBe(playBefore);
    expect(files.map((f) => Array.from(f.bytes))).toEqual(bytesBefore);
  });
});
