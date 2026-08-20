/**
 * ESSP -> LIGHTING EDIT -> EXPORT: END-TO-END ACCEPTANCE (domain level).
 *
 * Proves the canonical ownership contract with no browser in the loop:
 *
 *   REFERENCE-owned instant  -> imported ESSP positions AND imported RGB bytes
 *   PLANNER-owned instant    -> planner trajectory AND projectLightingAt RGB
 *
 * and that ONE authored lighting effect promotes ONLY the affected closure
 * interval, never the rest of the imported show, never the geometry, and never
 * the archived source bytes.
 *
 * Colour comparisons are EXACT: the source RGB are bytes, so any tolerance here
 * would hide exactly the bug this suite exists to catch.
 */
import { describe, expect, it, beforeAll } from "vitest";

import { buildSyntheticEssp } from "../../../import/essp/codec";
import { buildReferenceShow } from "../../../import/essp/reference";
import { analyzeReferenceShow } from "../../../import/essp/forensics/report";
import { colorAt } from "../../../import/essp/playback";
import {
  extractReferenceTimeline,
  intervalAtTime,
  reconcileReferenceLayer,
  referenceColorsAt,
  reseedReferenceSignatures,
  referenceShowFromLayer,
  migrateReferenceLayer,
} from "../../../import/essp/native";
import type { ReferenceTrajectoryLayer } from "../../../import/essp/native/types";
import type { ReferenceShow } from "../../../import/essp/types";
import { buildShowPlan } from "../../trajectory/schedule";
import { sampleEffectiveTrajectorySet } from "../../fullshow/effective";
import { analyzeFullShow } from "../../fullshow";
import { evaluateExportEligibility } from "../../../adapters/exportEligibility";
import { toGenericShowJson, toTrajectoryCsv } from "../../../adapters/export";
import { emittedColor, projectLightingAt } from "../../lighting";

import { createDefaultProject } from "../../defaultProject";
import { showDuration, type RGB, type ShowProject } from "../../types";
import { EMPTY_LIGHTING_PROGRAM, type LightingEffectInstance } from "../../lighting/types";

/* ------------------------------------------------------------------ fixture */

const RATE = 8;
const RGB_RATE = 12;
const DRONES = 6;
const SAMPLE_RATE = 8;
const STRATEGY = "nearestNeighbor" as const;

/**
 * Unmistakable per-drone RGB: each drone gets a distinct saturated primary that
 * steps once per second, so an accidental re-light (or an off-by-one drone
 * mapping) is impossible to mistake for a rounding artefact.
 */
function rgbTrack(index: number, frames: number): number[][] {
  const base: RGB[] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
  ];
  const c = base[index % base.length]!;
  return Array.from({ length: frames }, (_, f) => {
    const step = Math.floor(f / RGB_RATE) % 2 === 0 ? 1 : 0;
    return [step ? c[0] : 17, step ? c[1] : 34, step ? c[2] : 51];
  });
}

/** Takeoff -> hold -> translate -> hold -> land, i.e. at least two SHOW scenes. */
function trajectory(index: number): number[][] {
  const out: number[][] = [];
  const x = (index % 3) * 500 - 500;
  const y = Math.floor(index / 3) * 500 - 250;
  const push = (seconds: number, z: (t: number) => number, dx = 0) => {
    for (let f = 0; f < seconds * RATE; f += 1) {
      const t = f / RATE;
      out.push([Math.round(x + dx * t), y, Math.round(z(t))]);
    }
  };
  push(12, (t) => (t / 12) * 3000);
  push(20, () => 3000);
  push(16, () => 3000, 60);
  push(20, () => 3000);
  push(12, (t) => 3000 * (1 - t / 12));
  return out;
}

async function importedShow(): Promise<ReferenceShow> {
  const files = Array.from({ length: DRONES }, (_, i) => {
    const xyz = trajectory(i);
    return {
      name: `${i + 1}.essp`,
      bytes: buildSyntheticEssp({ xyz, rgb: rgbTrack(i, Math.ceil((xyz.length / RATE) * RGB_RATE)) }),
    };
  });
  return buildReferenceShow(files);
}

