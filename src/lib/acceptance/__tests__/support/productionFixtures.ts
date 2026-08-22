/**
 * PRODUCTION ACCEPTANCE FIXTURES.
 *
 * Shared, deterministic inputs for the production authoring + import/export
 * acceptance suites. This module builds fixtures ONLY; every piece of domain
 * maths (planning, validation, serialization, export, coordinates, lighting) is
 * called through the canonical authorities, never re-implemented here.
 *
 * The imported archives are SYNTHETIC files built with the observed ESSP
 * profile. They prove the studio's own round-trip contract; they are NOT
 * evidence of vendor or hardware certification.
 */
import { buildSyntheticEssp } from "@/lib/import/essp/codec";
import { buildReferenceShow } from "@/lib/import/essp/reference";
import { analyzeReferenceShow } from "@/lib/import/essp/forensics/report";
import {
  extractReferenceTimeline,
  referenceShowFromLayer,
  migrateReferenceLayer,
  reseedReferenceSignatures,
} from "@/lib/import/essp/native";
import type { ReferenceTrajectoryLayer } from "@/lib/import/essp/native/types";
import type { ReferenceShow } from "@/lib/import/essp/types";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { makeFormation } from "@/lib/show/formations";
import {
  createEffectFromPreset,
  findLightingPreset,
  EMPTY_LIGHTING_PROGRAM,
} from "@/lib/show/lighting";
import { analyzeFullShow } from "@/lib/show/fullshow";
import type { FullShowValidationReport } from "@/lib/show/fullshow/types";
import type { AssignmentStrategyId } from "@/lib/show/assignment";
import { buildShowPlan } from "@/lib/show/trajectory/schedule";
import type { ShowProject, TimelineClip } from "@/lib/show/types";
import {
  defaultPlanningState,
  parseProjectFile,
  projectFileToJson,
  serializeProject,
  type ProjectEditorPreferences,
  type ProjectPlanningState,
} from "@/lib/project";
import { buildComplexProject } from "@/lib/show/__tests__/integration/fixtures";

export const ACCEPTANCE_STRATEGY = "nearestNeighbor" as const;
/**
 * Authored shows in this pack keep the identity mapping: the formations are
 * index-aligned by construction, so the optimal mapping is the identity one —
 * and it is a USER-SELECTABLE strategy, so it survives save/reopen.
 */
export const AUTHORED_STRATEGY = "optimalDistance" as const;
export const SOURCE_POSITION_RATE_HZ = 8;
export const SOURCE_RGB_RATE_HZ = 12;
/** Deterministic export timestamp: keeps generated manifests comparable. */
export const FIXED_GENERATED_AT = "2026-01-01T00:00:00.000Z";

/* --------------------------------------------------------------- authored */

/**
 * Deterministic authored production project: TAKEOFF clip, SHOW clips with
 * transitions, a lighting effect and an explicit LANDING clip. Geometry comes
 * from the canonical formation generators; nothing is hand-tabulated here.
 *
 * The formations are index-aligned scalings of one grid, which is what keeps
 * the show inside the altitude ceiling and separation minimum for any fleet
 * size — the acceptance gate is asserted on the REAL report, so the fixture
 * has to be a genuinely flyable show, not a forced-ready one.
 */
export function authoredProductionProject(fleet = 200): ShowProject {
  const base = createDefaultProject(fleet);
  const area = base.area;
  const formations = [
    makeFormation("f-prod-takeoff", "Takeoff Grid", "grid", fleet, area, {
      altitude: 25,
      size: 120,
    }),
    makeFormation("f-prod-wide", "Wide Grid", "grid", fleet, area, { altitude: 60, size: 150 }),
    makeFormation("f-prod-wave", "Wave", "wave", fleet, area, {
      altitude: 60,
      size: 150,
      amplitude: 8,
    }),
    makeFormation("f-prod-tight", "Tight Grid", "grid", fleet, area, { altitude: 45, size: 110 }),
  ];
  const timeline: TimelineClip[] = [
    {
      id: "c-prod-takeoff",
      formationId: "f-prod-takeoff",
      start: 0,
      transition: 30,
      hold: 8,
      easing: "minJerk",
      color: [90, 170, 255],
      effect: "solid",
      phase: "TAKEOFF",
    },
    {
      id: "c-prod-wide",
      formationId: "f-prod-wide",
      start: 38,
      transition: 30,
      hold: 10,
      easing: "minJerk",
      color: [255, 210, 120],
      effect: "solid",
      phase: "SHOW",
    },
    {
      id: "c-prod-wave",
      formationId: "f-prod-wave",
      start: 78,
      transition: 30,
      hold: 10,
      easing: "minJerk",
      color: [120, 255, 200],
      effect: "solid",
      phase: "SHOW",
    },
    {
      id: "c-prod-tight",
      formationId: "f-prod-tight",
      start: 118,
      transition: 30,
      hold: 10,
      easing: "minJerk",
      color: [200, 160, 255],
      effect: "solid",
      phase: "SHOW",
    },
    {
      id: "c-prod-landing",
      formationId: "f-prod-tight",
      start: 158,
      transition: 34,
      hold: 4,
      easing: "minJerk",
      color: [80, 120, 220],
      effect: "solid",
      phase: "LANDING",
    },
  ];
  const preset = findLightingPreset("COLOR_TRANSITION");
  const program = base.lighting ?? EMPTY_LIGHTING_PROGRAM;
  const lighting = preset
    ? {
        ...program,
        effects: [
          createEffectFromPreset(
            preset,
            { kind: "SCENE", clipId: "c-prod-wide" },
            { idSeed: 42, start: 40 },
          ),
        ],
      }
    : program;
  return {
    ...base,
    name: `Authored Production Show (${fleet})`,
    formations,
    timeline,
    lighting,
  };
}

