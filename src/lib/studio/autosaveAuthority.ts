/**
 * AUTOSAVE RECOVERY PRECEDENCE AUTHORITY.
 *
 * Autosave recovery must only ever represent genuinely unsaved work. Explicit
 * lifecycle actions that succeed (manual Save, Open, New/Sample, consumed
 * Restore) make any previously persisted snapshot obsolete, so they CONSUME it.
 *
 * Timestamps are not a trustworthy precedence signal here (a snapshot and a
 * download can carry the same wall clock, and a pending debounce timer knows
 * nothing about the save that raced it). The trustworthy signal is a monotonic
 * generation: a write is only authorized when the generation captured when the
 * autosave was scheduled still matches the current generation.
 */

/** True when a scheduled autosave still belongs to the current session state. */
export function isAutosaveWriteAuthorized(
  scheduledGeneration: number,
  currentGeneration: number,
): boolean {
  return scheduledGeneration === currentGeneration;
}

/**
 * A snapshot is only worth offering when it carries a project. Anything else
 * (missing, emptied by a consume, unreadable) is not a recovery offer.
 */
export function isRecoveryOfferable(
  snapshot: { file?: unknown } | null | undefined,
): boolean {
  return Boolean(snapshot && (snapshot as { file?: unknown }).file);
}
