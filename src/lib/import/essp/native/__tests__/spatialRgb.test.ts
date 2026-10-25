import { describe, expect, it } from "vitest";
import { buildSyntheticEssp } from "../../codec";
import { buildReferenceShow } from "../../reference";
import { buildReferenceLayer, referenceDroneFileBytes, referenceShowFromLayer } from "../layer";
import { sourceSceneEvidence } from "../sceneEvidence";
import { analyzeSpatialRgb } from "../spatialRgb";
import type { ReferenceClipBinding } from "../types";

const binding: ReferenceClipBinding = {
  clipId: "scene",
  order: 1,
  kind: "SCENE",
  sourceSegmentId: null,
  sourceClassification: "DYNAMIC_DEFORMATION",
  referenceStart: 0,
  referenceHoldStart: 0,
  referenceEnd: 1,
  owner: "REFERENCE",
  signature: "",
};

async function fixture(
  color: (x: number, y: number, frame: number, drone: number) => number[],
  moving = false,
) {
  return buildReferenceShow(
    Array.from({ length: 25 }, (_, drone) => {
      const x = (drone % 5) - 2,
        y = Math.floor(drone / 5) - 2;
      return {
        name: `${drone + 1}.essp`,
        bytes: buildSyntheticEssp({
          xyz: Array.from({ length: 9 }, (_, frame) => [
            x * 100 + (moving ? frame * 15 : 0),
            0,
            3000 + y * 100,
          ]),
          rgb: Array.from({ length: 13 }, (_, frame) => color(x, y, frame, drone)),
        }),
      };
    }),
  );
}