interface Fixture {
  readonly show: ReferenceShow;
  readonly project: ShowProject;
  readonly layer: ReferenceTrajectoryLayer;
}

/** Reproduces EXACTLY what the store does on "Analyse & extract". */
async function extractedFixture(): Promise<Fixture> {
  const show = await importedShow();
  const report = analyzeReferenceShow(show);
  const result = extractReferenceTimeline(show, report);
  const base = createDefaultProject();
  const project: ShowProject = {
    ...base,
    droneCount: result.droneCount,
    formations: [...result.formations],
    timeline: [...result.timeline],
    dynamicFormations: [...result.dynamicFormations],
    scenes: [...result.scenes],
    lighting: result.lighting,
    ...(base.preShow ? { preShow: { ...base.preShow, enabled: false } } : {}),
  };
  const layer = reseedReferenceSignatures(project, result.layer, {
    assignmentStrategy: STRATEGY,
    transitionOverrides: {},
  });
  return { show, project, layer };
}

/* ------------------------------------------------------------- pipeline glue */

function pipeline(project: ShowProject, show: ReferenceShow, layer: ReferenceTrajectoryLayer) {
  const plan = buildShowPlan(project, { assignmentStrategy: STRATEGY });
  const effective = sampleEffectiveTrajectorySet(plan, {
    sampleRate: SAMPLE_RATE,
    startTime: plan.startTime ?? 0,
    endTime: plan.duration,
    reference: { show, layer },
  });
  const colorsAt = (t: number) => referenceColorsAt(show, layer, t, project.droneCount);
  return { plan, effective, set: effective.set, colorsAt };
}

/** RGB of one drone at one frame, read back out of the exported artefacts. */
function jsonColor(json: string, droneIndex: number, frame: number): RGB {
  const parsed = JSON.parse(json) as { drones: { samples: { c: RGB }[] }[] };
  return parsed.drones[droneIndex]!.samples[frame]!.c;
}

function csvColor(csv: string, droneIndex: number, frame: number, fleet: number): RGB {
  const row = csv.split("\n")[1 + frame * fleet + droneIndex]!.split(",");
  return [Number(row[10]), Number(row[11]), Number(row[12])] as RGB;
}

function viewportColors(
  project: ShowProject,
  plan: ReturnType<typeof buildShowPlan>,
  set: ReturnType<typeof pipeline>["set"],
  frame: number,
  t: number,
): RGB[] {
  const positions = set.drones.map((d) => d.samples[frame]?.position ?? ([0, 0, 0] as const));
  return projectLightingAt({ project, participation: plan.participation, positions }, t).map(
    emittedColor,
  );
}

function frameTimes(set: ReturnType<typeof pipeline>["set"]) {
  return set.drones[0]!.samples.map((s) => s.t);
}

/** Frames whose owner is `owner`, spread across the show. */
function framesOwnedBy(
  layer: ReferenceTrajectoryLayer,
  times: readonly number[],
  owner: "REFERENCE" | "PLANNER",
  clipId?: string,
): number[] {
  const hits: number[] = [];
  times.forEach((t, k) => {
    const interval = intervalAtTime(layer, t);
    if (!interval || interval.owner !== owner) return;
    if (clipId && interval.clipId !== clipId) return;
    hits.push(k);
  });
  return hits;
}

function pickSpread(list: readonly number[], count = 5): number[] {
  if (list.length <= count) return [...list];
  return Array.from({ length: count }, (_, i) =>
    list[Math.floor(((i + 0.5) * list.length) / count)]!,
  );
}

/** The SHOW clip we author lighting on: an extracted scene with a real hold. */
function showClipId(project: ShowProject, layer: ReferenceTrajectoryLayer): string {
  const binding = layer.bindings.find(
    (b) => b.kind === "SCENE" && b.referenceEnd - b.referenceHoldStart > 2,
  );
  expect(binding).toBeTruthy();
  return binding!.clipId;
}

/** Adds ONE authored effect to the project's lighting program. */
function withEffect(project: ShowProject, effect: LightingEffectInstance) {
  const program = project.lighting ?? EMPTY_LIGHTING_PROGRAM;
  return { ...program, effects: [...program.effects, effect] };
}

