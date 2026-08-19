/**
 * Versioned serialization of the editable studio project.
 *
 * Save -> load -> save must preserve canonical editable show semantics, so the
 * writer never derives values and the reader never guesses: unknown future
 * schema versions fail loudly, malformed files are rejected before they can
 * replace the open project, and every accepted file is normalised through the
 * canonical project migration.
 */
import { SELECTABLE_ASSIGNMENT_STRATEGIES, type AssignmentStrategyId } from "../show/assignment";
import { migrateProject } from "../show/defaultProject";
import type { ClipTransitionOverride } from "../show/trajectory/schedule";
import { SCHEMA_VERSION, type ShowProject } from "../show/types";
import {
  DEFAULT_PLANNING_STRATEGY,
  PROJECT_ENGINE_NAME,
  PROJECT_FILE_EXTENSION,
  PROJECT_FILE_KIND,
  PROJECT_SCHEMA_VERSION,
  ProjectFileError,
  type ProjectEditorPreferences,
  type ProjectFile,
  type ProjectPlanningState,
} from "./types";

function plainClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * SESSION-ONLY AUDIO AVAILABILITY (BUG-A1). Audio bytes are never stored in a
 * project file, so `audio.attached` — which means "a local file is attached in
 * THIS session" — must never cross the project-file boundary as true. Metadata
 * (name, bpm, offset, duration) is preserved untouched; only the availability
 * claim is normalised, on both write and read.
 */
function withDetachedAudio(project: ShowProject): ShowProject {
  return { ...project, audio: { ...project.audio, attached: false } };
}

/** Builds the versioned envelope around the current editable project. */
export function serializeProject(
  project: ShowProject,
  options: {
    editor?: ProjectEditorPreferences;
    planning?: ProjectPlanningState;
    savedAt?: string;
  } = {},
): ProjectFile {
  return {
    kind: PROJECT_FILE_KIND,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: options.savedAt ?? new Date().toISOString(),
    app: { name: PROJECT_ENGINE_NAME, schemaVersion: SCHEMA_VERSION },
    project: withDetachedAudio(plainClone(project)),
    planning: plainClone(options.planning ?? defaultPlanningState()),
    ...(options.editor ? { editor: options.editor } : {}),
  };
}

