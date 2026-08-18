/**
 * CROSS-SUBSYSTEM INTEGRATION FIXTURES (audit pass).
 *
 * Builds ONE realistic 200-drone project that exercises, together:
 *   pre-show, partial formation, multi-object scene, SVG/vector formation,
 *   dynamic formation (wing groups), lighting, markers and participation.
 *
 * Pure test helper: no React, no Three.js, no I/O beyond reading an SVG fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_AREA, createDefaultProject } from "../../defaultProject";
import { makeFormation } from "../../formations";
import { createMarker, createSection } from "../../markers";
import { DEFAULT_PRE_SHOW, patchPreShowConfig } from "../../preshow";
import { resolveParticipationSettings } from "../../participation";
import { addObject, emptyScene, upsertScene, type FormationScene } from "../../scene";
import { generateSvgFormationPoints, makeSvgFormation, resolveSvgParams } from "../../svg/formation";
import { parseSvg } from "../../svg/parser";
import type { SvgAsset } from "../../svg/types";
import {
  PIGEON_DESIGN,
  compileVisualFormation,
  dynamicFromCompiled,
  formationFromCompiled,
} from "@/lib/visual";
import { createEffectFromPreset, findLightingPreset } from "../../lighting";
import type { LightingEffectInstance } from "../../lighting";
import type { Formation, ShowProject, TimelineClip, Vector3Tuple } from "../../types";

const SVG_FIXTURES = join(__dirname, "..", "..", "svg", "__fixtures__");

export function svgFixtureAsset(name = "donut-evenodd.svg"): SvgAsset {
  const source = readFileSync(join(SVG_FIXTURES, name), "utf8");
  return { id: `asset-${name}`, name, fileName: name, geometry: parseSvg(source, { fileName: name }) };
}

/** Deterministic SVG formation with EXACTLY `count` points. */
export function svgFormation(id: string, count: number, name = "Logo"): Formation {
  const asset = svgFixtureAsset();
  const params = resolveSvgParams(count, { altitude: 45, width: 90 });
  return makeSvgFormation(id, name, asset, generateSvgFormationPoints(asset.geometry, params));
}

/** Visually compiled pigeon with EXACTLY `count` points + its dynamic twin. */
export function pigeonAssets(count: number) {
  const compiled = compileVisualFormation(PIGEON_DESIGN, count, { width: 110, altitude: 55 });
  const formation = formationFromCompiled(compiled, { id: "f-pigeon", name: "Pigeon" });
  const dynamic = dynamicFromCompiled(formation, PIGEON_DESIGN, compiled, {
    id: "dyn-pigeon",
    name: "Pigeon (wings)",
    duration: 4,
  });
  return { compiled, formation, dynamic };
}

export function clip(over: Partial<TimelineClip> & Pick<TimelineClip, "id" | "formationId" | "start">): TimelineClip {
  return {
    transition: 8,
    hold: 10,
    easing: "minJerk",
    color: [255, 255, 255],
    effect: "solid",
    phase: "SHOW",
    ...over,
  } as TimelineClip;
}

export interface ComplexProject {
  readonly project: ShowProject;
  /** Scene id === clip id. */
  readonly sceneIds: readonly string[];
  readonly pigeonPointCount: number;
}

/** Composite scene helper: one object per entry, with an explicit drone budget. */
export function composeScene(
  project: ShowProject,
  sceneId: string,
  name: string,
  entries: readonly {
    formationId?: string;
    dynamicFormationId?: string;
    label: string;
    count: number;
    position?: Vector3Tuple;
  }[],
): { project: ShowProject; scene: FormationScene } {
  let scene = emptyScene(sceneId, name);
  for (const entry of entries) {
    scene = addObject(project, scene, {
      source: entry.dynamicFormationId
        ? { kind: "DYNAMIC", dynamicFormationId: entry.dynamicFormationId }
        : { kind: "STATIC", formationId: entry.formationId! },
      name: entry.label,
      requestedDroneCount: entry.count,
      ...(entry.position ? { position: entry.position } : {}),
    }).scene;
  }
  return { project: upsertScene(project, scene), scene };
}