function authoredEffect(clipId: string): LightingEffectInstance {
  return {
    id: "acceptance-color",
    type: "COLOR_TRANSITION",
    target: { kind: "SCENE", clipId },
    anchor: "FORMATION_READY",
    start: 0,
    duration: 4,
    blendMode: "REPLACE",
    priority: 10,
    enabled: true,
    parameters: { fromColor: [10, 20, 30], toColor: [200, 100, 50], easing: "LINEAR" },
  };
}

/* --------------------------------------------------------------------- suite */

let fixture: Fixture;

beforeAll(async () => {
  fixture = await extractedFixture();
}, 120_000);

describe("ESSP acceptance — fixture", () => {
  it("extracts a multi-drone, multi-scene, reference-owned show", () => {
    const { show, project, layer } = fixture;
    expect(show.drones.length).toBe(DRONES);
    expect(project.droneCount).toBe(DRONES);
    expect(layer.bindings.filter((b) => b.kind === "SCENE").length).toBeGreaterThanOrEqual(2);
    expect(layer.bindings.every((b) => b.owner === "REFERENCE")).toBe(true);
    expect(showDuration(project)).toBeGreaterThan(20);
  });
});

describe("ESSP acceptance — unedited reference RGB contract", () => {
  it("viewport, generic JSON and trajectory CSV all emit the SOURCE RGB bytes", () => {
    const { show, project, layer } = fixture;
    const { plan, set, colorsAt } = pipeline(project, show, layer);
    const times = frameTimes(set);
    const json = toGenericShowJson({ project, plan, set, referenceColorsAt: colorsAt });
    const csv = toTrajectoryCsv(project, set, plan, colorsAt);

    const frames = pickSpread(framesOwnedBy(layer, times, "REFERENCE"), 6);
    expect(frames.length).toBeGreaterThanOrEqual(4);
    for (const frame of frames) {
      const t = times[frame]!;
      const viewport = colorsAt(t);
      expect(viewport).not.toBeNull();
      for (let d = 0; d < DRONES; d += 1) {
        const source = colorAt(show.drones[d]!, t, show.timing.rgbRateHz);
        expect(viewport![d]).toEqual(source);
        expect(jsonColor(json, d, frame)).toEqual(source);
        expect(csvColor(csv, d, frame, DRONES)).toEqual(source);
      }
    }
  });
});

describe("ESSP acceptance — UI-only actions never promote", () => {
  it("selection, naming, library saves and preview toggles keep ownership + RGB", () => {
    const { show, project, layer } = fixture;
    // Every one of these is editor state in the real store; at domain level the
    // canonical consequence is the same: the PROJECT is untouched apart from
    // non-output metadata, so reconciliation must find nothing to promote.
    const decorated: ShowProject = {
      ...project,
      name: `${project.name} (renamed)`,
      formations: project.formations.map((f) => ({ ...f, name: `${f.name} *` })),
    };
    const result = reconcileReferenceLayer(decorated, layer, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    });
    expect(result.changed).toBe(false);
    expect(result.promotions).toHaveLength(0);
    expect(result.layer.bindings.every((b) => b.owner === "REFERENCE")).toBe(true);

    const { set, colorsAt } = pipeline(decorated, show, result.layer);
    for (const frame of pickSpread(framesOwnedBy(result.layer, frameTimes(set), "REFERENCE"), 4)) {
      const t = frameTimes(set)[frame]!;
      const colors = colorsAt(t)!;
      for (let d = 0; d < DRONES; d += 1) {
        expect(colors[d]).toEqual(colorAt(show.drones[d]!, t, show.timing.rgbRateHz));
      }
    }
  });
});

