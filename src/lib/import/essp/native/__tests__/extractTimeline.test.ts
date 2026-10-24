/**
 * Regression cover for the one-click "Analyse & extract" path: a synthetic
 * imported show must analyse into scenes and extract into editable clips
 * without any manual pre-step.
 */
import { describe, expect, it } from "vitest";

import { buildSyntheticEssp } from "../../codec";
import { buildReferenceShow } from "../../reference";
import { analyzeReferenceShow } from "../../forensics/report";
import { extractReferenceTimeline } from "../extract";
import { referenceDroneFileBytes, referenceShowFromLayer } from "../layer";
import { baseShape } from "../../forensics/__tests__/fixtures";

const RATE = 8;
const DRONES = 6;

/** ESSP units are centimetres; the profile encodes 8 Hz positions. */
function trajectory(index: number): number[][] {
  const out: number[][] = [];
  const x = (index % 3) * 500 - 500;
  const y = Math.floor(index / 3) * 500 - 250;
  const push = (seconds: number, z: (t: number) => number, dx = 0, offset = 0) => {
    for (let f = 0; f < seconds * RATE; f += 1) {
      const t = f / RATE;
      out.push([x + offset + dx * t, y, Math.round(z(t))]);
    }
  };
  push(12, (t) => (t / 12) * 3000); // ascent to 30 m
  push(20, () => 3000); // static formation
  push(16, () => 3000, 60); // slow global translation
  push(20, () => 3000, 0, 60 * 16); // same outline holds at its translated position
  push(12, (t) => 3000 * (1 - t / 12), 0, 60 * 16); // descent without teleporting back
  return out;
}

async function syntheticShow() {
  const files = Array.from({ length: DRONES }, (_, i) => {
    const xyz = trajectory(i);
    const rgb = xyz.map((_, f) => [(f * 3) % 256, 40, 90]);
    return { name: `${i + 1}.essp`, bytes: buildSyntheticEssp({ xyz, rgb }) };
  });
  return buildReferenceShow(files);
}

