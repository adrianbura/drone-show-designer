import { DYNAMIC_FORMATION_ALGORITHM_VERSION } from "./dynamic/types";
import { makeFormation } from "./formations";
import { sanitizeMarkers, sanitizeSections } from "./markers";
import type { PhaseAltitudes, SafetyLimits, ShowArea, ShowProject } from "./types";
import {
  FORMATION_ALGORITHM_VERSION,
  SCHEMA_VERSION,
  TRAJECTORY_ALGORITHM_VERSION,
} from "./types";

export const DEFAULT_AREA: ShowArea = { width: 140, depth: 140, height: 100 };

export const DEFAULT_LIMITS: SafetyLimits = {
  maxVelocity: 12,
  maxAcceleration: 5,
  maxJerk: 10,
  maxYawRate: 90,
  minSeparation: 2.5,
  minAltitude: 2,
  maxAltitude: 95,
};

/** Phase altitude contract (metres, +Y up). Landing always terminates at 0. */
export const DEFAULT_ALTITUDES: PhaseAltitudes = { takeoff: 15, show: 40, landing: 0 };

export const DEFAULT_SEED = 20260814;

/**
 * CLEAN STARTUP project factory.
 *
 * A new project opens with an EMPTY TIMELINE: no demo choreography is ever
 * injected, so the operator never has to delete content they did not author.
 * The formation palette is still pre-generated (authoring material only — a
 * formation is not show content until a clip references it), and no audio track
 * is attached. Deterministic: no randomness at module scope or call time.
 */
export function createDefaultProject(droneCount = 48): ShowProject {
  const area = DEFAULT_AREA;
  const alt = DEFAULT_ALTITUDES;
  const formations = [
    makeFormation("f-launch", "Launch Grid", "grid", droneCount, area, {
      size: 60,
      altitude: alt.takeoff,
    }),
    makeFormation("f-sphere", "Orb", "sphere", droneCount, area, { size: 56, altitude: alt.show }),
    makeFormation("f-helix", "Ascending Helix", "helix", droneCount, area, { size: 45, height: 55 }),
    makeFormation("f-heart", "Heart", "heart", droneCount, area, { size: 76, altitude: 42 }),
    makeFormation("f-approach", "Landing Approach", "grid", droneCount, area, {
      size: 60,
      altitude: 8,
    }),
  ];

  return {
    id: "prj-demo",
    name: "Untitled Show",
    droneCount,
    area,
    limits: { ...DEFAULT_LIMITS },
    audio: { name: "", bpm: 120, offset: 0, duration: 0, attached: false },
    altitudes: { ...alt },
    seed: DEFAULT_SEED,
    versions: {
      schemaVersion: SCHEMA_VERSION,
      trajectoryAlgorithmVersion: TRAJECTORY_ALGORITHM_VERSION,
      formationAlgorithmVersion: FORMATION_ALGORITHM_VERSION,
      dynamicFormationAlgorithmVersion: DYNAMIC_FORMATION_ALGORITHM_VERSION,
    },
    formations,
    dynamicFormations: [],
    // Clean startup: authoring begins from an empty timeline.
    timeline: [],
    markers: [],
    musicSections: [],
  };
}

/**
 * DEMO show factory — explicit opt-in only.
 *
 * Never used at startup (see createDefaultProject): it exists so tests, docs and
 * manual exploration can obtain a fully authored deterministic timeline.
 */
export function createDemoProject(droneCount = 48): ShowProject {
  const base = createDefaultProject(droneCount);
  return {
    ...base,
    timeline: [
      {
        id: "c-1",
        formationId: "f-launch",
        start: 0,
        transition: 22,
        hold: 8,
        easing: "minJerk",
        color: [80, 200, 255],
        effect: "solid",
        phase: "TAKEOFF",
      },
      {
        id: "c-2",
        formationId: "f-sphere",
        start: 30,
        transition: 22,
        hold: 8,
        easing: "minJerk",
        color: [120, 255, 190],
        effect: "pulse",
        phase: "SHOW",
      },
      {
        id: "c-3",
        formationId: "f-helix",
        start: 60,
        transition: 22,
        hold: 8,
        easing: "smooth",
        color: [255, 190, 90],
        effect: "rainbow",
        phase: "SHOW",
      },
      {
        id: "c-4",
        formationId: "f-heart",
        start: 90,
        transition: 22,
        hold: 8,
        easing: "minJerk",
        color: [255, 90, 130],
        effect: "twinkle",
        phase: "SHOW",
      },
      {
        id: "c-5",
        formationId: "f-approach",
        start: 120,
        transition: 16,
        hold: 2,
        easing: "minJerk",
        color: [90, 130, 255],
        effect: "solid",
        phase: "SHOW",
      },
      {
        // Explicit LANDING phase: ignores formation geometry and returns every
        // drone to its own home pad at y = 0.
        id: "c-6",
        formationId: "f-approach",
        start: 138,
        transition: 12,
        hold: 2,
        easing: "minJerk",
        color: [70, 100, 200],
        effect: "solid",
        phase: "LANDING",
      },
    ],
  };
}

