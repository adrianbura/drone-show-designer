import { describe, expect, it } from "vitest";
import { sequenceFromFrames } from "../../forensics/adapter";
import { analyzeSequence } from "../../forensics/report";
import { baseShape, type P } from "../../forensics/__tests__/fixtures";
import { visualSceneSegments } from "../visualScenes";

function pulseMorph(rate: number) {
  const shape = baseShape(40);
  return sequenceFromFrames(
    Array.from({ length: rate * 24 }, (_, index) => {
      const t = index / rate;
      const scale = t < 12 ? 1 + 0.12 * Math.sin((Math.PI * t) / 3) : 1;
      const morph = Math.min(1, Math.max(0, (t - 12) / 4));
      return shape.map((p, i): P => {
        const target: P = [(i - 20) * 2.5, 40 + (i % 5) * 4, 0];
        return [
          p[0] * scale + (target[0] - p[0]) * morph,
          p[1] + (target[1] - p[1]) * morph,
          p[2] * scale + (target[2] - p[2]) * morph,
        ];
      });
    }),
    rate,
  );
}

describe("import visual episodes (report remains motion-only)", () => {
  for (const rate of [4, 8]) {
    it(`groups 1–2.5s pulse fragments and preserves the morph at ${rate}Hz`, () => {
      const sequence = pulseMorph(rate);
      const report = analyzeSequence(sequence);
      const before = JSON.stringify(report);
      const positions = sequence.positions.slice();
      const scenes = visualSceneSegments(sequence, report, 4);
      const pulseScenes = scenes.filter((s) => s.startTime < 11 && s.endTime > 1);
      expect(pulseScenes).toHaveLength(1);
      // The final pulse and morph share one upstream motion run. This
      // conservative projection leaves that mixed tail for later refinement.
      expect(pulseScenes[0]?.startTime).toBe(0);
      expect(pulseScenes[0]?.endTime).toBe(11);
      const destination = scenes.find((s) => s.startTime > 15);
      expect(destination).toBeDefined();
      expect(destination?.startTime).toBeGreaterThan(pulseScenes[0]?.endTime ?? Infinity);
      expect(JSON.stringify(report)).toBe(before);
      expect(sequence.positions).toEqual(positions);
      expect(visualSceneSegments(sequence, report, 4)).toEqual(scenes);
    });
  }

  it("keeps translation, rotation and hold of one outline in one episode", () => {
    const shape = baseShape();
    const sequence = sequenceFromFrames(
      Array.from({ length: 96 }, (_, index) => {
        const t = index / 8;
        const angle = (Math.max(0, Math.min(4, t - 4)) * Math.PI) / 10;
        const dx = Math.min(t, 4) * 2;
        return shape.map((p): P => [
          p[0] * Math.cos(angle) - p[2] * Math.sin(angle) + dx,
          p[1],
          p[0] * Math.sin(angle) + p[2] * Math.cos(angle),
        ]);
      }),
      8,
    );
    const report = analyzeSequence(sequence);
    expect(new Set(report.segments.map((s) => s.classification)).size).toBeGreaterThan(1);
    expect(visualSceneSegments(sequence, report, 4)).toHaveLength(1);
  });

  it("retains a confirmed two-second visual despite the four-second extraction floor", () => {
    const shape = baseShape();
    const sequence = sequenceFromFrames(
      Array.from({ length: 16 }, () => shape),
      8,
    );
    const scenes = visualSceneSegments(sequence, analyzeSequence(sequence), 4);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.duration).toBe(1.875);
  });

  it("does not use brightness or colour energy alone to fragment stable geometry", () => {
    const shape = baseShape();
    const sequence = sequenceFromFrames(
      Array.from({ length: 64 }, () => shape),
      8,
    );
    const report = analyzeSequence(sequence);
    report.lighting = {
      sampleRateHz: 12,
      meanBrightness: 0.5,
      maxChangeEnergy: 1,
      changeEventTimes: [1, 2, 3, 4, 5],
      track: Array.from({ length: 96 }, (_, i) => ({
        time: i / 12,
        meanBrightness: i % 2,
        colorVariance: 1,
        darkFraction: i % 2,
        changingFraction: 1,
        changeEnergy: 1,
      })),
    };
    expect(visualSceneSegments(sequence, report, 4)).toHaveLength(1);
  });
});
