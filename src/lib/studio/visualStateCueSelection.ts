/**
 * SELECTED VISUAL STATE CUE (UI only).
 *
 * One tiny presentation authority shared by the timeline lane and the everyday
 * Saved states inspector, so both surfaces agree on which canonical cue the
 * operator is editing. It stores an id only: no project state, no mutation and
 * no history. Canonical cue data always comes from the store.
 */
import { useSyncExternalStore } from "react";

let selectedCueId: string | null = null;
const listeners = new Set<() => void>();

export function getSelectedVisualStateCueId(): string | null {
  return selectedCueId;
}

export function setSelectedVisualStateCueId(cueId: string | null): void {
  if (selectedCueId === cueId) return;
  selectedCueId = cueId;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelectedVisualStateCueId(): string | null {
  return useSyncExternalStore(subscribe, getSelectedVisualStateCueId, getSelectedVisualStateCueId);
}