describe("source spatial RGB evidence", () => {
  it("recovers a diagonal axis in a tilted plane without inventing its unobserved normal component", async () => {
    const show = await fixture((x, y) => [100 + 10 * x + 10 * y, 20, 10]);
    const tilted = {
      ...show,
      drones: show.drones.map((d) => {
        const samples = d.positionSamples.slice();
        for (let i = 0; i < samples.length; i += 3) samples[i + 1] = (samples[i + 2] ?? 0) - 3000;
        return { ...d, positionSamples: samples };
      }),
    };
    const result = analyzeSpatialRgb(tilted, binding);
    // Minimum-norm gradient (10,5,5); the Y-Z normal is unobservable.
    expect(result.status).toBe("SUPPORTED_GRADIENT");
    expect(result.strengthRgbPerMeter).toBeCloseTo(Math.sqrt(150), 8);
    expect(result.direction?.[0]).toBeCloseTo(10 / Math.sqrt(150), 8);
    expect(result.direction?.[1]).toBeCloseTo(5 / Math.sqrt(150), 8);
    expect(result.direction?.[2]).toBeCloseTo(5 / Math.sqrt(150), 8);
  });

  it("measures changing gradient strength but does not call a changing field a constant-speed sweep", async () => {
    const show = await fixture((x, _y, frame) => [100 + (10 + frame) * x, 20, 10]);
    const result = analyzeSpatialRgb(show, binding);
    expect(result.status).toBe("SUPPORTED_GRADIENT");
    expect(result.strengthRgbPerMeter).toBeCloseTo(15.5, 8);
    expect(result.temporal.gradientChangeRgbPerMeterSecond).toBeCloseTo(12, 8);
    expect(result.temporal.apparentSpeedMetersPerSecond).toBeNull();
  });

  it("measures a planar gradient and temporal field speed using interpolated XYZ on all RGB ticks", async () => {
    // X(t)=X(0)+1.2t. RGB(t)=100+20X(0)+4*frame, hence world field 20X+24t.
    const show = await fixture((x, _y, frame) => [100 + 20 * x + 4 * frame, 30, 10], true);
    const result = sourceSceneEvidence(show, binding).lighting.spatial;
    expect(result.status).toBe("SUPPORTED_GRADIENT");
    expect(result.direction?.[0]).toBeCloseTo(1, 10);
    expect(result.direction?.[1]).toBeCloseTo(0, 10);
    expect(result.direction?.[2]).toBeCloseTo(0, 10);
    expect(result.strengthRgbPerMeter).toBeCloseTo(20, 10);
    expect(result.coherence).toBeCloseTo(1, 10);
    expect(result.evaluatedFrames).toBe(12);
    expect(result.pairedSamples).toBe(300);
    expect(result.temporal.consecutiveSupportedPairs).toBe(11);
    expect(result.temporal.fieldChangeRgbPerSecond).toBeCloseTo(24, 8);
    expect(result.temporal.gradientChangeRgbPerMeterSecond).toBeCloseTo(0, 8);
    expect(result.temporal.apparentSpeedMetersPerSecond).toBeCloseTo(-1.2, 8);
    expect(result.recipe).toBe("UNKNOWN");
  });

  it("has no direction for spatially uniform colors even when they change in time", async () => {
    const show = await fixture((_x, _y, frame) => [frame * 10, 50, 20]);
    const result = analyzeSpatialRgb(show, binding);
    expect(result.status).toBe("UNIFORM");
    expect(result.coherence).toBeNull();
    expect(result.direction).toBeNull();
    expect(result.strengthRgbPerMeter).toBeNull();
    expect(result.temporal.apparentSpeedMetersPerSecond).toBeNull();
  });

  it("rejects changing nonlinear per-drone colors with zero linear spatial correlation", async () => {
    const show = await fixture((x, y, frame) => [
      40 + 15 * x * x + frame,
      30 + 10 * y * y + frame * 2,
      10,
    ]);
    const result = analyzeSpatialRgb(show, binding);
    expect(result.status).toBe("LOW_OR_UNSTABLE_FIT");
    expect(result.coherence).toBeCloseTo(0, 10);
    expect(result.supportedFrameFraction).toBe(0);
    expect(result.direction).toBeNull();
    expect(result.temporal.apparentSpeedMetersPerSecond).toBeNull();
  });

  it("does not misrepresent two orthogonal color gradients as one direction", async () => {
    const show = await fixture((x, y) => [100 + 20 * x, 100 + 20 * y, 10]);
    const result = analyzeSpatialRgb(show, binding);
    expect(result.coherence).toBeCloseTo(1, 10);
    expect(result.status).toBe("LOW_OR_UNSTABLE_FIT");
    expect(result.direction).toBeNull();
  });

  it("rejects a weak nonlinear channel hidden behind a stronger linear one", async () => {
    const show = await fixture((x, y) => [100 + 40 * x, 10 + 2 * y * y, 10]);
    const result = analyzeSpatialRgb(show, binding);
    expect(result.coherence).toBeGreaterThan(0.99);
    expect(result.direction).toBeNull();
  });

  it("keeps XYZ/RGB arrays, bytes and reports unchanged and yields identical evidence after Open", async () => {
    const show = await fixture((x, _y, frame) => [100 + 20 * x + frame, 20, 10]);
    const arrays = show.drones.map((d) => ({
      xyz: Array.from(d.positionSamples),
      rgb: Array.from(d.rgbSamples),
    }));
    const bytes = show.drones.map(referenceDroneFileBytes);
    const report = JSON.stringify(show.report);
    const layer = buildReferenceLayer(show, [binding]);
    const saved = JSON.stringify(layer);
    const result = sourceSceneEvidence(show, binding);
    expect(
      show.drones.map((d) => ({
        xyz: Array.from(d.positionSamples),
        rgb: Array.from(d.rgbSamples),
      })),
    ).toEqual(arrays);
    expect(show.drones.map(referenceDroneFileBytes)).toEqual(bytes);
    expect(JSON.stringify(show.report)).toBe(report);
    expect(JSON.stringify(layer)).toBe(saved);
    expect(sourceSceneEvidence(referenceShowFromLayer(JSON.parse(saved)), binding)).toEqual(result);
    expect(result.lighting.recipe).toBe("UNKNOWN");
  });

  it("uses half-open RGB clip boundaries and never differentiates across them", async () => {
    const show = await fixture((x, _y, frame) => [100 + 20 * x + frame, 20, 10]);
    const left = analyzeSpatialRgb(show, { ...binding, referenceEnd: 0.5 });
    const right = analyzeSpatialRgb(show, { ...binding, referenceStart: 0.5 });
    expect(left.rgbFrameRange).toEqual([0, 6]);
    expect(right.rgbFrameRange).toEqual([6, 12]);
    expect(left.lastPairedTime).toBe(5 / 12);
    expect(right.firstPairedTime).toBe(0.5);
    expect(left.temporal.consecutiveSupportedPairs).toBe(5);
    expect(right.temporal.consecutiveSupportedPairs).toBe(5);
    const fractional = analyzeSpatialRgb(show, {
      ...binding,
      referenceStart: 0.09,
      referenceEnd: 0.26,
    });
    expect(fractional.rgbFrameRange).toEqual([2, 4]);
    const endpoint = analyzeSpatialRgb(show, { ...binding, referenceStart: 1, referenceEnd: 2 });
    expect(endpoint.pairedSamples).toBe(25);
    expect(endpoint.temporal.consecutiveSupportedPairs).toBe(0);
  });

  it("does not extrapolate missing position tracks or RGB and reports insufficient fleets", async () => {
    const show = await fixture((x) => [100 + 20 * x, 20, 10]);
    const noPairs = analyzeSpatialRgb(
      { ...show, drones: show.drones.map((d) => ({ ...d, positionSampleCount: 0 })) },
      binding,
    );
    expect(noPairs.status).toBe("NO_PAIRED_SAMPLES");
    expect(noPairs.direction).toBeNull();
    const small = analyzeSpatialRgb({ ...show, drones: show.drones.slice(0, 5) }, binding);
    expect(small.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(small.direction).toBeNull();
    const absent = analyzeSpatialRgb(
      { ...show, drones: show.drones.map((d) => ({ ...d, rgbSampleCount: 0 })) },
      binding,
    );
    expect(absent.evaluatedFrames).toBe(0);
    expect(absent.status).toBe("NO_PAIRED_SAMPLES");
  });
});
