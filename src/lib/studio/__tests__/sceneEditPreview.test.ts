import { describe, expect, it } from "vitest";

import type { ReferenceTrajectoryLayer } from "../../import/essp/native";
import { isPlannerSceneEditPreview } from "../sceneEditPreview";

const layer = {
  bindings: [
    {
      clipId: "scene-31",
      order: 0,
      owner: "REFERENCE",
      kind: "SHOW",
      referenceStart: 10,
      referenceHoldStart: 12,
      referenceEnd: 20,
    },
    {
      clipId: "scene-32",
      order: 1,
      owner: "PLANNER",
      kind: "SHOW",
      referenceStart: 20,
      referenceHoldStart: 22,
      referenceEnd: 30,
    },
  ],
} as unknown as ReferenceTrajectoryLayer;

describe("ESSP scene edit preview ownership", () => {
  it("shows the planner candidate only for a selected object in its reference-owned clip", () => {
    expect(isPlannerSceneEditPreview(layer, 15, "scene-31", ["text"])).toBe(true);
    expect(isPlannerSceneEditPreview(layer, 15, "scene-31", [])).toBe(false);
    expect(isPlannerSceneEditPreview(layer, 15, "scene-32", ["text"])).toBe(false);
    expect(isPlannerSceneEditPreview(layer, 25, "scene-32", ["text"])).toBe(false);
  });

  it("never invents a preview without an imported ownership layer", () => {
    expect(isPlannerSceneEditPreview(null, 15, "scene-31", ["text"])).toBe(false);
  });
});
