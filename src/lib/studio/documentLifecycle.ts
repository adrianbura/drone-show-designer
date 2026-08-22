/**
 * DOCUMENT LIFECYCLE — PURE DECISION MODEL.
 *
 * The Studio has exactly one open document at a time. This module owns the
 * naming, feedback wording and the NO-SHOW-OPEN description of that lifecycle.
 * It never mutates state, never saves and never adopts: the store keeps the
 * single adoption boundary (`adoptProject`) and the single dirty authority
 * (`documentDirty`).
 */

import { ensureProjectExtension, suggestedProjectFileName } from "../project";

export type DocumentActionKind = "OPENED" | "SAVED" | "SAVED_AS" | "CLOSED";

export interface DocumentFeedback {
  readonly kind: DocumentActionKind;
  /** Document / file name the action applied to. */
  readonly name: string;
  /** Compact operator confirmation, e.g. "Saved As: my-show.json". */
  readonly message: string;
}

const LABELS: Record<DocumentActionKind, string> = {
  OPENED: "Opened",
  SAVED: "Saved",
  SAVED_AS: "Saved As",
  CLOSED: "Closed",
};

export function documentFeedback(kind: DocumentActionKind, name: string): DocumentFeedback {
  return { kind, name, message: `${LABELS[kind]}: ${name}` };
}

/**
 * SAVE AS NAME. A requested name is normalised to the project extension; an
 * empty request falls back to the deterministic name of the current project, so
 * Save As can never write an unnamed document.
 */
export function saveAsFileName(requested: string, projectName: string): string {
  const trimmed = requested.trim();
  return ensureProjectExtension(trimmed || suggestedProjectFileName(projectName));
}

/**
 * Save As proposal shown to the operator: the current file name with a copy
 * marker, so a second identity is created instead of silently overwriting the
 * mental model of the first one.
 */
export function suggestedSaveAsName(currentFileName: string, projectName: string): string {
  const base = currentFileName.trim() || suggestedProjectFileName(projectName);
  const withoutExt = base.replace(/(\.droneshow)?\.json$/i, "");
  return ensureProjectExtension(`${withoutExt}-copy`);
}

/** Primary actions offered by the NO SHOW OPEN state. */
export const NO_SHOW_PRIMARY_ACTIONS = ["NEW_SHOW", "OPEN_PROJECT", "IMPORT_ESSP"] as const;
export const NO_SHOW_SECONDARY_ACTIONS = ["SAMPLES"] as const;
export type NoShowAction =
  | (typeof NO_SHOW_PRIMARY_ACTIONS)[number]
  | (typeof NO_SHOW_SECONDARY_ACTIONS)[number];

/**
 * Closing must NOT silently create a blank editable document: the Studio enters
 * an explicit empty state whose only affordances re-enter the lifecycle.
 */
export const NO_SHOW_OPEN_TITLE = "No show open";
export const NO_SHOW_OPEN_BODY =
  "Create a new show, open a saved Studio project, or import an ESSP archive to begin.";
