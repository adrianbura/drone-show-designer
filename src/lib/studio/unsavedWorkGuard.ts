/**
 * UNSAVED WORK GUARD — PURE DECISION MODEL.
 *
 * Autosave recovery is a crash net, NOT consent: an operator who presses
 * "New Show", "Open" or a sample loader while the current document has unsaved
 * edits must be told before the document is replaced.
 *
 * This module decides ONLY whether a confirmation is required and what it says.
 * It never mutates, never saves and never replaces a project: the caller keeps
 * the canonical adoption path (store.adoptProject) untouched.
 */

/** Actions that replace the whole open document. */
export type DestructiveDocumentAction =
  | "NEW_SHOW"
  | "OPEN_PROJECT"
  | "LOAD_SAMPLE"
  | "RESTORE_AUTOSAVE"
  | "CLOSE_SHOW";

export interface UnsavedWorkPrompt {
  readonly action: DestructiveDocumentAction;
  /** Dialog title. */
  readonly title: string;
  /** WHAT happens + WHAT to do. */
  readonly body: string;
  /** Label of the confirm-without-saving choice. */
  readonly continueLabel: string;
}

const PROMPTS: Record<DestructiveDocumentAction, Omit<UnsavedWorkPrompt, "action">> = {
  NEW_SHOW: {
    title: "Unsaved changes",
    body: "This show has changes that were never saved to a file. Creating a new show replaces it.",
    continueLabel: "Create without saving",
  },
  OPEN_PROJECT: {
    title: "Unsaved changes",
    body: "This show has changes that were never saved to a file. Opening another project replaces it.",
    continueLabel: "Open without saving",
  },
  LOAD_SAMPLE: {
    title: "Unsaved changes",
    body: "This show has changes that were never saved to a file. Loading a sample replaces it.",
    continueLabel: "Load without saving",
  },
  RESTORE_AUTOSAVE: {
    title: "Unsaved changes",
    body: "This show has changes that were never saved to a file. Restoring the recovered document replaces it.",
    continueLabel: "Restore without saving",
  },
  CLOSE_SHOW: {
    title: "Unsaved changes",
    body: "This show has changes that were never saved to a file. Closing it discards them.",
    continueLabel: "Close without saving",
  },
};

/**
 * Confirmation is required ONLY for explicit destructive replacement of a dirty
 * document. Ordinary edits, selections, validation and exports never prompt.
 */
export function requiresUnsavedConfirmation(
  action: DestructiveDocumentAction,
  state: { readonly projectDirty: boolean },
): boolean {
  return state.projectDirty;
}

export function unsavedWorkPrompt(action: DestructiveDocumentAction): UnsavedWorkPrompt {
  return { action, ...PROMPTS[action] };
}

/**
 * DIRTY TRACKING RULE (single authority).
 *
 * `baseline` is the signature of the document as last adopted or saved.
 * `null` means "not anchored yet" — the caller must anchor the current document
 * and treat it as clean. A never-saved show is still anchored at adoption, so
 * later edits DO count as unsaved work and the guard can protect them.
 */
export function documentDirty(baseline: string | null, current: string): boolean {
  if (baseline === null) return false;
  return baseline !== current;
}
