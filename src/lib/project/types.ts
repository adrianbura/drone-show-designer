/**
 * STUDIO PROJECT FILE — domain model.
 *
 * A project file is an EDITABLE STUDIO PROJECT. It is NOT an ESSP archive, not
 * PX4/MAVLink/MAVSDK data, not a drone program and not an operational flight
 * export. Everything required to reopen a show for editing is stored here;
 * transient editor state (dialogs, hover, busy flags, AI drafts) is not.
 */
import type { AssignmentStrategyId } from "../show/assignment";
import type { ClipTransitionOverride } from "../show/trajectory/schedule";
import type { ShowProject } from "../show/types";

export const PROJECT_FILE_KIND = "DroneShowStudioProject";
/**
 * v2 adds the optional `planning` section (assignment strategy + applied
 * transition overrides). v1 files remain openable and migrate to planning
 * defaults.
 */
export const PROJECT_SCHEMA_VERSION = 2;
export const PROJECT_FILE_EXTENSION = ".droneshow.json";
export const PROJECT_ENGINE_NAME = "Drone Show Studio";

/** Optional editor preferences — never required to reopen a show. */
export interface ProjectEditorPreferences {
  readonly selectedClipId?: string | null;
  readonly sampleRate?: number;
  readonly assignmentStrategy?: string;
}

export interface ProjectFile {
  readonly kind: typeof PROJECT_FILE_KIND;
  readonly schemaVersion: number;
  /** ISO timestamp of the explicit save. */
  readonly savedAt: string;
  readonly app: { readonly name: string; readonly schemaVersion: string };
  readonly project: ShowProject;
  readonly editor?: ProjectEditorPreferences;
}

export type ProjectFileErrorCode =
  | "NOT_JSON"
  | "INVALID_KIND"
  | "UNSUPPORTED_VERSION"
  | "MALFORMED_PROJECT"
  | "FORMATION_INTEGRITY"
  | "DYNAMIC_INTEGRITY";

export class ProjectFileError extends Error {
  readonly code: ProjectFileErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ProjectFileErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ProjectFileError";
    this.code = code;
    this.details = details;
  }
}

/** Locally autosaved snapshot of the editable show. */
export interface ProjectAutosaveSnapshot {
  readonly savedAt: string;
  readonly fileName: string;
  readonly file: ProjectFile;
}
