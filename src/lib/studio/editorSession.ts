/**
 * PROJECT EDITOR-SESSION RECONCILIATION (pure) + HISTORY BOUNDS.
 *
 * Composes with (never duplicates) the existing authorities:
 *   - `projectLifecycle`      — project-scoped session evidence (AI, SVG, audio…)
 *   - `derivedAnalysis`       — geometry-derived analysis invalidation
 *   - `asyncJobAuthority`     — in-flight async isolation
 *   - `clipSelection`         — clip-scoped selection reconciliation
 *
 * What is left, and what this module owns, is the PRESENTATION session of the
 * project being replaced: playback transport, timeline viewport and ephemeral
 * geometry diagnostics (proposal ghost). None of it is project content, none of
 * it is persisted, and none of it may describe a project that is no longer open.
 *
 * GLOBAL OPERATOR PREFERENCES (snap mode, follow playhead, playback speed, loop,
 * audience viewpoint, thresholds) are deliberately NOT reset here.
 */

/** Hard bound on the timeline snapshot history (matches the dynamic history). */
export const TIMELINE_HISTORY_LIMIT = 50;

/** Keeps the newest `limit` entries of a history stack, in place. */
export function boundHistory<T>(stack: T[], limit = TIMELINE_HISTORY_LIMIT): T[] {
  while (stack.length > limit) stack.shift();
  return stack;
}

export interface PlayheadRange {
  /** Show duration in seconds (>= 0). */
  readonly duration: number;
  /** First playable time; negative when a pre-show is planned. */
  readonly startTime: number;
}

/**
 * Deterministic playhead rule for an adopted project: time 0 always exists in a
 * show range (`startTime <= 0 <= duration`), so adoption rewinds to 0 rather
 * than trying to translate a time that belonged to another document.
 */
export const ADOPTED_PLAYHEAD_TIME = 0;

/** Clamps any candidate time into the playable range of a project. */
export function clampPlayheadTime(time: number, range: PlayheadRange): number {
  const start = Math.min(0, Number.isFinite(range.startTime) ? range.startTime : 0);
  const end = Math.max(0, Number.isFinite(range.duration) ? range.duration : 0);
  if (!Number.isFinite(time)) return start;
  return Math.max(start, Math.min(end, time));
}

/** Canonical timeline viewport of a freshly adopted project. */
export const ADOPTED_TIMELINE_VIEW = { zoom: 1, scroll: 0 } as const;

export interface AdoptedEditorSessionSetters {
  /** Stops the transport of the replaced project (never auto-plays the new one). */
  stopPlayback: () => void;
  /** Moves the playhead to a time that is valid in any project. */
  seek: (time: number) => void;
  /** Restores the full authored range (zoom 1, scroll 0). */
  resetTimelineView: () => void;
  /** Drops ephemeral geometry diagnostics (proposal ghost preview). */
  clearGeometryDiagnostics: () => void;
}

/** Canonical list of presentation slots a project adoption reconciles. */
export const ADOPTED_EDITOR_SESSION_SLOTS = [
  "playing",
  "time",
  "timelineZoom",
  "timelineScroll",
  "geometryDiagnostics",
] as const;

/** Reconciles the presentation session for a successful project adoption. */
export function reconcileAdoptedEditorSession(setters: AdoptedEditorSessionSetters): void {
  setters.stopPlayback();
  setters.seek(ADOPTED_PLAYHEAD_TIME);
  setters.resetTimelineView();
  setters.clearGeometryDiagnostics();
}
