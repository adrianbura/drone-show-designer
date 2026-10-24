import { describe, expect, it } from "vitest";
import { buildSyntheticEssp } from "../../codec";
import { buildReferenceShow } from "../../reference";
import { buildReferenceLayer, referenceDroneFileBytes, referenceShowFromLayer } from "../layer";
import { sourceSceneEvidence } from "../sceneEvidence";
import type { ReferenceClipBinding } from "../types";

const binding: ReferenceClipBinding = {
  clipId: "scene",
  order: 1,
  kind: "SCENE",
  sourceSegmentId: null,
  sourceClassification: "DYNAMIC_DEFORMATION",
  referenceStart: 0,
  referenceHoldStart: 0.5,
  referenceEnd: 1,
  owner: "REFERENCE",
  signature: "",
};

async function fixture(rgb: number[][]) {
  return buildReferenceShow([
    {
      name: "1.essp",
      bytes: buildSyntheticEssp({
        xyz: Array.from({ length: 9 }, (_, i) => [i * 100, 0, 3000]),
        rgb,
      }),
    },
  ]);
}

describe("source scene evidence without invented effects", () => {
  it("preserves source clocks, dynamic classification, inferred transition and actual preview", async () => {
    const show = await fixture(
      Array.from({ length: 13 }, (_, i) => (i < 6 ? [0, 0, 0] : [255, 0, 0])),
    );
    const before = show.drones.map(referenceDroneFileBytes);
    const evidence = sourceSceneEvidence(show, binding);
    expect(show.timing.positionRateHz).toBe(8);
    expect(show.timing.rgbRateHz).toBe(12);
    expect(evidence.transitionSeconds).toBe(0.5);
    expect(evidence.previewTime).toBe(0.75);
    expect(evidence.preview[0]?.position).toEqual([6, 30, 0]);
    expect(evidence.preview[0]?.color).toEqual([255, 0, 0]);
    expect(evidence.motion).toBe("DYNAMIC_DEFORMATION");
    expect(evidence.lighting.rgbSamples).toBe(12);
    expect(evidence.lighting.distinctColors).toBe(2);
    expect(evidence.lighting.changes).toBe(1);
    expect(evidence.lighting.darkFraction).toBe(0.5);
    expect(evidence.lighting.recipe).toBe("UNKNOWN");
    expect(evidence.semanticImage).toBe("UNKNOWN");
    expect(show.drones.map(referenceDroneFileBytes)).toEqual(before);
  });

  it("reports absent lighting rather than silently inventing an effect", async () => {
    const show = await fixture([]);
    const evidence = sourceSceneEvidence(show, binding);
    expect(evidence.lighting.status).toBe("NO_RGB_SAMPLES");
    expect(evidence.lighting.rgbSamples).toBe(0);
    expect(evidence.lighting.darkFraction).toBeNull();
    expect(evidence.lighting.recipe).toBe("UNKNOWN");
  });

  it("keeps adjacent interval samples separate and returns identical evidence after layer reopen", async () => {
    const show = await fixture(Array.from({ length: 13 }, (_, i) => [i, 20, 40]));
    const left = sourceSceneEvidence(show, { ...binding, referenceEnd: 0.5 });
    const rightBinding = { ...binding, referenceStart: 0.5 };
    const right = sourceSceneEvidence(show, rightBinding);
    expect(left.lighting.rgbSamples).toBe(6);
    expect(right.lighting.rgbSamples).toBe(6);
    const layer = buildReferenceLayer(show, [binding]);
    const reopened = referenceShowFromLayer(JSON.parse(JSON.stringify(layer)));
    expect(sourceSceneEvidence(reopened, rightBinding)).toEqual(right);
    expect(reopened.drones.map(referenceDroneFileBytes)).toEqual(
      show.drones.map(referenceDroneFileBytes),
    );
  });
});