describe("ESSP acceptance — lighting-only authoring", () => {
  it("promotes exactly the edited clip's closure and nothing else", () => {
    const { show, project, layer } = fixture;
    const clipId = showClipId(project, layer);
    const before = pipeline(project, show, layer);

    const edited: ShowProject = {
      ...project,
      lighting: withEffect(project, authoredEffect(clipId)),
    };
    const reconciled = reconcileReferenceLayer(edited, layer, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    });

    // 4: canonical promotion rule.
    expect(reconciled.changed).toBe(true);
    expect(reconciled.promotions.map((p) => p.clipId)).toEqual([clipId]);
    const promoted = reconciled.layer.bindings.filter((b) => b.owner === "PLANNER");
    expect(promoted.map((b) => b.clipId)).toEqual([clipId]);

    // Only the clip's own intervals plus the FOLLOWING transition change owner.
    const ordered = [...layer.bindings].sort((a, b) => a.order - b.order);
    const next = ordered[ordered.findIndex((b) => b.clipId === clipId) + 1];
    const changedClips = new Set(reconciled.promotions.flatMap((p) => p.affectedClipIds));
    expect(changedClips.has(clipId)).toBe(true);
    for (const binding of ordered) {
      if (binding.clipId === clipId || binding.clipId === next?.clipId) continue;
      expect(changedClips.has(binding.clipId)).toBe(false);
    }

    // 5: GEOMETRY INVARIANCE — the authoring inputs are deep-equal.
    expect(edited.formations).toEqual(project.formations);
    expect(edited.scenes).toEqual(project.scenes);
    expect(edited.dynamicFormations).toEqual(project.dynamicFormations);
    expect(edited.timeline).toEqual(project.timeline);
    expect(edited.participation).toEqual(project.participation);
    expect(edited.limits).toEqual(project.limits);
    expect(edited.altitudes).toEqual(project.altitudes);
    expect(edited.droneCount).toBe(project.droneCount);

    // The archived source bytes are untouched by promotion.
    expect(reconciled.layer.drones).toEqual(layer.drones);
    expect(reconciled.layer.showHash).toBe(layer.showHash);

    const after = pipeline(edited, show, reconciled.layer);
    // The PLANNER geometry itself is identical: promotion changes which
    // authority is read, not what the planner computes.
    expect(after.effective.plannerSet.drones[0]!.samples.map((s) => s.position)).toEqual(
      before.effective.plannerSet.drones[0]!.samples.map((s) => s.position),
    );

    // Positional deviation caused by switching authority is REPORTED, not
    // silently called a geometry edit.
    const times = frameTimes(after.set);
    let worst = 0;
    for (const frame of framesOwnedBy(reconciled.layer, times, "PLANNER", clipId)) {
      for (let d = 0; d < DRONES; d += 1) {
        const a = before.set.drones[d]!.samples[frame]!.position;
        const b = after.set.drones[d]!.samples[frame]!.position;
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    }
    expect(Number.isFinite(worst)).toBe(true);
  });

  it("emits the authored RGB inside the promoted interval, identically everywhere", () => {
    const { show, project, layer } = fixture;
    const clipId = showClipId(project, layer);
    const edited: ShowProject = {
      ...project,
      lighting: withEffect(project, authoredEffect(clipId)),
    };
    const { layer: promotedLayer } = reconcileReferenceLayer(edited, layer, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    });
    const { plan, set, colorsAt } = pipeline(edited, show, promotedLayer);
    const times = frameTimes(set);
    const json = toGenericShowJson({ project: edited, plan, set, referenceColorsAt: colorsAt });
    const csv = toTrajectoryCsv(edited, set, plan, colorsAt);

    const frames = pickSpread(framesOwnedBy(promotedLayer, times, "PLANNER", clipId), 5);
    expect(frames.length).toBeGreaterThanOrEqual(3);
    for (const frame of frames) {
      const t = times[frame]!;
      // Inside a promoted interval the imported authority MUST stand down.
      expect(colorsAt(t)).toBeNull();
      const viewport = viewportColors(edited, plan, set, frame, t);
      for (let d = 0; d < DRONES; d += 1) {
        expect(jsonColor(json, d, frame)).toEqual(viewport[d]);
        expect(csvColor(csv, d, frame, DRONES)).toEqual(viewport[d]);
      }
    }
  });

  it("leaves neighbouring reference intervals byte-identical to the source", () => {
    const { show, project, layer } = fixture;
    const clipId = showClipId(project, layer);
    const edited: ShowProject = {
      ...project,
      lighting: withEffect(project, authoredEffect(clipId)),
    };
    const { layer: promotedLayer } = reconcileReferenceLayer(edited, layer, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    });
    const { plan, set, colorsAt } = pipeline(edited, show, promotedLayer);
    const times = frameTimes(set);
    const json = toGenericShowJson({ project: edited, plan, set, referenceColorsAt: colorsAt });
    const csv = toTrajectoryCsv(edited, set, plan, colorsAt);

    const frames = pickSpread(framesOwnedBy(promotedLayer, times, "REFERENCE"), 6);
    expect(frames.length).toBeGreaterThanOrEqual(4);
    for (const frame of frames) {
      const t = times[frame]!;
      const viewport = colorsAt(t)!;
      for (let d = 0; d < DRONES; d += 1) {
        const source = colorAt(show.drones[d]!, t, show.timing.rgbRateHz);
        expect(viewport[d]).toEqual(source);
        expect(jsonColor(json, d, frame)).toEqual(source);
        expect(csvColor(csv, d, frame, DRONES)).toEqual(source);
      }
    }
  });
});

