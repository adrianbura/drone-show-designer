import { describe, expect, it } from "vitest";

import { applyAgentOp } from "../operations";
import { parseAgentCommand } from "../parser";
import { gateModelOps } from "../agent.functions";
import { validateAgentProject } from "../validate";
import { sampleDynamicFormation } from "../../show/dynamic/sampler";
import type { DynamicFormation } from "../../show/dynamic/types";
import type { ShowProject, TimelineClip } from "../../show/types";

const clip = (id: string, extra?: Partial<TimelineClip>): TimelineClip => ({
  id,
  formationId: "f1",
  start: 0,
  transition: 2,
  hold: 5,
  easing: "linear",
  color: [255, 255, 255],
  effect: "solid",
  phase: "SHOW",
  ...extra,
});

function project(overrides?: Partial<ShowProject>): ShowProject {
  return {
    id: "p",
    name: "T",
    droneCount: 3,
    area: { width: 200, depth: 200, height: 150 },
    limits: {
      maxVelocity: 8,
      maxAcceleration: 4,
      maxJerk: 10,
      maxYawRate: 90,
      minSeparation: 1.5,
      minAltitude: 2,
      maxAltitude: 120,
    },
    audio: { name: "", bpm: 120, offset: 0, duration: 0 },
    formations: [
      {
        id: "f1",
        name: "Tri",
        kind: "custom",
        points: [
          [0, 40, 0],
          [4, 40, 0],
          [0, 44, 0],
        ],
        params: {},
      },
    ],
    timeline: [clip("c1")],
    altitudes: { takeoff: 5, show: 40, landing: 0 },
    versions: {
      schemaVersion: "1.0",
      trajectoryAlgorithmVersion: "0.1.0",
      formationAlgorithmVersion: "0.1.0",
    },
    seed: 1,
    ...overrides,
  };
}

