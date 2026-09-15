import { describe, expect, it } from "vitest";

import { localToGeo, type ShowSite } from "@/lib/show/geo";
import { buildPresentationCameraPlan, presentationRenderBudget } from "../presentationViewport";

const area = { width: 120, depth: 80, height: 100 };

describe("presentation viewport", () => {
  it("uses the authored audience position without inventing another viewing direction", () => {
    const site: ShowSite = {
      origin: { lat: 44.4268, lon: 26.1025 },
      headingDeg: 0,
      perimeter: [],
      marginM: 5,
      ceilingM: 120,
    };
    site.audience = localToGeo({ x: 18, z: -95 }, site);

    const plan = buildPresentationCameraPlan(area, site);
    expect(plan.source).toBe("AUDIENCE");
    expect(plan.position[0]).toBeCloseTo(18, 5);
    expect(plan.position[2]).toBeCloseTo(-95, 5);
  });

  it("labels the deterministic fallback as estimated", () => {
    const plan = buildPresentationCameraPlan(area, undefined);
    expect(plan.source).toBe("ESTIMATED");
    expect(plan.position[2]).toBeLessThan(-area.depth / 2);
  });

  it.each([150, 500])("keeps a constant two-surface render plan for %i drones", (count) => {
    expect(presentationRenderBudget(count)).toEqual({
      bodyInstances: count,
      glowInstances: count,
      instancedDrawSurfaces: 2,
    });
  });
});
