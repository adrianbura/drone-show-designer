/** Group edits: one shared pivot keeps member boundaries continuous; atomic. */
import { describe, expect, it } from "vitest";

import { applyAgentOpToGroup } from "../operations";
import type { ShowProject, TimelineClip } from "../../show/types";

const clip = (id: string, formationId: string, start: number): TimelineClip => ({
  id, formationId, start, transition: 1, hold: 3, easing: "linear",
  color: [255, 255, 255], effect: "solid", phase: "SHOW",
});

function project(): ShowProject {
  const pts: [number, number, number][] = [[0, 40, 0], [6, 40, 0], [0, 46, 0]];
  return {
    id: "p", name: "T", droneCount: 3,
    area: { width: 200, depth: 200, height: 150 },
    limits: { maxVelocity: 8, maxAcceleration: 4, maxJerk: 10, maxYawRate: 90, minSeparation: 1.5, minAltitude: 2, maxAltitude: 120 },
    audio: { name: "", bpm: 120, offset: 0, duration: 0 },
    formations: [
      { id: "fa", name: "A", kind: "custom", params: {}, points: pts },
      // B ends where A ends but is offset: different own centroid.
      { id: "fb", name: "B", kind: "custom", params: {}, points: pts.map((p) => [p[0] + 10, p[1], p[2]]) },
    ],
    timeline: [clip("a", "fa", 0), clip("b", "fb", 4)],
    altitudes: { takeoff: 5, show: 40, landing: 0 },
    versions: { schemaVersion: "1.0", trajectoryAlgorithmVersion: "0.1.0", formationAlgorithmVersion: "0.1.0" },
    seed: 1,
  } as ShowProject;
}

const pointsOf = (p: ShowProject, clipId: string) => {
  const c = p.timeline.find((x) => x.id === clipId)!;
  return p.formations.find((f) => f.id === c.formationId)!.points;
};

describe("group edit", () => {
  it("rotates every member about ONE shared pivot (relative layout preserved)", () => {
    const base = project();
    const r = applyAgentOpToGroup(base, ["a", "b"], { kind: "ROTATE_SCENE", axis: "Y", degrees: 90 });
    expect(r.ok).toBe(true);
    const a = pointsOf(r.project!, "a");
    const b = pointsOf(r.project!, "b");
    // Same rigid map for both: the 10 m X offset between members becomes a Z offset.
    a.forEach((p, i) => {
      const q = b[i]!;
      expect(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])).toBeCloseTo(10, 6);
      expect(Math.abs(q[0] - p[0])).toBeLessThan(1e-6);
    });
  });
  it("scales with a shared pivot: inter-member distance scales by the factor", () => {
    const r = applyAgentOpToGroup(project(), ["a", "b"], { kind: "SCALE_SCENE", factor: 1.5 });
    expect(r.ok).toBe(true);
    const a = pointsOf(r.project!, "a")[0]!;
    const b = pointsOf(r.project!, "b")[0]!;
    expect(b[0] - a[0]).toBeCloseTo(15, 6);
  });
  it("is atomic: one failing member leaves no partial edit", () => {
    const base = project();
    const r = applyAgentOpToGroup(base, ["a", "missing"], { kind: "MOVE_SCENE", offset: [1, 0, 0] });
    expect(r.ok).toBe(false);
    expect(pointsOf(base, "a")[0]).toEqual([0, 40, 0]);
  });
});