function dyn(): DynamicFormation {
  return {
    id: "d1",
    name: "Heart",
    points: [
      { id: "A", base: [10, 40, 0] },
      { id: "B", base: [-10, 40, 0] },
      { id: "C", base: [0, 50, 0] },
    ],
    pivot: [0, 40, 0],
    duration: 4,
    loop: "NONE",
    transform: [
      { t: 0, translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { t: 2, translation: [0, 3, 0], rotation: [0, 45, 0], scale: [1.2, 1.2, 1.2] },
      { t: 4, translation: [0, 10, 0], rotation: [0, 90, 0], scale: [1, 1, 1] },
    ],
    groups: [],
    seed: 1,
    algorithmVersion: "0.1.0",
    sampledColors: {
      source: "ESSP_EXACT",
      rateHz: 12,
      frameCount: 2,
      sourceStartFrame: 0,
      byPoint: { A: [255, 0, 0, 128, 0, 0], B: [0, 255, 0, 0, 10, 0], C: [1, 2, 3, 4, 5, 6] },
    },
  };
}

describe("parser — move and scale (RO/EN)", () => {
  it("parses Romanian and English moves with audience-relative directions", () => {
    const ro = parseAgentCommand("mută scena 10 metri în sus și 5 m la stânga");
    expect(ro.ok && ro.ops).toEqual([{ kind: "MOVE_SCENE", offset: [-5, 10, 0] }]);
    const en = parseAgentCommand("move the scene 5 m toward the audience");
    expect(en.ok && en.ops).toEqual([{ kind: "MOVE_SCENE", offset: [0, 0, -5] }]);
  });

  it("a forward move is not misread as a forward lean", () => {
    const r = parseAgentCommand("mută scena 8 m înainte");
    expect(r.ok && r.ops).toEqual([{ kind: "MOVE_SCENE", offset: [0, 0, -8] }]);
  });

  it("parses scale factors, percentages and words; never guesses a size", () => {
    const f = (s: string) => {
      const r = parseAgentCommand(s);
      return r.ok ? r.ops : null;
    };
    expect(f("mărește scena de 1,5 ori")).toEqual([{ kind: "SCALE_SCENE", factor: 1.5 }]);
    expect(f("mărește scena de două ori")).toEqual([{ kind: "SCALE_SCENE", factor: 2 }]);
    expect(f("micșorează scena cu 20%")).toEqual([{ kind: "SCALE_SCENE", factor: 0.8 }]);
    expect(f("shrink the scene by half")).toEqual([{ kind: "SCALE_SCENE", factor: 0.5 }]);
    expect(f("make it bigger")).toBeNull();
    // A duration request mentioning "mărește" stays a duration.
    expect(f("mărește durata cu 5 secunde")?.[0]?.kind).toBe("SET_DURATION");
  });
});

describe("MOVE_SCENE", () => {
  it("translates a static scene exactly and validates", () => {
    const p = project();
    const r = applyAgentOp(p, "c1", { kind: "MOVE_SCENE", offset: [3, 10, -2] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pts = r.project.formations[0]!.points;
    expect(pts[0]).toEqual([3, 50, -2]);
    expect(r.summary.altitudeAfter).toEqual([50, 54]);
    expect(validateAgentProject(r.project, "c1").ok).toBe(true);
    expect(p.formations[0]!.points[0]).toEqual([0, 40, 0]); // input untouched
  });

  it("moves every tick of a dynamic trajectory rigidly and keeps exact RGB", () => {
    const d = dyn();
    const p = project({
      dynamicFormations: [d],
      timeline: [clip("c1", { dynamicFormationId: "d1" })],
    });
    const r = applyAgentOp(p, "c1", { kind: "MOVE_SCENE", offset: [1, 5, 2] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nd = r.project.dynamicFormations!.find((x) => x.id === "d1")!;
    for (const t of [0, 0.7, 1.9, 2, 3.3, 4]) {
      const a = sampleDynamicFormation(d, t);
      const b = sampleDynamicFormation(nd, t);
      a.forEach((pa, i) => {
        expect(b[i]![0] - pa[0]).toBeCloseTo(1, 9);
        expect(b[i]![1] - pa[1]).toBeCloseTo(5, 9);
        expect(b[i]![2] - pa[2]).toBeCloseTo(2, 9);
      });
    }
    expect(nd.sampledColors).toBe(d.sampledColors);
  });

  it("refuses zero, non-finite and out-of-range offsets; validator catches the ceiling", () => {
    const p = project();
    expect(applyAgentOp(p, "c1", { kind: "MOVE_SCENE", offset: [0, 0, 0] }).ok).toBe(false);
    expect(applyAgentOp(p, "c1", { kind: "MOVE_SCENE", offset: [NaN, 0, 0] }).ok).toBe(false);
    expect(applyAgentOp(p, "c1", { kind: "MOVE_SCENE", offset: [0, 500, 0] })).toEqual({
      ok: false,
      reason: "MOVE_OUT_OF_RANGE",
    });
    const high = applyAgentOp(p, "c1", { kind: "MOVE_SCENE", offset: [0, 100, 0] });
    expect(high.ok && validateAgentProject(high.project, "c1").issues).toContain(
      "ALTITUDE_ABOVE_MAX",
    );
  });
});

describe("SCALE_SCENE", () => {
  it("scales a static scene about its centroid and reports separation", () => {
    const r = applyAgentOp(project(), "c1", { kind: "SCALE_SCENE", factor: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.separationBefore).toBeCloseTo(4, 9);
    expect(r.summary.separationAfter).toBeCloseTo(8, 9);
    const pts = r.project.formations[0]!.points;
    const d = Math.hypot(pts[1]![0] - pts[0]![0], pts[1]![1] - pts[0]![1]);
    expect(d).toBeCloseTo(8, 9);
  });

  it("scales every tick of a dynamic trajectory about the centroid exactly", () => {
    const d = dyn();
    const p = project({
      dynamicFormations: [d],
      timeline: [clip("c1", { dynamicFormationId: "d1" })],
    });
    const k = 1.5;
    const r = applyAgentOp(p, "c1", { kind: "SCALE_SCENE", factor: k });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nd = r.project.dynamicFormations!.find((x) => x.id === "d1")!;
    const c = [0, 130 / 3, 0];
    for (const t of [0, 1, 2, 2.5, 4]) {
      const a = sampleDynamicFormation(d, t);
      const b = sampleDynamicFormation(nd, t);
      a.forEach((pa, i) => {
        for (let ax = 0; ax < 3; ax++) {
          expect(b[i]![ax]).toBeCloseTo(c[ax]! + k * (pa[ax]! - c[ax]!), 9);
        }
      });
    }
    expect(nd.sampledColors).toBe(d.sampledColors);
  });

  it("refuses shrinking below minimum separation and factors outside ×0.5–×2", () => {
    const tight = project({
      formations: [
        {
          id: "f1",
          name: "Tight",
          kind: "custom",
          points: [
            [0, 40, 0],
            [2, 40, 0],
          ],
          params: {},
        },
      ],
    });
    expect(applyAgentOp(tight, "c1", { kind: "SCALE_SCENE", factor: 0.6 })).toEqual({
      ok: false,
      reason: "SEPARATION_TOO_SMALL",
    });
    expect(applyAgentOp(tight, "c1", { kind: "SCALE_SCENE", factor: 3 })).toEqual({
      ok: false,
      reason: "SCALE_OUT_OF_RANGE",
    });
    expect(applyAgentOp(tight, "c1", { kind: "SCALE_SCENE", factor: 0 }).ok).toBe(false);
  });

  it("clones a shared formation so the other scene and library asset stay intact", () => {
    const p = project({ timeline: [clip("c1"), clip("c2", { start: 10 })] });
    const r = applyAgentOp(p, "c1", { kind: "SCALE_SCENE", factor: 1.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.formations.find((f) => f.id === "f1")!.points).toEqual(
      p.formations[0]!.points,
    );
    expect(r.project.timeline.find((c) => c.id === "c1")!.formationId).not.toBe("f1");
  });
});

describe("model plan gate — move/scale", () => {
  const base = {
    axis: null,
    degrees: null,
    color: null,
    holdSeconds: null,
    deltaSeconds: null,
    sceneIndex: null,
    sceneName: null,
    offset: null,
    factor: null,
  };
  it("accepts typed move+scale plans and refuses malformed ones", () => {
    const ok = gateModelOps(
      [
        { ...base, kind: "MOVE_SCENE", offset: [0, 5, 0] },
        { ...base, kind: "SCALE_SCENE", factor: 1.2 },
      ],
      "c1",
      null,
    );
    expect(ok.ok && ok.ops.map((o) => o.kind)).toEqual(["MOVE_SCENE", "SCALE_SCENE"]);
    expect(gateModelOps([{ ...base, kind: "MOVE_SCENE" }], "c1", null).ok).toBe(false);
    expect(gateModelOps([{ ...base, kind: "SCALE_SCENE", factor: NaN }], "c1", null).ok).toBe(
      false,
    );
    expect(gateModelOps([{ ...base, kind: "SCALE_SCENE", factor: 2 }], null, null).ok).toBe(false);
  });
});