export function defaultPlanningState(): ProjectPlanningState {
  return { assignmentStrategy: DEFAULT_PLANNING_STRATEGY, transitionOverrides: {} };
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** A strategy id is only adopted when this build can actually select it. */
function selectableStrategy(value: unknown): AssignmentStrategyId | null {
  return typeof value === "string" &&
    (SELECTABLE_ASSIGNMENT_STRATEGIES as readonly string[]).includes(value)
    ? (value as AssignmentStrategyId)
    : null;
}

export interface PlanningMigrationContext {
  /**
   * LEGACY STRATEGY (schema <= 1). Older files stored the selected assignment
   * strategy in `editor.assignmentStrategy`. Ignoring it would silently change
   * the flown trajectory of an old project, so it is migrated into planning —
   * but only when the file predates v2 and carries no planning section. It is
   * never authoritative for v2 files.
   */
  readonly legacyStrategy?: unknown;
  /**
   * The already-migrated project. Persisted overrides are validated against it:
   * an override that no longer resolves is a hard error, never a silent drop.
   */
  readonly project?: ShowProject;
}

/**
 * PLANNING MIGRATION. Unknown/legacy strategy ids degrade to the default
 * (never blindly cast), while a structurally or semantically broken override is
 * a hard project file error: silently dropping or truncating it would change
 * the flown trajectory.
 */
export function migratePlanningState(
  raw: unknown,
  context: PlanningMigrationContext = {},
): ProjectPlanningState {
  if (raw === undefined || raw === null) {
    return {
      assignmentStrategy: selectableStrategy(context.legacyStrategy) ?? DEFAULT_PLANNING_STRATEGY,
      transitionOverrides: {},
    };
  }
  if (typeof raw !== "object") {
    throw new ProjectFileError("MALFORMED_PLANNING", "The planning section is malformed.");
  }
  const candidate = raw as { assignmentStrategy?: unknown; transitionOverrides?: unknown };
  const strategy = selectableStrategy(candidate.assignmentStrategy) ?? DEFAULT_PLANNING_STRATEGY;

  const overrides: Record<string, ClipTransitionOverride> = {};
  const rawOverrides = candidate.transitionOverrides;
  if (rawOverrides !== undefined && rawOverrides !== null) {
    if (typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) {
      throw new ProjectFileError("MALFORMED_PLANNING", "Transition overrides are malformed.");
    }
    for (const [clipId, value] of Object.entries(rawOverrides as Record<string, unknown>)) {
      const o = value as Partial<ClipTransitionOverride> | null;
      if (
        !o ||
        typeof o !== "object" ||
        !isFiniteNumberArray(o.targetPointIndex) ||
        !isFiniteNumberArray(o.startOffsets) ||
        !isFiniteNumberArray(o.laneOffsets) ||
        typeof o.strategy !== "string"
      ) {
        throw new ProjectFileError(
          "MALFORMED_PLANNING",
          `Transition override for clip ${clipId} is malformed.`,
          { clipId },
        );
      }
      overrides[clipId] = {
        targetPointIndex: [...o.targetPointIndex],
        startOffsets: [...o.startOffsets],
        laneOffsets: [...o.laneOffsets],
        strategy: o.strategy,
      };
    }
  }
  return { assignmentStrategy: strategy, transitionOverrides: overrides };
}

export function projectFileToJson(file: ProjectFile): string {
  return JSON.stringify(file, null, 2);
}

/** Deterministic, filesystem-safe default file name for a show. */
export function suggestedProjectFileName(showName: string): string {
  const slug = showName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${slug || "drone-show"}${PROJECT_FILE_EXTENSION}`;
}

export function ensureProjectExtension(name: string): string {
  const trimmed = name.trim() || "drone-show";
  return trimmed.endsWith(PROJECT_FILE_EXTENSION)
    ? trimmed
    : `${trimmed.replace(/\.json$/i, "")}${PROJECT_FILE_EXTENSION}`;
}

function isVec3(value: unknown): boolean {
  return (
    Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** Structural integrity of the geometry, checked BEFORE anything is replaced. */
function assertIntegrity(project: ShowProject): void {
  if (!Array.isArray(project.formations) || project.formations.length === 0) {
    throw new ProjectFileError("FORMATION_INTEGRITY", "The project has no formations.");
  }
  for (const formation of project.formations) {
    if (!formation || typeof formation.id !== "string" || !Array.isArray(formation.points)) {
      throw new ProjectFileError("FORMATION_INTEGRITY", "A formation is malformed.", {
        id: (formation as { id?: string } | undefined)?.id,
      });
    }
    if (!formation.points.every(isVec3)) {
      throw new ProjectFileError("FORMATION_INTEGRITY", `Formation ${formation.id} has invalid points.`, {
        id: formation.id,
      });
    }
  }
  for (const clip of project.timeline) {
    if (!clip || typeof clip.id !== "string" || typeof clip.formationId !== "string") {
      throw new ProjectFileError("MALFORMED_PROJECT", "A timeline clip is malformed.");
    }
    for (const key of ["start", "transition", "hold"] as const) {
      if (typeof clip[key] !== "number" || !Number.isFinite(clip[key])) {
        throw new ProjectFileError("MALFORMED_PROJECT", `Clip ${clip.id} has invalid ${key}.`, {
          clipId: clip.id,
        });
      }
    }
  }
  // SCENE INTEGRITY: a composed scene must reference real objects with a real
  // transform, otherwise the file is rejected before it replaces the open show.
  for (const scene of project.scenes ?? []) {
    if (!scene || typeof scene.id !== "string" || !Array.isArray(scene.objects)) {
      throw new ProjectFileError("MALFORMED_PROJECT", "A formation scene is malformed.");
    }
    for (const object of scene.objects) {
      const source = object?.source as { kind?: string } | undefined;
      if (!object || typeof object.id !== "string" || !source?.kind) {
        throw new ProjectFileError("MALFORMED_PROJECT", `Scene ${scene.id} has an invalid object.`, {
          sceneId: scene.id,
        });
      }
      const t = object.transform;
      if (!t || !isVec3(t.position) || !isVec3(t.rotationDeg) || typeof t.scale !== "number") {
        throw new ProjectFileError(
          "MALFORMED_PROJECT",
          `Scene object ${object.id} has an invalid transform.`,
          { sceneId: scene.id, objectId: object.id },
        );
      }
    }
  }
  // LIGHTING INTEGRITY: an effect must resolve to a real clip target and carry
  // finite timing, otherwise the file is rejected before it replaces the show.
  for (const effect of project.lighting?.effects ?? []) {
    if (!effect || typeof effect.id !== "string" || typeof effect.target?.clipId !== "string") {
      throw new ProjectFileError("MALFORMED_PROJECT", "A lighting effect is malformed.");
    }
    if (
      typeof effect.start !== "number" ||
      !Number.isFinite(effect.start) ||
      typeof effect.duration !== "number" ||
      !(effect.duration > 0)
    ) {
      throw new ProjectFileError("MALFORMED_PROJECT", `Lighting effect ${effect.id} has invalid timing.`);
    }
  }
  for (const dynamic of project.dynamicFormations ?? []) {
    if (!dynamic || typeof dynamic.id !== "string" || !Array.isArray(dynamic.points)) {
      throw new ProjectFileError("DYNAMIC_INTEGRITY", "A dynamic formation is malformed.");
    }
    if (!(typeof dynamic.duration === "number" && dynamic.duration > 0)) {
      throw new ProjectFileError("DYNAMIC_INTEGRITY", `Dynamic formation ${dynamic.id} has an invalid duration.`, {
        id: dynamic.id,
      });
    }
    const ids = new Set<string>();
    for (const point of dynamic.points) {
      if (!point || typeof point.id !== "string" || !isVec3(point.base)) {
        throw new ProjectFileError("DYNAMIC_INTEGRITY", `Dynamic formation ${dynamic.id} has an invalid point.`, {
          id: dynamic.id,
        });
      }
      ids.add(point.id);
    }
    for (const group of dynamic.groups ?? []) {
      if (!group || typeof group.id !== "string" || !Array.isArray(group.pointIds)) {
        throw new ProjectFileError("DYNAMIC_INTEGRITY", `Dynamic formation ${dynamic.id} has an invalid group.`, {
          id: dynamic.id,
        });
      }
      for (const pointId of group.pointIds) {
        if (!ids.has(pointId)) {
          throw new ProjectFileError(
            "DYNAMIC_INTEGRITY",
            `Group ${group.id} references unknown point ${pointId}.`,
            { id: dynamic.id, groupId: group.id, pointId },
          );
        }
      }
    }
  }
}

/**
 * Migration entry point. Version 1 is the first published schema; older
 * unversioned payloads are accepted through the canonical project migration and
 * anything newer than this build fails gracefully.
 */
export function migrateProjectFile(raw: unknown): ProjectFile {
  const candidate = raw as Partial<ProjectFile> | null;
  if (!candidate || typeof candidate !== "object") {
    throw new ProjectFileError("MALFORMED_PROJECT", "The file does not contain a project.");
  }
  if (candidate.kind !== PROJECT_FILE_KIND) {
    throw new ProjectFileError(
      "INVALID_KIND",
      "This file is not a Drone Show Studio project file.",
      { kind: candidate.kind },
    );
  }
  const version = typeof candidate.schemaVersion === "number" ? candidate.schemaVersion : 0;
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new ProjectFileError(
      "UNSUPPORTED_VERSION",
      `Project schema version ${version} was written by a newer build.`,
      { version, supported: PROJECT_SCHEMA_VERSION },
    );
  }
  if (!candidate.project || typeof candidate.project !== "object") {
    throw new ProjectFileError("MALFORMED_PROJECT", "The project payload is missing.");
  }
  const project = withDetachedAudio(migrateProject(candidate.project));
  assertIntegrity(project);
  return {
    kind: PROJECT_FILE_KIND,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : new Date().toISOString(),
    app: candidate.app ?? { name: PROJECT_ENGINE_NAME, schemaVersion: SCHEMA_VERSION },
    project,
    // v1 files carry no planning section: they migrate to planning defaults.
    planning: migratePlanningState((candidate as { planning?: unknown }).planning),
    ...(candidate.editor ? { editor: candidate.editor } : {}),
  };
}

/** Parses raw file text. Never mutates or replaces anything by itself. */
export function parseProjectFile(text: string): ProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectFileError("NOT_JSON", "The file is not valid JSON.");
  }
  return migrateProjectFile(parsed);
}

export function toProjectFileError(err: unknown): ProjectFileError {
  if (err instanceof ProjectFileError) return err;
  return new ProjectFileError("MALFORMED_PROJECT", err instanceof Error ? err.message : String(err));
}
