import { describe, expect, it } from "vitest";

import { applyAgentOp } from "../operations";
import { parseAgentCommand } from "../parser";
import { validateAgentProject } from "../validate";
import { sampleDynamicFormation } from "../../show/dynamic/sampler";
import type { DynamicFormation } from "../../show/dynamic/types";
import type { Formation, ShowProject, TimelineClip } from "../../show/types";

function makeFormation(id: string, points: [number, number, number][]): Formation {
  return { id, name: id, kind: "custom", points, params: {} };
}

function makeClip(id: string, formationId: string, extra?: Partial<TimelineClip>): TimelineClip {
  return {
    id,
    formationId,
    start: 0,
    transition: 2,
    hold: 5,
    easing: "linear",
    color: [255, 255, 255],
    effect: "solid",
    phase: "SHOW",
    ...extra,
  };
}

function makeProject(overrides?: Partial<ShowProject>): ShowProject {
  return {
    id: "p1",
    name: "Test",
    droneCount: 4,
    area: { width: 100, depth: 100, height: 120 },
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
    formations: [],
    timeline: [],
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

function makeDynamic(id: string): DynamicFormation {
  return {
    id,
    name: id,
    points: [
      { id: "FP-1", base: [10, 40, 0] },
      { id: "FP-2", base: [-10, 40, 0] },
    ],
    pivot: [0, 40, 0],
    duration: 4,
    loop: "NONE",
    transform: [
      { t: 0, translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { t: 4, translation: [0, 10, 0], rotation: [0, 90, 0], scale: [1, 1, 1] },
    ],
    groups: [],
    seed: 1,
    algorithmVersion: "0.1.0",
  };
}

describe("parseAgentCommand", () => {
  it("parses the user's example: tilt left 20 degrees and recolor gold", () => {
    const r = parseAgentCommand("inclina scena 20 grade spre stanga si schimba culoarea in auriu");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ops).toContainEqual({ kind: "ROTATE_SCENE", axis: "Z", degrees: -20 });
    expect(r.ops).toContainEqual({ kind: "RECOLOR_SCENE", color: [255, 200, 40] });
  });

  it("parses Romanian diacritics and English", () => {
    const ro = parseAgentCommand("rotește scena cu 45 de grade spre dreapta");
    expect(ro.ok && ro.ops[0]).toEqual({ kind: "ROTATE_SCENE", axis: "Y", degrees: -45 });
    const en = parseAgentCommand("tilt the scene 15 degrees left");
    expect(en.ok && en.ops[0]).toEqual({ kind: "ROTATE_SCENE", axis: "Z", degrees: -15 });
  });

  it("parses hex colors and refuses unknown requests", () => {
    const hex = parseAgentCommand("schimbă culoarea în #ff8800");
    expect(hex.ok && hex.ops[0]).toEqual({ kind: "RECOLOR_SCENE", color: [255, 136, 0] });
    expect(parseAgentCommand("fă ceva frumos").ok).toBe(false);
    expect(parseAgentCommand("   ").ok).toBe(false);
  });
});

describe("applyAgentOp", () => {
  it("rotates a static scene about its centroid and is validated", () => {
    const f = makeFormation("f1", [
      [10, 40, 0],
      [-10, 40, 0],
    ]);
    const project = makeProject({ formations: [f], timeline: [makeClip("c1", "f1")] });
    const r = applyAgentOp(project, "c1", { kind: "ROTATE_SCENE", axis: "Z", degrees: 90 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pts = r.project.formations[0]!.points;
    // 90° about Z swaps X into Y around centroid y=40: points become (0, 50) and (0, 30).
    expect(pts[0]![0]).toBeCloseTo(0, 6);
    expect(pts[0]![1]).toBeCloseTo(50, 6);
    expect(pts[1]![1]).toBeCloseTo(30, 6);
    expect(validateAgentProject(r.project, "c1").ok).toBe(true);
    // Original project untouched.
    expect(project.formations[0]!.points[0]![0]).toBe(10);
  });

  it("rotates a dynamic scene's whole trajectory via the transform track", () => {
    const dyn = makeDynamic("d1");
    const project = makeProject({
      dynamicFormations: [dyn],
      timeline: [makeClip("c1", "unused", { dynamicFormationId: "d1" })],
    });
    const r = applyAgentOp(project, "c1", { kind: "ROTATE_SCENE", axis: "Y", degrees: 90 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rotated = r.project.dynamicFormations![0]!;
    const before = sampleDynamicFormation(dyn, 2);
    const after = sampleDynamicFormation(rotated, 2);
    // Yaw 90° maps X into Z: the new z-extent equals the old x-extent.
    const span = (pts: readonly (readonly number[])[], i: number) =>
      Math.abs(pts[0]![i]! - pts[1]![i]!);
    expect(span(after, 2)).toBeCloseTo(span(before, 0), 6);
    expect(span(after, 0)).toBeCloseTo(span(before, 2), 6);
    const d0 = Math.hypot(before[0]![0]! - before[1]![0]!, before[0]![2]! - before[1]![2]!);
    const d1 = Math.hypot(after[0]![0]! - after[1]![0]!, after[0]![2]! - after[1]![2]!);
    expect(d1).toBeCloseTo(d0, 6);
  });

  it("clones a shared formation so other clips keep the original", () => {
    const f = makeFormation("f1", [
      [10, 40, 0],
      [-10, 40, 0],
    ]);
    const project = makeProject({
      formations: [f],
      timeline: [makeClip("c1", "f1"), makeClip("c2", "f1")],
    });
    const r = applyAgentOp(project, "c1", { kind: "ROTATE_SCENE", axis: "Z", degrees: 45 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.timeline[0]!.formationId).not.toBe("f1");
    expect(r.project.timeline[1]!.formationId).toBe("f1");
    expect(r.project.formations.find((x) => x.id === "f1")!.points[0]![0]).toBe(10);
  });

  it("recolors a static clip and rescales exact sampled colors by luminance", () => {
    const dyn: DynamicFormation = {
      ...makeDynamic("d1"),
      sampledColors: {
        source: "ESSP_EXACT",
        rateHz: 12,
        frameCount: 2,
        sourceStartFrame: 0,
        byPoint: { "FP-1": [255, 0, 0, 128, 0, 0], "FP-2": [0, 0, 0, 0, 0, 0] },
      },
    };
    const project = makeProject({
      dynamicFormations: [dyn],
      timeline: [makeClip("c1", "unused", { dynamicFormationId: "d1" })],
    });
    const r = applyAgentOp(project, "c1", { kind: "RECOLOR_SCENE", color: [0, 0, 255] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const colors = r.project.dynamicFormations![0]!.sampledColors!;
    // Full-bright frame becomes full blue; half-bright keeps its 50% pulse.
    expect(colors.byPoint["FP-1"]).toEqual([0, 0, 255, 0, 0, 128]);
    expect(colors.byPoint["FP-2"]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(r.project.timeline[0]!.color).toEqual([0, 0, 255]);
  });

  it("refuses takeoff/landing, missing selection and multi-object scenes", () => {
    const f = makeFormation("f1", [[10, 40, 0]]);
    const project = makeProject({
      formations: [f],
      timeline: [makeClip("c1", "f1", { phase: "TAKEOFF" }), makeClip("c2", "f1")],
      scenes: [{ id: "c2", name: "s", schemaVersion: 1, objects: [] } as never],
    });
    expect(applyAgentOp(project, null, { kind: "ROTATE_SCENE", axis: "Z", degrees: 10 })).toEqual({
      ok: false,
      reason: "NO_CLIP_SELECTED",
    });
    expect(applyAgentOp(project, "c1", { kind: "ROTATE_SCENE", axis: "Z", degrees: 10 })).toEqual({
      ok: false,
      reason: "PHASE_NOT_EDITABLE",
    });
    expect(applyAgentOp(project, "c2", { kind: "ROTATE_SCENE", axis: "Z", degrees: 10 })).toEqual({
      ok: false,
      reason: "MULTI_OBJECT_SCENE",
    });
  });
});

describe("validateAgentProject", () => {
  it("rejects geometry outside the flight area or below minimum altitude", () => {
    const f = makeFormation("f1", [[500, 40, 0]]);
    const project = makeProject({ formations: [f], timeline: [makeClip("c1", "f1")] });
    const r = validateAgentProject(project, "c1");
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("OUTSIDE_FLIGHT_AREA");

    const low = makeProject({
      formations: [makeFormation("f2", [[0, 1, 0]])],
      timeline: [makeClip("c2", "f2")],
    });
    expect(validateAgentProject(low, "c2").issues).toContain("ALTITUDE_BELOW_MIN");
  });
});

describe("capabilities registry", () => {
  it("lists every supported op kind and marks roadmap items unsupported", async () => {
    const { AGENT_CAPABILITIES, SUPPORTED_CAPABILITIES, capabilityInstructions } =
      await import("../capabilities");
    const supported = SUPPORTED_CAPABILITIES.map((c) => c.kind).sort();
    expect(supported).toEqual(["RECOLOR_SCENE", "ROTATE_SCENE", "SELECT_SCENE", "SET_DURATION"]);
    // Roadmap items exist and are honestly marked unsupported.
    const unsupported = AGENT_CAPABILITIES.filter((c) => c.status === "unsupported").map(
      (c) => c.kind,
    );
    expect(unsupported).toContain("SCALE_SCENE");
    expect(unsupported).toContain("CHANGE_DRONE_COUNT");
    // Model instructions mention only supported kinds.
    const instructions = capabilityInstructions();
    for (const kind of supported) expect(instructions).toContain(kind);
    for (const kind of unsupported) expect(instructions).not.toContain(`- ${kind}:`);
  });
});

describe("parseAgentCommand — duration and selection", () => {
  it("parses an absolute hold time", () => {
    const r = parseAgentCommand("ține scena 12 secunde");
    expect(r.ok && r.ops[0]).toEqual({ kind: "SET_DURATION", holdSeconds: 12 });
  });

  it("parses relative extend/shorten", () => {
    const up = parseAgentCommand("prelungește cu 5 secunde");
    expect(up.ok && up.ops[0]).toEqual({ kind: "SET_DURATION", deltaSeconds: 5 });
    const down = parseAgentCommand("shorten it by 3 seconds");
    expect(down.ok && down.ops[0]).toEqual({ kind: "SET_DURATION", deltaSeconds: -3 });
  });

  it("parses scene selection by index and by name", () => {
    const byIndex = parseAgentCommand("selectează scena 5");
    expect(byIndex.ok && byIndex.ops[0]).toEqual({ kind: "SELECT_SCENE", sceneIndex: 5 });
    const byName = parseAgentCommand("select the heart");
    expect(byName.ok && byName.ops[0]).toEqual({ kind: "SELECT_SCENE", sceneName: "heart" });
  });

  it("does not mistake a plain number of degrees for a duration", () => {
    const r = parseAgentCommand("rotește scena 30 de grade");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ops.every((o) => o.kind === "ROTATE_SCENE")).toBe(true);
  });
});

describe("applyAgentOp — SET_DURATION", () => {
  it("sets an absolute hold and ripples following clips", async () => {
    const f = makeFormation("f1", [[10, 40, 0]]);
    const c1 = makeClip("c1", "f1", { start: 0, transition: 2, hold: 5 });
    const c2 = makeClip("c2", "f1", { start: 7, transition: 2, hold: 5 });
    const project = makeProject({ formations: [f], timeline: [c1, c2] });
    const r = applyAgentOp(project, "c1", { kind: "SET_DURATION", holdSeconds: 12 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next1 = r.project.timeline.find((c) => c.id === "c1")!;
    const next2 = r.project.timeline.find((c) => c.id === "c2")!;
    expect(next1.hold).toBe(12);
    expect(next2.start).toBe(14); // 0 + 2 + 12
    expect(r.summary.durationBefore).toBe(5);
    expect(r.summary.durationAfter).toBe(12);
    expect(r.summary.followersShifted).toBe(1);
  });

  it("applies a relative delta and never overlaps followers when shortening", () => {
    const f = makeFormation("f1", [[10, 40, 0]]);
    const c1 = makeClip("c1", "f1", { start: 10, transition: 2, hold: 8 });
    const c2 = makeClip("c2", "f1", { start: 20, transition: 2, hold: 5 });
    const project = makeProject({ formations: [f], timeline: [c1, c2] });
    const r = applyAgentOp(project, "c1", { kind: "SET_DURATION", deltaSeconds: -4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next1 = r.project.timeline.find((c) => c.id === "c1")!;
    const next2 = r.project.timeline.find((c) => c.id === "c2")!;
    expect(next1.hold).toBe(4);
    expect(next2.start).toBe(16);
    expect(next2.start).toBeGreaterThanOrEqual(next1.start + next1.transition + next1.hold);
  });

  it("refuses a hold shorter than the dynamic animation", () => {
    const dyn = makeDynamic("d1");
    const clip = makeClip("c1", "f1", { dynamicFormationId: "d1", hold: 4 });
    const project = makeProject({
      formations: [makeFormation("f1", [[10, 40, 0]])],
      dynamicFormations: [dyn],
      timeline: [clip],
    });
    const r = applyAgentOp(project, "c1", { kind: "SET_DURATION", holdSeconds: 2 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("DURATION_BELOW_ANIMATION");
  });
});

describe("resolveSceneTarget", () => {
  it("resolves by 1-based timeline position and by name", async () => {
    const { resolveSceneTarget } = await import("../operations");
    const f1 = { ...makeFormation("f1", [[10, 40, 0]]), name: "Inima" };
    const f2 = { ...makeFormation("f2", [[-10, 40, 0]]), name: "Castel" };
    const c1 = makeClip("c1", "f1", { start: 0 });
    const c2 = makeClip("c2", "f2", { start: 10 });
    const project = makeProject({ formations: [f1, f2], timeline: [c1, c2] });

    const byIndex = resolveSceneTarget(project, { kind: "SELECT_SCENE", sceneIndex: 2 });
    expect(byIndex).toEqual({ ok: true, clipId: "c2", clipName: "Castel" });

    const byName = resolveSceneTarget(project, { kind: "SELECT_SCENE", sceneName: "inim" });
    expect(byName).toEqual({ ok: true, clipId: "c1", clipName: "Inima" });

    const missing = resolveSceneTarget(project, { kind: "SELECT_SCENE", sceneIndex: 9 });
    expect(missing.ok).toBe(false);
  });

  it("reports ambiguity with candidate names instead of guessing", async () => {
    const { resolveSceneTarget } = await import("../operations");
    const f1 = { ...makeFormation("f1", [[10, 40, 0]]), name: "Stea 1" };
    const f2 = { ...makeFormation("f2", [[-10, 40, 0]]), name: "Stea 2" };
    const project = makeProject({
      formations: [f1, f2],
      timeline: [makeClip("c1", "f1", { start: 0 }), makeClip("c2", "f2", { start: 10 })],
    });
    const r = resolveSceneTarget(project, { kind: "SELECT_SCENE", sceneName: "stea" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("SCENE_AMBIGUOUS");
    expect(r.candidates).toEqual(["Stea 1", "Stea 2"]);
  });

  it("SELECT_SCENE is never a project mutation", () => {
    const project = makeProject({
      formations: [makeFormation("f1", [[10, 40, 0]])],
      timeline: [makeClip("c1", "f1")],
    });
    const r = applyAgentOp(project, "c1", { kind: "SELECT_SCENE", sceneIndex: 1 });
    expect(r.ok).toBe(false);
  });
});
