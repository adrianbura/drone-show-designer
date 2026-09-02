import { describe, expect, it } from "vitest";

import {
  AI_VISUAL_UNAVAILABLE_NOTE,
  CREATE_VISUAL_CHOICES,
  buildTextVisualRecipe,
  describeSvgGeometry,
  estimateVisualSpacing,
  evaluateDroneAllocation,
} from "@/lib/studio/createVisual";

describe("create visual decisions", () => {
  it("offers the real creation paths and marks AI honestly unavailable", () => {
    const ai = CREATE_VISUAL_CHOICES.find((c) => c.mode === "AI")!;
    expect(ai.available).toBe(false);
    expect(ai.unavailableNote).toBe(AI_VISUAL_UNAVAILABLE_NOTE);
    expect(CREATE_VISUAL_CHOICES.filter((c) => c.available).map((c) => c.mode)).toEqual([
      "SVG",
      "TEXT",
      "LINE",
      "ASSET",
    ]);
  });

  it("blocks over-allocation against the canonical reserve", () => {
    expect(evaluateDroneAllocation({ fleet: 150, used: 140, requested: 11 }).valid).toBe(false);
    const ok = evaluateDroneAllocation({ fleet: 150, used: 140, requested: 10 });
    expect(ok.valid).toBe(true);
    expect(ok.reserve).toBe(10);
    expect(evaluateDroneAllocation({ fleet: 150, used: 0, requested: 0 }).valid).toBe(false);
  });

  it("describes SVG facts and spacing only from canonical data", () => {
    const facts = describeSvgGeometry("logo.svg", {
      contours: [{ points: [] }, { points: [] }],
      bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100, width: 200, height: 100 },
    } as never);
    expect(facts.widthUnits).toBe(200);
    expect(facts.contours).toBe(2);
    expect(estimateVisualSpacing(null)).toBeNull();
    expect(
      estimateVisualSpacing({ minSpacing: 1.5, avgNearestNeighborSpacing: 2.5 } as never),
    ).toEqual({ minSpacing: 1.5, avgSpacing: 2.5 });
  });

  it("validates text recipes", () => {
    expect(
      buildTextVisualRecipe({
        text: "  ",
        weight: "regular",
        droneCount: 40,
        widthMeters: 60,
        heightMeters: 15,
      }).ok,
    ).toBe(false);
    const built = buildTextVisualRecipe({
      text: "SUPER RALY",
      weight: "regular",
      droneCount: 60,
      widthMeters: 60,
      heightMeters: 15,
    });
    expect(built.ok).toBe(true);
  });
});