/**
 * Backward compatibility: projects saved before schema 1.0 lack phase
 * altitudes, versions, seed, jerk/min-altitude limits and clip phases. Nothing
 * is discarded — missing fields get documented defaults.
 */
export function migrateProject(input: unknown): ShowProject {
  const raw = (input ?? {}) as Partial<ShowProject> & Record<string, unknown>;
  const limits = (raw.limits ?? {}) as Partial<SafetyLimits>;
  const timeline = Array.isArray(raw.timeline) ? raw.timeline : [];
  const count = typeof raw.droneCount === "number" ? raw.droneCount : 48;
  const base = createDefaultProject(count);
  const lastIndex = timeline.length - 1;

  return {
    ...base,
    ...raw,
    id: raw.id ?? base.id,
    name: raw.name ?? base.name,
    droneCount: count,
    area: (raw.area as ShowArea) ?? base.area,
    audio: raw.audio ?? base.audio,
    formations: Array.isArray(raw.formations) && raw.formations.length > 0 ? raw.formations : base.formations,
    limits: {
      maxVelocity: limits.maxVelocity ?? DEFAULT_LIMITS.maxVelocity,
      maxAcceleration: limits.maxAcceleration ?? DEFAULT_LIMITS.maxAcceleration,
      maxJerk: limits.maxJerk ?? DEFAULT_LIMITS.maxJerk,
      maxYawRate: limits.maxYawRate ?? DEFAULT_LIMITS.maxYawRate,
      minSeparation: limits.minSeparation ?? DEFAULT_LIMITS.minSeparation,
      minAltitude: limits.minAltitude ?? DEFAULT_LIMITS.minAltitude,
      maxAltitude: limits.maxAltitude ?? DEFAULT_LIMITS.maxAltitude,
    },
    altitudes: raw.altitudes ?? { ...DEFAULT_ALTITUDES },
    seed: typeof raw.seed === "number" ? raw.seed : DEFAULT_SEED,
    versions: {
      schemaVersion: SCHEMA_VERSION,
      trajectoryAlgorithmVersion: TRAJECTORY_ALGORITHM_VERSION,
      formationAlgorithmVersion: FORMATION_ALGORITHM_VERSION,
      dynamicFormationAlgorithmVersion: DYNAMIC_FORMATION_ALGORITHM_VERSION,
    },
    dynamicFormations: Array.isArray(raw.dynamicFormations) ? raw.dynamicFormations : [],
    // MULTI-FORMATION SCENES: absent in pre-7.3.5 projects. A clip without a
    // scene entry is synthesised as a single-object scene on read, so migration
    // never changes geometry or timing (see show/scene/migrate.ts).
    scenes: sanitizeScenes(raw.scenes),
    // Editor annotations are restored defensively; they are never required.
    markers: sanitizeMarkers(raw.markers),
    musicSections: sanitizeSections(raw.musicSections),
    // An empty timeline is a VALID authored state and is preserved as-is: no
    // demo choreography is ever re-injected into a reopened project.
    timeline: timeline.map((clip, i) => ({
      ...clip,
      // Pre-1.0 projects had no phases: first clip is the take-off, the
      // last one is the landing, everything between is show content.
      phase: clip.phase ?? (i === 0 ? "TAKEOFF" : i === lastIndex ? "LANDING" : "SHOW"),
    })),
  };
}

/** @deprecated kept for older call sites. */
export const migrateProjectV1ToV2 = migrateProject;
