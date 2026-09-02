/**
 * SCENE COMPOSER ACCEPTANCE — 150-DRONE MULTI-OBJECT SCENE.
 *
 * The everyday composer workflow, driven through the canonical authorities only:
 *   SVG text object (110 drones) + two native line objects (20 + 20)
 *   -> WAVE motion on the SVG object only
 *   -> independently targeted lighting per object
 *   -> save / reopen, undo / redo, full-show validation, export.
 *
 * No maths is re-implemented here: geometry comes from the SVG engine and the
 * `line` formation generator, budgets from `sceneBudget`, animation from the
 * dynamic engine, validation from `analyzeFullShow`, export from the export
 * eligibility + ESSP packagers.
 */
import { describe, expect, it } from "vitest";

import { buildEsspExportPackage } from "@/lib/adapters/esspExport";
import { forcedReady, planFor } from "./support/productionFixtures";
import { evaluateExportEligibility } from "@/lib/adapters/exportEligibility";
import {
  defaultPlanningState,
  parseProjectFile,
  projectFileToJson,
  serializeProject,
} from "@/lib/project";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { applyPreset, dynamicFromFormation } from "@/lib/show/dynamic";
import { makeSceneLocalFormation } from "@/lib/show/formations";
import { analyzeFullShow } from "@/lib/show/fullshow";
import {
  createEffectFromPreset,
  findLightingPreset,
  EMPTY_LIGHTING_PROGRAM,
  projectLightingAt,
} from "@/lib/show/lighting";
import {
  findSelectionLightingPreset,
  selectionLightingParameters,
  selectionLightingTargets,
} from "@/lib/studio/selectionEffects";
import { addObject, emptyScene, patchObject, sceneBudget, upsertScene } from "@/lib/show/scene";
import {
  generateSvgFormationPoints,
  makeSvgFormation,
  parseSvg,
  resolveSvgParams,
} from "@/lib/show/svg";
import type { FormationScene } from "@/lib/show/scene/types";
import type { ShowProject, TimelineClip } from "@/lib/show/types";

const FLEET = 150;
const TEXT_DRONES = 110;
const LINE_DRONES = 20;

/** A deterministic "SUPER RALY"-like vector: two filled bars of text mass. */
const SVG_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">
  <rect x="10" y="10" width="80" height="40" />
  <rect x="110" y="10" width="80" height="40" />
