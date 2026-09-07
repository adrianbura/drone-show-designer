/**
 * SAFETY VOLUME OVERLAY — presentation-only envelope read.
 *
 * The overlay must never invent a verdict: it only counts positions outside the
 * lateral geofence, above the ceiling or below the airborne floor.
 */
import { describe, expect, it } from "vitest";

import { safetyVolumeBreach } from "../SafetyVolumeOverlay";
import type { SafetyLimits, ShowArea, Vector3Tuple } from "@/lib/show/types";

const area: ShowArea = { width: 100, depth: 80, height: 120 };
const limits: SafetyLimits = {
  maxVelocity: 8,
  maxAcceleration: 4,
  maxJerk: 8,
  maxYawRate: 90,
  minSeparation: 3,
  minAltitude: 10,
  maxAltitude: 100,
};

describe("safetyVolumeBreach", () => {
  it("reports nothing inside the envelope", () => {
    const pts: Vector3Tuple[] = [
      [0, 40, 0],
      [49, 99, 39],
    ];
    expect(safetyVolumeBreach(pts, area, limits)).toEqual({ lateral: 0, ceiling: 0, floor: 0 });
  });

  it("counts lateral geofence exits on both axes", () => {
    const pts: Vector3Tuple[] = [
      [60, 40, 0],
      [0, 40, -45],
    ];
    expect(safetyVolumeBreach(pts, area, limits).lateral).toBe(2);
  });

  it("counts ceiling and airborne-floor breaches separately", () => {
    const pts: Vector3Tuple[] = [
      [0, 120, 0],
      [0, 4, 0],
    ];
    const b = safetyVolumeBreach(pts, area, limits);
    expect(b.ceiling).toBe(1);
    expect(b.floor).toBe(1);
  });

  it("ignores drones still on the ground", () => {
    expect(safetyVolumeBreach([[0, 0, 0]], area, limits).floor).toBe(0);
  });
});