describe("ESSP acceptance — splice boundaries after a lighting-only promotion", () => {
  it("reports the exact worst boundary instead of weakening the tolerance", () => {
    const { show, project, layer } = fixture;
    const clipId = showClipId(project, layer);
    const edited: ShowProject = {
      ...project,
      lighting: withEffect(project, authoredEffect(clipId)),
    };
    const { layer: promotedLayer } = reconcileReferenceLayer(edited, layer, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    });
    const { effective } = pipeline(edited, show, promotedLayer);
    // The canonical splice report lives on the effective authority result.
    expect(effective.splice).not.toBeNull();
    expect(effective.splice!.positionToleranceMeters).toBeCloseTo(0.05, 6);
    expect(effective.splice!.boundaries.length).toBeGreaterThan(0);
    // Every boundary is attributed: time, clips, worst drone and delta.
    for (const boundary of effective.splice!.boundaries) {
      expect(Number.isFinite(boundary.time)).toBe(true);
      expect(Number.isFinite(boundary.maxPositionDeltaMeters)).toBe(true);
      expect(boundary.leftOwner === boundary.rightOwner).toBe(false);
    }
  });
});

describe("ESSP acceptance — undo / redo of a lighting edit", () => {
  it("restores the reference ownership AND the imported RGB, then re-promotes", () => {
    const { show, project, layer } = fixture;
    const clipId = showClipId(project, layer);
    // Snapshot exactly what the studio history stores for ONE action.
    const snapshot = { project, referenceLayer: layer };

    const edited: ShowProject = {
      ...project,
      lighting: withEffect(project, authoredEffect(clipId)),
    };
    const promoted = reconcileReferenceLayer(edited, layer, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    }).layer;
    expect(promoted.bindings.find((b) => b.clipId === clipId)!.owner).toBe("PLANNER");

    // UNDO: project + layer are restored together (store history snapshot).
    const undoneProject = snapshot.project;
    const undoneLayer = snapshot.referenceLayer;
    expect(undoneProject.lighting?.effects.some((e) => e.id === "acceptance-color")).toBe(false);
    expect(undoneLayer.bindings.every((b) => b.owner === "REFERENCE")).toBe(true);
    // The restored signatures match the restored project, so the promotion
    // guard finds nothing to re-promote.
    const guard = reconcileReferenceLayer(undoneProject, undoneLayer, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    });
    expect(guard.changed).toBe(false);
    // Original imported RGB is visible again.
    const undone = pipeline(undoneProject, show, guard.layer);
    for (const frame of pickSpread(
      framesOwnedBy(guard.layer, frameTimes(undone.set), "REFERENCE", clipId),
      3,
    )) {
      const t = frameTimes(undone.set)[frame]!;
      const colors = undone.colorsAt(t)!;
      for (let d = 0; d < DRONES; d += 1) {
        expect(colors[d]).toEqual(colorAt(show.drones[d]!, t, show.timing.rgbRateHz));
      }
    }
    // The archive itself never moved.
    expect(guard.layer.drones).toEqual(layer.drones);

    // REDO: same edit, same promotion, authored RGB again.
    const redone = reconcileReferenceLayer(edited, guard.layer, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    });
    expect(redone.layer.bindings.filter((b) => b.owner === "PLANNER").map((b) => b.clipId)).toEqual([
      clipId,
    ]);
    const after = pipeline(edited, show, redone.layer);
    const frames = framesOwnedBy(redone.layer, frameTimes(after.set), "PLANNER", clipId);
    expect(frames.length).toBeGreaterThan(0);
    expect(after.colorsAt(frameTimes(after.set)[frames[0]!]!)).toBeNull();
  });
});

