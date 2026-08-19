/**
 * STUDIO PROJECT FILE — domain model.
 *
 * A project file is an EDITABLE STUDIO PROJECT. It is NOT an ESSP archive, not
 * PX4/MAVLink/MAVSDK data, not a drone program and not an operational flight
 * export. Everything required to reopen a show for editing is stored here;
 * transient editor state (dialogs, hover, busy flags, AI drafts) is not.
 */
import type { AssignmentStrategyId } from "../show/assignment";
import type { ReferenceTrajectoryLayer } from "../import/essp/native/types";
import type { ClipTransitionOverride } from "../show/trajectory/schedule";
import type { TransitionDesignState } from "../show/transition/design";
import type { ShowProject } from "../show/types";

export const PROJECT_FILE_KIND = "DroneShowStudioProject";
/**
 * v2 adds the optional `planning` section (assignment strategy + applied
 * transition overrides). v3 adds the optional `referenceLayer`: the losslessly
 * preserved imported ESSP trajectory/RGB payload that owns playback for every
 * interval not yet promoted to the planner. Older files remain openable.
 */
export const PROJECT_SCHEMA_VERSION = 3;
export const PROJECT_FILE_EXTENSION = ".droneshow.json";
export const PROJECT_ENGINE_NAME = "Drone Show Studio";

/** Optional editor preferences — never required to reopen a show. */
export interface ProjectEditorPreferences {
  readonly selectedClipId?: string | null;
  readonly sampleRate?: number;
  /** @deprecated planning authority moved to `ProjectFile.planning`. */
  readonly assignmentStrategy?: string;
}

/**
 * CANONICAL PLANNING STATE. Unlike editor preferences this section CHANGES
 * FLIGHT OUTPUT: it selects the assignment strategy and carries the applied
 * per-clip transition overrides, so a reopened project plans and flies exactly
 * the show that was saved. Derived reports (full-show, safety, optimization
 * diagnostics, simulation history) are never stored here.
 */
export interface ProjectPlanningState {
  readonly assignmentStrategy: AssignmentStrategyId;
  readonly transitionOverrides: Record<string, ClipTransitionOverride>;
  /**
   * AUTHORED TRANSITION DESIGN (mode + stagger pattern) per clip. It is the
   * designer intent that PRODUCED the override above, kept so reopening a
   * project shows the same mode instead of a guessed one. Absent in legacy
   * files: the mode is then derived from the override data itself.
   */
  readonly transitionDesigns?: Record<string, TransitionDesignState>;
}

export const DEFAULT_PLANNING_STRATEGY: AssignmentStrategyId = "nearestNeighbor";

export interface ProjectFile {
  readonly kind: typeof PROJECT_FILE_KIND;
  readonly schemaVersion: number;
  /** ISO timestamp of the explicit save. */
  readonly savedAt: string;
  readonly app: { readonly name: string; readonly schemaVersion: string };
  readonly project: ShowProject;
  /** Present from schema v2 on; v1 files migrate to planning defaults. */
  readonly planning?: ProjectPlanningState;
  /**
   * IMPORTED TRAJECTORY LAYER (schema v3). Byte-preserving copy of an imported
   * ESSP show plus the per-clip playback ownership. Present only for projects
   * created by extracting an imported show; it is the reason an
   * import -> save -> reopen cycle reproduces the imported playback exactly.
   */
  readonly referenceLayer?: ReferenceTrajectoryLayer;
  readonly editor?: ProjectEditorPreferences;
}

export type ProjectFileErrorCode =
  | "NOT_JSON"
  | "INVALID_KIND"
  | "UNSUPPORTED_VERSION"
  | "MALFORMED_PROJECT"
  | "MALFORMED_PLANNING"
  | "MALFORMED_REFERENCE_LAYER"
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