describe("reference timeline extraction", () => {
  it("represents grouped stationary fragments as STATIC without an animated object", async () => {
    const files = Array.from({ length: DRONES }, (_, drone) => ({
      name: `${drone + 1}.essp`,
      bytes: buildSyntheticEssp({
        xyz: Array.from({ length: 8 * RATE }, () => [drone * 500, (drone % 2) * 500, 3000]),
        rgb: Array.from({ length: 8 * 12 }, () => [255, 40, 90]),
      }),
    }));
    const show = await buildReferenceShow(files);
    const report = analyzeReferenceShow(show);
    const original = report.segments[0];
    if (!original) throw new Error("Expected a stationary source segment");
    report.segments = [
      { ...original, id: "static-a", endTime: 4, duration: 4 },
      { ...original, id: "static-b", startTime: 4, duration: original.endTime - 4 },
    ];
    const before = JSON.stringify(report);
    const result = extractReferenceTimeline(show, report, {
      groupVisualIdentity: true,
      decomposeScenes: false,
    });
    const visuals = result.diagnostics.filter((diagnostic) => diagnostic.kind === "SCENE");
    expect(visuals).toHaveLength(1);
    expect(visuals[0]?.classification).toBe("STATIC_FORMATION");
    expect(visuals[0]?.representation).toBe("STATIC");
    expect(result.dynamicFormations).toHaveLength(0);
    expect(JSON.stringify(report)).toBe(before);
    expect(referenceShowFromLayer(result.layer).drones.map(referenceDroneFileBytes)).toEqual(
      show.drones.map(referenceDroneFileBytes),
    );
  });

  it("keeps a hold–translation–hold episode DYNAMIC and default grouping disabled", async () => {
    const show = await syntheticShow();
    const report = analyzeReferenceShow(show);
    const result = extractReferenceTimeline(show, report, {
      groupVisualIdentity: true,
      decomposeScenes: false,
    });
    const visuals = result.diagnostics.filter((diagnostic) => diagnostic.kind === "SCENE");
    expect(visuals).toHaveLength(1);
    expect(visuals[0]?.classification).toBe("GLOBAL_TRANSLATION");
    expect(visuals[0]?.representation).toBe("DYNAMIC");
    expect(visuals[0]?.fidelityStatus).toBe("EXCELLENT");
    expect(visuals[0]?.fidelityRmsMeters).toBeLessThan(1e-10);
    expect(result.dynamicFormations).toHaveLength(1);
    const binding = result.layer.bindings.find((entry) => entry.kind === "SCENE");
    expect(result.timeline.find((clip) => clip.id === binding?.clipId)?.dynamicFormationId).toBe(
      result.dynamicFormations[0]?.id,
    );
    const defaults = extractReferenceTimeline(show, report, { decomposeScenes: false });
    const explicitOff = extractReferenceTimeline(show, report, {
      groupVisualIdentity: false,
      decomposeScenes: false,
    });
    expect(defaults.timeline).toEqual(explicitOff.timeline);
    expect(defaults.layer.bindings.filter((entry) => entry.kind === "SCENE").length).toBeGreaterThan(1);
    expect(referenceShowFromLayer(result.layer).drones.map(referenceDroneFileBytes)).toEqual(
      show.drones.map(referenceDroneFileBytes),
    );
  });

  it("tiles pulse, morph travel and destination without duplicate clips and retains dynamics", async () => {
    const shape = baseShape(24);
    const files = shape.map((point, drone) => ({
      name: `${drone + 1}.essp`,
      bytes: buildSyntheticEssp({
        xyz: Array.from({ length: 24 * RATE }, (_, sample) => {
          const time = sample / RATE;
          const scale = time < 12 ? 1 + 0.12 * Math.sin((Math.PI * time) / 3) : 1;
          const morph = Math.min(1, Math.max(0, (time - 12) / 4));
          const target: [number, number, number] = [(drone - 12) * 2.5, 40 + (drone % 5) * 4, 0];
          const x = point[0] * scale + (target[0] - point[0]) * morph;
          const y = point[1] + (target[1] - point[1]) * morph;
          const z = point[2] * scale + (target[2] - point[2]) * morph;
          return [Math.round(x * 100), Math.round(z * 100), Math.round(y * 100)];
        }),
        rgb: Array.from({ length: 24 * 12 }, (_, sample) => [sample % 256, 40, 90]),
      }),
    }));
    const show = await buildReferenceShow(files);
    const report = analyzeReferenceShow(show);
    const before = JSON.stringify(report);
    const result = extractReferenceTimeline(show, report, {
      groupVisualIdentity: true,
      decomposeScenes: false,
    });
    const visuals = result.layer.bindings.filter((binding) => binding.kind === "SCENE");
    expect(visuals).toHaveLength(2);
    const pulse = visuals[0];
    const destination = visuals[1];
    if (!pulse || !destination) throw new Error("Expected pulse and destination clips");
    expect(pulse.referenceEnd).toBeGreaterThanOrEqual(12);
    expect(pulse.referenceEnd).toBeLessThan(13);
    expect(pulse.sourceClassification).toBe("DYNAMIC_DEFORMATION");
    expect(
      result.timeline.find((clip) => clip.id === pulse.clipId)?.dynamicFormationId,
    ).toBeTruthy();
    expect(destination.referenceStart).toBe(pulse.referenceEnd);
    expect(destination.referenceHoldStart).toBeGreaterThanOrEqual(16);
    expect(destination.referenceHoldStart - destination.referenceStart).toBeGreaterThan(3);
    // This fixture starts airborne (no takeoff); check visual tiling rather
    // than the extractor's pre-existing synthetic takeoff fallback of 0.1 s.
    let cursor = pulse.referenceStart;
    for (const binding of visuals) {
      expect(binding.referenceStart).toBeCloseTo(cursor, 3);
      expect(binding.referenceEnd).toBeGreaterThanOrEqual(binding.referenceStart);
      cursor = binding.referenceEnd;
    }
    expect(cursor).toBe(destination.referenceEnd);
    expect(JSON.stringify(report)).toBe(before);
    expect(referenceShowFromLayer(result.layer).drones.map(referenceDroneFileBytes)).toEqual(
      show.drones.map(referenceDroneFileBytes),
    );
  });
  it("preserves the report and every source byte across extraction and layer reopen", async () => {
    const show = await syntheticShow();
    const report = analyzeReferenceShow(show);
    const originalReport = JSON.stringify(report);
    const originalFiles = show.drones.map(referenceDroneFileBytes);
    const result = extractReferenceTimeline(show, report, { groupVisualIdentity: true });
    const reopened = referenceShowFromLayer(JSON.parse(JSON.stringify(result.layer)));
    expect(JSON.stringify(report)).toBe(originalReport);
    expect(reopened.drones.map(referenceDroneFileBytes)).toEqual(originalFiles);
    // Motion changes within one geometric outline no longer create clips.
    expect(result.layer.bindings.filter((binding) => binding.kind === "SCENE")).toHaveLength(1);
  });
  it("analyses and extracts a synthetic imported show into editable clips", async () => {
    const show = await syntheticShow();
    const report = analyzeReferenceShow(show);
    const result = extractReferenceTimeline(show, report);

    expect(result.droneCount).toBe(DRONES);
    expect(result.timeline.length).toBeGreaterThan(0);
    expect(result.formations.length + result.dynamicFormations.length).toBeGreaterThan(0);
    expect(result.layer.bindings.length).toBe(result.timeline.length);
    // Clips stay inside the imported playback window, in monotonic order.
    const sorted = [...result.timeline].sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const clip of sorted) {
      const end = clip.start + clip.transition + clip.hold;
      expect(clip.start).toBeCloseTo(cursor, 3);
      expect(clip.transition).toBeGreaterThan(0);
      expect(end).toBeLessThanOrEqual(show.timing.playbackDurationSeconds + 1e-6);
      cursor = end;
    }
  });
});
