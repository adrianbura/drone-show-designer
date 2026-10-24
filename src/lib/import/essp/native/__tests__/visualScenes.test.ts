import { describe, expect, it } from "vitest";
import { sequenceFromFrames } from "../../forensics/adapter";
import { analyzeSequence } from "../../forensics/report";
import { baseShape, type P } from "../../forensics/__tests__/fixtures";
import { visualSceneSegments } from "../visualScenes";
import { visualIdentityResidual } from "../visualIdentity";

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
      expect(pulseScenes[0]?.startTime).toBe(0);
      // The last pulse was absorbed into the morph by segmentShow. Its
      // compatible prefix is recovered until the first incompatible sample.
      const pulse = pulseScenes[0];
      expect(pulse?.endTime).toBeGreaterThanOrEqual(12);
      expect(pulse?.endTime).toBeLessThan(13);
      expect(pulse?.classification).toBe("DYNAMIC_DEFORMATION");
      if (!pulse) throw new Error("Expected a recovered pulse episode");
      const anchor = Math.round(0.875 * rate);
      const endSample = Math.round(pulse.endTime * rate);
      expect(visualIdentityResidual(sequence, anchor, endSample)).toBeLessThanOrEqual(
        report.thresholds.deformationRmsMeters,
      );
      expect(visualIdentityResidual(sequence, anchor, endSample + 1)).toBeGreaterThan(
        report.thresholds.deformationRmsMeters,
      );
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

  it("never bridges the incompatible morph into the destination outline", () => {
    const sequence = pulseMorph(8);
    const report = analyzeSequence(sequence);
    const scenes = visualSceneSegments(sequence, report, 4);
    const pulse = scenes[0];
    const destination = scenes.at(-1);
    expect(pulse).toBeDefined();
    expect(destination).toBeDefined();
    expect(destination?.startTime).toBeGreaterThan(pulse?.endTime ?? Infinity);
    expect(scenes.some((scene) => scene.startTime < 12 && scene.endTime > 16)).toBe(false);
  });

  it("does not emit the recovered prefix again as an uncertain dynamic segment", () => {
    const sequence = pulseMorph(8);
    const report = analyzeSequence(sequence);
    const mixed = report.segments.find(
      (segment) => segment.startTime <= 12 && segment.endTime >= 16,
    );
    if (!mixed) throw new Error("Expected the absorbed pulse/morph run");
    mixed.classification = "DYNAMIC_DEFORMATION";
    const scenes = visualSceneSegments(sequence, report, 4);
    expect(scenes.filter((scene) => scene.startTime < 12 && scene.endTime > 11)).toHaveLength(1);
    expect(scenes[0]?.endTime).toBeGreaterThanOrEqual(12);
    expect(scenes[0]?.endTime).toBeLessThan(13);
  });

  it("does not use brightness or colour energy alone to fragment stable geometry", () => {
    const shape = baseShape();
    const sequence = sequenceFromFrames(
      Array.from({ length: 64 }, () => shape),
      8,
    );
    const report = analyzeSequence(sequence);
    const original = report.segments[0];
    if (!original) throw new Error("Expected a static segment");
    report.segments = Array.from({ length: 4 }, (_, index) => ({
      ...original,
      id: `colour-${index}`,
      startTime: index * 2,
      endTime: index === 3 ? 7.875 : (index + 1) * 2,
      duration: index === 3 ? 1.875 : 2,
      metrics: { ...original.metrics, lightingChangeEnergy: index % 2 },
    }));
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
