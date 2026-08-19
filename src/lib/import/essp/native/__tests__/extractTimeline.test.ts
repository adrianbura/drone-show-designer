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

const RATE = 8;
const DRONES = 6;

/** ESSP units are centimetres; the profile encodes 8 Hz positions. */
function trajectory(index: number): number[][] {
  const out: number[][] = [];
  const x = (index % 3) * 500 - 500;
  const y = Math.floor(index / 3) * 500 - 250;
  const push = (seconds: number, z: (t: number) => number, dx = 0) => {
    for (let f = 0; f < seconds * RATE; f += 1) {
      const t = f / RATE;
      out.push([x + dx * t, y, Math.round(z(t))]);
    }
  };
  push(12, (t) => (t / 12) * 3000); // ascent to 30 m
  push(20, () => 3000); // static formation
  push(16, () => 3000, 60); // slow global translation
  push(20, () => 3000); // static formation
  push(12, (t) => 3000 * (1 - t / 12)); // descent
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
  it("analyses and extracts a synthetic imported show into editable clips", async () => {
    const show = await syntheticShow();
    const report = analyzeReferenceShow(show);
    const result = extractReferenceTimeline(show, report);

    expect(result.droneCount).toBe(DRONES);
    expect(result.timeline.length).toBeGreaterThan(0);
    expect(result.formations.length + result.dynamicFormations.length).toBeGreaterThan(0);
    expect(result.layer.bindings.length).toBe(result.timeline.length);
    // Clips stay inside the imported playback window and never overlap.
    const sorted = [...result.timeline].sort((a, b) => a.startTime - b.startTime);
    let cursor = -1e-6;
    for (const clip of sorted) {
      expect(clip.startTime).toBeGreaterThanOrEqual(cursor - 1e-6);
      expect(clip.startTime + clip.duration).toBeLessThanOrEqual(
        show.timing.playbackDurationSeconds + 1e-6,
      );
      cursor = clip.startTime + clip.duration;
    }
  });
});