function lightingEffects(sceneIds: readonly string[]): LightingEffectInstance[] {
  const presets = ["FADE_IN", "LEFT_TO_RIGHT", "CENTER_TO_OUTSIDE", "PULSE_2", "COLOR_TRANSITION"];
  const effects: LightingEffectInstance[] = [];
  presets.forEach((presetId, i) => {
    const preset = findLightingPreset(presetId);
    if (!preset) return;
    const clipId = sceneIds[i % sceneIds.length]!;
    effects.push({
      ...createEffectFromPreset(preset, { kind: "SCENE", clipId }, { idSeed: 1000 + i }),
      id: `fx-${presetId}`,
      anchor: "SCENE_START",
      start: 0,
    });
  });
  return effects;
}

/**
 * THE COMPLEX PROJECT (audit section B).
 *   Scene 1  Pigeon, 150 active of `fleet`
 *   Scene 2  Heart 80 + Star 40 (disjoint objects)
 *   Scene 3  SVG logo, `fleet` active
 */
export function buildComplexProject(fleet = 200, pigeonPoints = 150): ComplexProject {
  const base = createDefaultProject(fleet);
  const { formation: pigeon, dynamic } = pigeonAssets(pigeonPoints);
  const heart = makeFormation("f-heart", "Heart", "heart", 80, DEFAULT_AREA, { altitude: 45 });
  const star = makeFormation("f-star", "Star", "circle", 40, DEFAULT_AREA, { altitude: 65 });
  const logo = svgFormation("f-logo", fleet);

  const clips: TimelineClip[] = [
    clip({ id: "scene-1", formationId: pigeon.id, start: 0, dynamicFormationId: dynamic.id }),
    clip({ id: "scene-2", formationId: heart.id, start: 18 }),
    clip({ id: "scene-3", formationId: logo.id, start: 36 }),
    // Explicit LANDING clip: geometry is ignored, every drone returns to its pad.
    clip({ id: "scene-land", formationId: logo.id, start: 54, transition: 12, hold: 2, phase: "LANDING" }),
  ];

  let project: ShowProject = {
    ...base,
    name: "Audit Complex 200",
    formations: [...base.formations, pigeon, heart, star, logo],
    dynamicFormations: [dynamic],
    timeline: clips,
    preShow: patchPreShowConfig(DEFAULT_PRE_SHOW, { enabled: true }),
    participation: resolveParticipationSettings({
      defaultPolicy: "SMART_PREPARE",
      lookAheadScenes: 2,
    }),
    markers: [
      createMarker({ id: "m-1", time: 0, label: "Show start", type: "MUSIC" }),
      createMarker({ id: "m-2", time: 18, label: "Heart + Star", type: "CHOREOGRAPHY" }),
    ],
    musicSections: [
      createSection({ id: "s-1", start: 0, end: 18, label: "Intro", type: "INTRO" }),
      createSection({ id: "s-2", start: 18, end: 52, label: "Drop", type: "DROP" }),
    ],
  };

  project = composeScene(project, "scene-1", "Pigeon", [
    { dynamicFormationId: dynamic.id, label: "Pigeon", count: pigeonPoints },
  ]).project;
  project = composeScene(project, "scene-2", "Heart + Star", [
    { formationId: heart.id, label: "Heart", count: 80, position: [-45, 0, 0] },
    { formationId: star.id, label: "Star", count: 40, position: [45, 0, 0] },
  ]).project;
  project = composeScene(project, "scene-3", "Logo", [
    { formationId: logo.id, label: "Logo", count: fleet },
  ]).project;

  project = {
    ...project,
    lighting: { schemaVersion: 1, effects: lightingEffects(["scene-1", "scene-2", "scene-3"]) },
  };

  return { project, sceneIds: ["scene-1", "scene-2", "scene-3"], pigeonPointCount: pigeonPoints };
}
