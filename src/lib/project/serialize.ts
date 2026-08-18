/**
 * Versioned serialization of the editable studio project.
 *
 * Save -> load -> save must preserve canonical editable show semantics, so the
 * writer never derives values and the reader never guesses: unknown future
 * schema versions fail loudly, malformed files are rejected before they can
 * replace the open project, and every accepted file is normalised through the
 * canonical project migration.
 */
import { migrateProject } from "../show/defaultProject";
import { SCHEMA_VERSION, type ShowProject } from "../show/types";
import {
  PROJECT_ENGINE_NAME,
  PROJECT_FILE_EXTENSION,
  PROJECT_FILE_KIND,
  PROJECT_SCHEMA_VERSION,
  ProjectFileError,
  type ProjectEditorPreferences,
  type ProjectFile,
} from "./types";

function plainClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Builds the versioned envelope around the current editable project. */
export function serializeProject(
  project: ShowProject,
  options: { editor?: ProjectEditorPreferences; savedAt?: string } = {},
): ProjectFile {
  return {
    kind: PROJECT_FILE_KIND,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: options.savedAt ?? new Date().toISOString(),
    app: { name: PROJECT_ENGINE_NAME, schemaVersion: SCHEMA_VERSION },
    project: plainClone(project),
    ...(options.editor ? { editor: options.editor } : {}),
  };
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
  const project = migrateProject(candidate.project);
  assertIntegrity(project);
  return {
    kind: PROJECT_FILE_KIND,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : new Date().toISOString(),
    app: candidate.app ?? { name: PROJECT_ENGINE_NAME, schemaVersion: SCHEMA_VERSION },
    project,
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