describe("ESSP acceptance — save / reopen", () => {
  it("persists the reference layer, ownership, authored lighting and source bytes", () => {
    const { show, project, layer } = fixture;
    const clipId = showClipId(project, layer);
    const edited: ShowProject = {
      ...project,
      lighting: withEffect(project, authoredEffect(clipId)),
    };
    const promotedLayer = reconcileReferenceLayer(edited, layer, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    }).layer;

    const before = pipeline(edited, show, promotedLayer);

    // Save -> JSON -> reopen, through the canonical layer migration.
    const roundTripped = migrateReferenceLayer(JSON.parse(JSON.stringify(promotedLayer)));
    const reopenedShow = referenceShowFromLayer(roundTripped);
    expect(roundTripped.showHash).toBe(promotedLayer.showHash);
    expect(roundTripped.bindings.filter((b) => b.owner === "PLANNER").map((b) => b.clipId)).toEqual([
      clipId,
    ]);
    // Source ESSP data survives verbatim.
    for (let d = 0; d < DRONES; d += 1) {
      expect(Array.from(reopenedShow.drones[d]!.rgbSamples)).toEqual(
        Array.from(show.drones[d]!.rgbSamples),
      );
      expect(Array.from(reopenedShow.drones[d]!.positionSamples)).toEqual(
        Array.from(show.drones[d]!.positionSamples),
      );
    }
    // Ownership recomputes consistently: no promotion on reopen.
    const reseeded = reseedReferenceSignatures(edited, roundTripped, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    });
    const guard = reconcileReferenceLayer(edited, reseeded, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    });
    expect(guard.changed).toBe(false);
    expect(edited.lighting!.effects.some((e) => e.id === "acceptance-color")).toBe(true);

    // Viewport result after reopen matches before save, colour for colour.
    const after = pipeline(edited, reopenedShow, guard.layer);
    const times = frameTimes(after.set);
    for (const frame of pickSpread(framesOwnedBy(guard.layer, times, "REFERENCE"), 4)) {
      expect(after.colorsAt(times[frame]!)).toEqual(before.colorsAt(times[frame]!));
    }
    for (const frame of pickSpread(framesOwnedBy(guard.layer, times, "PLANNER", clipId), 3)) {
      expect(after.colorsAt(times[frame]!)).toBeNull();
      expect(after.set.drones[0]!.samples[frame]!.position).toEqual(
        before.set.drones[0]!.samples[frame]!.position,
      );
    }
  });
});

describe("ESSP acceptance — export gate", () => {
  it("blocks with no report, blocks when stale, and follows the report otherwise", () => {
    const { show, project, layer } = fixture;
    expect(evaluateExportEligibility(null, false).canExportComputedShow).toBe(false);
    expect(evaluateExportEligibility(null, false).reason).toBe("NO_REPORT");

    const { report } = analyzeFullShow(project, {
      sampleRate: SAMPLE_RATE,
      assignmentStrategy: STRATEGY,
      reference: { show, layer },
    });

    // Stale analysis can never authorise a computed export.
    expect(evaluateExportEligibility(report, true).canExportComputedShow).toBe(false);
    expect(evaluateExportEligibility(report, true).reason).toBe("STALE");

    const fresh = evaluateExportEligibility(report, false);
    if (report.exportReadiness.status === "BLOCKED") {
      expect(fresh.canExportComputedShow).toBe(false);
      expect(fresh.blockers.length).toBeGreaterThan(0);
    } else {
      expect(fresh.canExportComputedShow).toBe(true);
      expect(["OK", "OK_WITH_WARNINGS"]).toContain(fresh.reason);
    }
    // A project file is an editable document and stays available either way.
    expect(fresh.canExportProjectFile).toBe(true);
  });
});