/**
 * Structurally rich audit fixture (dynamic formations, scenes, participation).
 * Deliberately NOT safety-clean: used for round-trip/structure assertions only.
 */
export function complexStructuralProject(fleet = 200): ShowProject {
  return buildComplexProject(fleet, Math.min(150, fleet)).project;
}


/* --------------------------------------------------------------- imported */

export interface ImportedFixture {
  readonly show: ReferenceShow;
  readonly project: ShowProject;
  readonly layer: ReferenceTrajectoryLayer;
  readonly sourceBytes: readonly Uint8Array[];
  readonly sourceNames: readonly string[];
}

function rgbTrack(index: number, frames: number): number[][] {
  const base = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ];
  const c = base[index % base.length]!;
  return Array.from({ length: frames }, (_, f) =>
    Math.floor(f / SOURCE_RGB_RATE_HZ) % 2 === 0 ? [...c] : [17, 34, 51],
  );
}

/** Gentle hold / move / hold plateaus in raw ESSP units (1 unit = 1 cm). */
function trajectory(index: number, seconds: number): number[][] {
  const x0 = (index % 2) * 600 - 300;
  const y0 = Math.floor(index / 2) * 600 - 300;
  const ramp = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const out: number[][] = [];
  for (let f = 0; f <= seconds * SOURCE_POSITION_RATE_HZ; f += 1) {
    const t = f / SOURCE_POSITION_RATE_HZ;
    const climb = ramp(t, 0, 10) * 2500;
    const drift = ramp(t, 20, 30) * 600;
    const rise = ramp(t, 40, 46) * 800;
    const land = ramp(t, seconds - 8, seconds);
    const z = (climb + rise) * (1 - land);
    out.push([Math.round(x0 + drift), y0, Math.round(z)]);
  }
  return out;
}

export interface SyntheticEsspFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Deterministic synthetic archive: `count` files, `seconds` long. */
export function syntheticEsspArchive(count = 4, seconds = 60): SyntheticEsspFile[] {
  return Array.from({ length: count }, (_, i) => {
    const xyz = trajectory(i, seconds);
    return {
      name: `${i + 1}.essp`,
      bytes: buildSyntheticEssp({
        xyz,
        rgb: rgbTrack(i, Math.ceil((xyz.length / SOURCE_POSITION_RATE_HZ) * SOURCE_RGB_RATE_HZ)),
      }),
    };
  });
}

/**
 * CUSTOMER-SHAPED COLOUR TRACK.
 *
 * The real customer archive is dominated by near-WHITE frames with black
 * blackout stretches and saturated accents, and it holds one colour per 12 Hz
 * frame (never blends). That shape is what makes a lost LED authority look like
 * a plain white show instead of an obviously broken one, so the regression
 * fixture reproduces it byte-for-byte in kind.
 */
function customerShapedRgbTrack(index: number, frames: number): number[][] {
  const palette = [
    [253, 253, 255],
    [221, 228, 255],
    [84, 84, 84],
    [0, 0, 0],
    [0, 238, 201],
    [255, 255, 255],
  ];
  return Array.from({ length: frames }, (_, f) => {
    // One palette step per whole colour second: every step is an exact RGB
    // transition boundary on the independent 12 Hz clock.
    const step = Math.floor(f / SOURCE_RGB_RATE_HZ) + index;
    return [...palette[step % palette.length]!];
  });
}

/** Deterministic archive whose LED track matches the real customer profile. */
export function customerShapedEsspArchive(count = 12, seconds = 40): SyntheticEsspFile[] {
  return Array.from({ length: count }, (_, i) => {
    const xyz = trajectory(i, seconds);
    return {
      name: `${i + 1}.essp`,
      bytes: buildSyntheticEssp({
        xyz,
        rgb: customerShapedRgbTrack(
          i,
          Math.ceil((xyz.length / SOURCE_POSITION_RATE_HZ) * SOURCE_RGB_RATE_HZ),
        ),
      }),
    };
  });
}

