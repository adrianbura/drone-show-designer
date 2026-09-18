import { describe, expect, it } from "vitest";

import {
  addGradientStop,
  normalizeGradientStops,
  removeGradientStop,
  updateGradientStop,
} from "../effectStack";
import type { GradientStop } from "../../show/lighting";

describe("gradient stop authoring", () => {
  const stops: GradientStop[] = [
    { position: 0, color: [0, 0, 0] },
    { position: 1, color: [200, 100, 50] },
  ];

  it("adds an interpolated stop in the largest gap", () => {
    expect(addGradientStop(stops)).toEqual([
      stops[0],
      { position: 0.5, color: [100, 50, 25] },
      stops[1],
    ]);
  });

  it("clamps and reorders edited positions", () => {
    expect(updateGradientStop(stops, 0, { position: 2 })).toEqual([
      { position: 1, color: stops[0]!.color },
      stops[1]!,
    ]);
    expect(normalizeGradientStops([{ ...stops[0]!, position: -1 }, stops[1]!])[0]!.position).toBe(
      0,
    );
  });

  it("never removes below the canonical two-stop minimum", () => {
    expect(removeGradientStop(stops, 0)).toEqual(stops);
    expect(removeGradientStop(addGradientStop(stops), 1)).toEqual(stops);
  });
});
