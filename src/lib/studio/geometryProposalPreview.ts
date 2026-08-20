/**
 * GEOMETRY PROPOSAL 3D PREVIEW — EPHEMERAL DIAGNOSTIC STATE.
 *
 * A tiny external store holding proposed preview positions so the viewport can
 * draw them as ghost markers. Nothing here is persisted, serialized, planned,
 * validated or exported: clearing it leaves the project untouched because the
 * project was never written to in the first place.
 */
import { useSyncExternalStore } from "react";

import type { Vector3Tuple } from "@/lib/show/types";

export interface GeometryProposalPreviewState {
  readonly enabled: boolean;
  readonly original: readonly Vector3Tuple[];
  readonly proposed: readonly Vector3Tuple[];
}

const EMPTY: GeometryProposalPreviewState = { enabled: false, original: [], proposed: [] };

let state: GeometryProposalPreviewState = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setGeometryProposalPreview(next: GeometryProposalPreviewState | null): void {
  state = next ?? EMPTY;
  emit();
}

export function getGeometryProposalPreview(): GeometryProposalPreviewState {
  return state;
}

export function useGeometryProposalPreview(): GeometryProposalPreviewState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getGeometryProposalPreview,
    () => EMPTY,
  );
}