/** Full import path: archive -> reference show -> extracted native project. */
export async function importedFixture(count = 4, seconds = 60): Promise<ImportedFixture> {
  return importArchiveFixture(syntheticEsspArchive(count, seconds));
}

/** Same import path, driven by an explicit archive. */
export async function importArchiveFixture(
  files: readonly SyntheticEsspFile[],
): Promise<ImportedFixture> {
  const show = await buildReferenceShow(files.map((f) => ({ name: f.name, bytes: f.bytes })));
  const extraction = extractReferenceTimeline(show, analyzeReferenceShow(show));
  const base = createDefaultProject();
  const project: ShowProject = {
    ...base,
    name: "Imported Acceptance Archive",
    droneCount: extraction.droneCount,
    formations: [...extraction.formations],
    timeline: [...extraction.timeline],
    dynamicFormations: [...extraction.dynamicFormations],
    scenes: [...extraction.scenes],
    lighting: extraction.lighting,
    ...(base.preShow ? { preShow: { ...base.preShow, enabled: false } } : {}),
  };
  const layer = reseedReferenceSignatures(project, extraction.layer, {
    assignmentStrategy: ACCEPTANCE_STRATEGY,
    transitionOverrides: {},
  });
  return {
    show,
    project,
    layer,
    sourceBytes: files.map((f) => f.bytes),
    sourceNames: files.map((f) => f.name),
  };
}


/* ------------------------------------------------ canonical pipeline calls */

export function planFor(project: ShowProject, strategy: AssignmentStrategyId = ACCEPTANCE_STRATEGY) {
  return buildShowPlan(project, { assignmentStrategy: strategy });
}

/** Authored fixtures are index-aligned: plan them with the identity mapping. */
export function planAuthored(project: ShowProject) {
  return planFor(project, AUTHORED_STRATEGY);
}

export function validateAuthored(
  project: ShowProject,
  sampleRate = SOURCE_POSITION_RATE_HZ,
): FullShowValidationReport {
  return validate(project, null, sampleRate, AUTHORED_STRATEGY);
}

export function validate(
  project: ShowProject,
  reference?: { show: ReferenceShow; layer: ReferenceTrajectoryLayer } | null,
  sampleRate = SOURCE_POSITION_RATE_HZ,
  strategy: AssignmentStrategyId = ACCEPTANCE_STRATEGY,
): FullShowValidationReport {
  return analyzeFullShow(project, {
    sampleRate,
    assignmentStrategy: strategy,
    ...(reference ? { reference } : {}),
  }).report;
}

/**
 * Forces READY on a REAL report. Used ONLY where the assertion is about bytes,
 * clocks or determinism and must not depend on fixture safety content. The gate
 * itself is asserted separately against unmodified reports.
 */
export function forcedReady(report: FullShowValidationReport): FullShowValidationReport {
  return {
    ...report,
    exportReadiness: { status: "READY", blockers: [], warnings: [] },
  } as unknown as FullShowValidationReport;
}

/* ----------------------------------------------------------- save / reopen */

export interface SaveResult {
  readonly json: string;
  readonly bytes: number;
  readonly project: ShowProject;
  readonly planning: ProjectPlanningState;
  readonly referenceLayer: ReferenceTrajectoryLayer | null;
  readonly editor: ProjectEditorPreferences | undefined;
  /** Raw parsed envelope, for "not persisted" assertions. */
  readonly envelope: Record<string, unknown>;
}

/** Canonical Save -> Reopen through the real serializer/parser. */
export function saveAndReopen(input: {
  project: ShowProject;
  planning: ProjectPlanningState;
  referenceLayer?: ReferenceTrajectoryLayer | null;
  editor?: ProjectEditorPreferences;
}): SaveResult {
  const file = serializeProject(input.project, {
    planning: input.planning,
    referenceLayer: input.referenceLayer ?? null,
    ...(input.editor ? { editor: input.editor } : {}),
    savedAt: FIXED_GENERATED_AT,
  });
  const json = projectFileToJson(file);
  const parsed = parseProjectFile(json);
  return {
    json,
    bytes: new TextEncoder().encode(json).length,
    project: parsed.project,
    planning: parsed.planning ?? defaultPlanningState(),
    referenceLayer: parsed.referenceLayer ?? null,
    editor: parsed.editor,
    envelope: JSON.parse(json) as Record<string, unknown>,
  };
}

/** Rebuilds the reference authority the way the studio does after reopen. */
export function rebuildReference(layer: ReferenceTrajectoryLayer): {
  show: ReferenceShow;
  layer: ReferenceTrajectoryLayer;
} {
  const migrated = migrateReferenceLayer(JSON.parse(JSON.stringify(layer)));
  return { show: referenceShowFromLayer(migrated), layer: migrated };
}

/** Share of a saved project file taken by stored source ESSP base64. */
export function sourcePayloadBytes(layer: ReferenceTrajectoryLayer | null): number {
  if (!layer) return 0;
  return layer.drones.reduce((sum, d) => sum + (d.fileBase64?.length ?? 0), 0);
}