</svg>`;

function svgTextFormation(project: ShowProject, count: number) {
  const geometry = parseSvg(SVG_SOURCE, { fileName: "text.svg", byteLength: SVG_SOURCE.length });
  const params = resolveSvgParams(count, { mode: "fill", width: 80, altitude: 60 });
  const result = generateSvgFormationPoints(geometry, params);
  return makeSvgFormation(
    "f-text",
    "SUPER RALY",
    { id: "svg-1", name: "text.svg", fileName: "text.svg", geometry },
    result,
  );
}

/** Builds the composer scene: SVG text + two underlines, in one clip. */
function composedProject(textDrones: number): {
  project: ShowProject;
  scene: FormationScene;
  ids: { text: string; line1: string; line2: string };
} {
  const base = createDefaultProject(FLEET);
  const text = svgTextFormation(base, textDrones);
  const line = makeSceneLocalFormation("f-line", "Line", "line", LINE_DRONES, base.area, {
    length: 70,
    rows: 1,
  });
  const clip: TimelineClip = {
    id: "c-scene",
    formationId: text.id,
    start: 0,
    transition: 20,
    hold: 20,
    easing: "minJerk",
    color: [255, 255, 255],
    effect: "solid",
    phase: "SHOW",
  };
  let project: ShowProject = {
    ...base,
    formations: [text, line],
    timeline: [clip],
    lighting: EMPTY_LIGHTING_PROGRAM,
  };

  let scene = emptyScene(clip.id, "Scene");
  const a = addObject(project, scene, {
    source: { kind: "STATIC", formationId: text.id },
    name: "SUPER RALY",
    requestedDroneCount: textDrones,
    position: [0, 0, 0],
  });
  const b = addObject(project, a.scene, {
    source: { kind: "STATIC", formationId: line.id },
    name: "Underline 1",
    requestedDroneCount: LINE_DRONES,
    position: [0, 40, 0],
  });
  const c = addObject(project, b.scene, {
    source: { kind: "STATIC", formationId: line.id },
    name: "Underline 2",
    requestedDroneCount: LINE_DRONES,
    position: [0, 34, 0],
  });
  scene = patchObject(c.scene, b.objectId, { lighting: { color: [255, 90, 60] } });
  scene = patchObject(scene, c.objectId, { lighting: { color: [60, 160, 255] } });
  project = upsertScene(project, scene);
  return {
    project,
    scene,
    ids: { text: a.objectId, line1: b.objectId, line2: c.objectId },
  };
}

/** WAVE motion on ONE object: promotes only that object to a DYNAMIC source. */
function waveOnObject(project: ShowProject, scene: FormationScene, objectId: string) {
  const object = scene.objects.find((o) => o.id === objectId)!;
  const formationId = object.source.kind === "STATIC" ? object.source.formationId : "";
  const formation = project.formations.find((f) => f.id === formationId)!;
  const dynamic = applyPreset(
    dynamicFromFormation(formation, { id: "d-wave", name: "Text wave", duration: 8 }),
    "WAVE",
  );
  const nextScene = patchObject(scene, objectId, {
    source: { kind: "DYNAMIC", dynamicFormationId: dynamic.id },
  });
  const nextProject: ShowProject = {
    ...project,
    dynamicFormations: [...(project.dynamicFormations ?? []), dynamic],
  };
  return { project: upsertScene(nextProject, nextScene), scene: nextScene, dynamic };
}

describe("scene composer acceptance — 150 drones", () => {
  it("composes SVG text 110 + two 20-drone lines to exactly 150 active drones", () => {
    const { project, scene } = composedProject(TEXT_DRONES);
    const budget = sceneBudget(project, scene, project.droneCount);
    expect(budget.objects.map((o) => o.count)).toEqual([TEXT_DRONES, LINE_DRONES, LINE_DRONES]);
    expect(budget.active).toBe(FLEET);
    expect(budget.availableDrones).toBe(0);
    expect(budget.overCapacity).toBe(false);
    const lineSources = project.formations.filter((formation) => formation.kind === "line");
    expect(lineSources).toHaveLength(1);
    expect(lineSources[0]!.points.every((point) => Math.abs(point[1]) <= 1e-9)).toBe(true);
    expect(scene.objects[1]!.transform.position[1]).toBe(40);
    expect(scene.objects[2]!.transform.position[1]).toBe(34);
  });

  it("reports the canonical reserve when the composition uses fewer drones", () => {
    const { project, scene } = composedProject(70);
    const budget = sceneBudget(project, scene, project.droneCount);
    expect(budget.active).toBe(70 + LINE_DRONES + LINE_DRONES);
    expect(budget.availableDrones).toBe(FLEET - 110);
    expect(budget.overCapacity).toBe(false);
  });

  it("applies WAVE only to the SVG object and leaves the lines static", () => {
    const composed = composedProject(TEXT_DRONES);
    const { project, scene } = waveOnObject(composed.project, composed.scene, composed.ids.text);
    const byId = new Map(scene.objects.map((o) => [o.id, o]));
    expect(byId.get(composed.ids.text)!.source.kind).toBe("DYNAMIC");
    expect(byId.get(composed.ids.line1)!.source.kind).toBe("STATIC");
    expect(byId.get(composed.ids.line2)!.source.kind).toBe("STATIC");
    // The budget is unchanged by animation: still exactly the fleet.
    expect(sceneBudget(project, scene, project.droneCount).active).toBe(FLEET);
  });

  it("keeps lighting independently targeted per object", () => {
    const composed = composedProject(TEXT_DRONES);
    const preset = findLightingPreset("PULSE_2")!;
    const effects = [composed.ids.text, composed.ids.line1].map((instanceId, i) =>
      createEffectFromPreset(
        preset,
        { kind: "SCENE_OBJECT", clipId: "c-scene", instanceId },
        { anchor: "SCENE_START", start: 0, priority: i, idSeed: 100 + i },
      ),
    );
    const targets = effects.map((e) =>
      e.target.kind === "SCENE_OBJECT" ? e.target.instanceId : "SCENE",
    );
    expect(targets).toEqual([composed.ids.text, composed.ids.line1]);
    expect(targets).not.toContain(composed.ids.line2);
    const byObject = composed.scene.objects.map((o) => o.lighting?.color ?? null);
    expect(byObject[1]).toEqual([255, 90, 60]);
    expect(byObject[2]).toEqual([60, 160, 255]);
  });

  it("survives save / reopen with every object, transform and motion intact", () => {
    const composed = composedProject(TEXT_DRONES);
    const { project } = waveOnObject(composed.project, composed.scene, composed.ids.text);
    const json = projectFileToJson(
      serializeProject(project, {
        planning: defaultPlanningState(),
        referenceLayer: null,
        savedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const reopened = parseProjectFile(json).project;
    const scene = reopened.scenes!.find((s) => s.id === "c-scene")!;
    expect(scene.objects).toHaveLength(3);
    expect(scene.objects.map((o) => o.requestedDroneCount)).toEqual([
      TEXT_DRONES,
      LINE_DRONES,
      LINE_DRONES,
    ]);
    expect(scene.objects[0]!.source.kind).toBe("DYNAMIC");
    expect(reopened.dynamicFormations?.map((d) => d.id)).toEqual(["d-wave"]);
    expect(sceneBudget(reopened, scene, reopened.droneCount).active).toBe(FLEET);
  });

  it("is undoable and redoable as plain immutable revisions", () => {
    const composed = composedProject(TEXT_DRONES);
    const before = composed.project;
    const after = waveOnObject(before, composed.scene, composed.ids.text).project;
    // UNDO == the previous immutable snapshot; nothing mutated in place.
    expect(before.scenes![0]!.objects[0]!.source.kind).toBe("STATIC");
    expect(after.scenes![0]!.objects[0]!.source.kind).toBe("DYNAMIC");
    expect(before.dynamicFormations ?? []).toHaveLength(0);
    // REDO reproduces the identical revision deterministically.
    const redo = waveOnObject(before, composed.scene, composed.ids.text).project;
    expect(JSON.stringify(redo)).toBe(JSON.stringify(after));
  });

  it("validates and exports through the canonical authorities", () => {
    const composed = composedProject(TEXT_DRONES);
    const { project } = waveOnObject(composed.project, composed.scene, composed.ids.text);
    const { report } = analyzeFullShow(project, {
      sampleRate: 8,
      assignmentStrategy: "nearestNeighbor",
    });
    expect(report.exportReadiness.status).toBeDefined();
    expect(report.droneCount).toBe(FLEET);

    const eligibility = evaluateExportEligibility(report, false);
    expect(eligibility.canExportProjectFile).toBe(true);

    const result = buildEsspExportPackage({
      project,
      plan: planFor(project),
      fullShow: forcedReady(report),
      fullShowStale: false,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.blockers).toEqual([]);
    expect(result.zip).not.toBeNull();
  }, 30_000);
});

/**
 * OBJECT ISOLATION OF SELECTION EFFECTS.
 *
 * The everyday selection authority must never widen an effect: an effect
 * authored while the SVG text object is selected may only change the LEDs of
 * the drones that belong to that object. Evaluation is the canonical engine.
 */
describe("selection effect isolation — SVG text + native underlines", () => {
  const PLAYHEAD = 30;
  /** Leaves a reserve, so participation attributes drones per scene object. */
  const ISO_TEXT = 70;

  function withSelectionEffect(objectIds: readonly string[]) {
    const composed = composedProject(ISO_TEXT);
    const targets = selectionLightingTargets("c-scene", {
      mode: "OBJECT",
      objects: composed.scene.objects.map((o) => ({ id: o.id, name: o.name })),
      selectedObjectIds: objectIds,
      primaryObjectId: objectIds[0] ?? null,
      selectedPointIds: [],
      droneCountOf: () => 0,
    });
    const preset = findSelectionLightingPreset("SOLID_COLOUR");
    const effects = targets.map((target, i) =>
      createEffectFromPreset(findLightingPreset(preset.canonicalPresetId)!, target, {
        anchor: "ABSOLUTE",
        start: PLAYHEAD,
        priority: i,
        idSeed: 500 + i,
        parameters: selectionLightingParameters(preset, {
          primary: [10, 240, 30],
          secondary: [10, 240, 30],
          axis: "X",
        }),
      }),
    );
    const project: ShowProject = {
      ...composed.project,
      lighting: { schemaVersion: 1, effects },
    };
    return { composed, project, effects };
  }

  const changedCount = (
    project: ShowProject,
    baseline: readonly { readonly r: number; readonly g: number; readonly b: number }[],
    participation: Parameters<typeof projectLightingAt>[0]["participation"],
  ) =>
    projectLightingAt({ project, participation }, PLAYHEAD).filter(
      (state, i) =>
        state.r !== baseline[i]!.r || state.g !== baseline[i]!.g || state.b !== baseline[i]!.b,
    );

  it("targets only the selected object and leaves the other objects untouched", () => {
    const ids = composedProject(ISO_TEXT).ids;
    const selected = withSelectionEffect([ids.text]);
    expect(selected.effects).toHaveLength(1);
    expect(selected.effects[0]!.target.kind).toBe("SCENE_OBJECT");
    expect(selected.effects[0]!.anchor).toBe("ABSOLUTE");
    expect(selected.effects[0]!.start).toBe(PLAYHEAD);

    const baselineProject = composedProject(ISO_TEXT).project;
    const participation = planFor(baselineProject).participation;
    const baseline = projectLightingAt({ project: baselineProject, participation }, PLAYHEAD);
    const changed = changedCount(selected.project, baseline, participation);

    expect(baseline).toHaveLength(FLEET);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(ISO_TEXT);
    expect(changed.every((state) => state.r === 10 && state.g === 240 && state.b === 30)).toBe(true);
  }, 30_000);

  it("covers strictly more drones when both underlines are selected too", () => {
    const ids = composedProject(ISO_TEXT).ids;
    const one = withSelectionEffect([ids.text]);
    const all = withSelectionEffect([ids.text, ids.line1, ids.line2]);
    expect(all.effects).toHaveLength(3);
    expect(
      all.effects.map((e) => (e.target.kind === "SCENE_OBJECT" ? e.target.instanceId : "")),
    ).toEqual([ids.text, ids.line1, ids.line2]);

    const baselineProject = composedProject(ISO_TEXT).project;
    const participation = planFor(baselineProject).participation;
    const baseline = projectLightingAt({ project: baselineProject, participation }, PLAYHEAD);
    expect(changedCount(all.project, baseline, participation).length).toBeGreaterThan(
      changedCount(one.project, baseline, participation).length,
    );
  }, 30_000);
});
