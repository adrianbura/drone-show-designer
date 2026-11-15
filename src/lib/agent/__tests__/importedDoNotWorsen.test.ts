/** Agent gates on imported shows: already-invalid scenes may change, never worsen. */
import { describe, expect, it } from "vitest";

import { applyAgentOp } from "../operations";
import { validateAgentProject } from "../validate";
import type { ImportedSafetyProfile, ShowProject } from "../../show/types";

const profile: ImportedSafetyProfile = {
  source: "IMPORTED_SHOW",
  note: "n",
  measured: {
    maxAbsX: 0, maxAbsZ: 0, maxAltitude: 0, minAirborneAltitude: 0.8,
    minAirborneSeparation: 1.987, maxVelocity: 0, maxAcceleration: 0, maxJerk: 0, maxYawRate: null,
  },
};

function project(imported: boolean, y = 1.5, gap = 1.9): ShowProject {
  return {
    id: "p",
    name: "T",
    droneCount: 3,
    area: { width: 200, depth: 200, height: 150 },
    limits: {
      maxVelocity: 12, maxAcceleration: 5, maxJerk: 10, maxYawRate: 90,
      minSeparation: 1.95, minAltitude: 2, maxAltitude: 95,
    },
    audio: { name: "", bpm: 120, offset: 0, duration: 0 },
    formations: [
      {
        id: "f1", name: "Low", kind: "custom", params: {},
        points: [[0, y, 0], [gap, y, 0], [0, y + 4, 0]],
      },
    ],
    timeline: [
      { id: "c1", formationId: "f1", start: 0, transition: 2, hold: 5, easing: "linear",
        color: [255, 255, 255], effect: "solid", phase: "SHOW" },
    ],
    altitudes: { takeoff: 5, show: 40, landing: 0 },
    versions: { schemaVersion: "1.0", trajectoryAlgorithmVersion: "0.1.0", formationAlgorithmVersion: "0.1.0" },
    seed: 1,
    ...(imported ? { safetyProfile: profile } : {}),
  } as ShowProject;
}

const move = (p: ShowProject, offset: [number, number, number]) =>
  applyAgentOp(p, "c1", { kind: "MOVE_SCENE", offset } as never);
const scale = (p: ShowProject, factor: number) =>
  applyAgentOp(p, "c1", { kind: "SCALE_SCENE", factor } as never);

describe("imported do-not-worsen agent gates", () => {
  it("allows a sideways move of an imported scene already below min altitude", () => {
    const base = project(true);
    const r = move(base, [1, 0, 0]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateAgentProject(r.project, "c1", base).ok).toBe(true);
  });
  it("refuses moving that imported scene further down (adds points below minimum)", () => {
    const base = project(true, 2.5);
    const r = move(base, [0, -1, 0]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = validateAgentProject(r.project, "c1", base);
      expect(v.ok).toBe(false);
      expect(v.issues).toContain("ALTITUDE_BELOW_MIN");
    }
  });
  it("refuses shrinking an imported scene already below the separation minimum", () => {
    expect(scale(project(true, 40), 0.8)).toMatchObject({ ok: false, reason: "SEPARATION_TOO_SMALL" });
  });
  it("allows growing that imported scene", () => {
    expect(scale(project(true, 40), 1.2).ok).toBe(true);
  });
  it("native project keeps absolute validation: sideways move of a low scene is refused", () => {
    const base = project(false);
    const r = move(base, [1, 0, 0]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateAgentProject(r.project, "c1", base).ok).toBe(false);
  });
  it("imported project without baseline evidence stays absolute (fail-closed)", () => {
    const r = move(project(true), [1, 0, 0]);
    if (r.ok) expect(validateAgentProject(r.project, "c1").ok).toBe(false);
  });
});
