/**
 * SHARED AUDIENCE VIEWPOINT AUTHORITY — DIAGNOSTIC STATE ONLY.
 *
 * ONE viewpoint model for every read-only diagnostic surface (audience preview,
 * vertical-stack, geometry proposal). Panels must NOT keep their own distance /
 * eye-height / target-height state: a second viewpoint model would let two
 * panels disagree about what the audience sees.
 *
 * Nothing here is persisted, planned, validated or exported.
 */
import { useSyncExternalStore } from "react";

import type { AudienceView } from "@/lib/show/diagnostics";
import type { Vector3Tuple } from "@/lib/show/types";

export interface AudienceViewSettings {
  /** Horizontal distance of the representative viewer from show origin, metres. */
  readonly distanceMeters: number;
  /** Viewer eye height above ground, metres. */
  readonly eyeHeightMeters: number;
  /** Height of the look-at target on the show axis, metres. */
  readonly targetHeightMeters: number;
}

export const AUDIENCE_VIEW_DEFAULTS: AudienceViewSettings = {
  distanceMeters: 150,
  eyeHeightMeters: 1.7,
  targetHeightMeters: 60,
};

/** Canonical mapping from operator-facing settings to the analyzer viewpoint. */
export function audienceViewOf(settings: AudienceViewSettings): AudienceView {
  const viewer: Vector3Tuple = [0, settings.eyeHeightMeters, -Math.abs(settings.distanceMeters)];
  const target: Vector3Tuple = [0, settings.targetHeightMeters, 0];
  return { viewer, target };
}

let settings: AudienceViewSettings = AUDIENCE_VIEW_DEFAULTS;
const listeners = new Set<() => void>();

export function getAudienceViewSettings(): AudienceViewSettings {
  return settings;
}

export function setAudienceViewSettings(patch: Partial<AudienceViewSettings>): void {
  const next: AudienceViewSettings = { ...settings, ...patch };
  if (
    next.distanceMeters === settings.distanceMeters &&
    next.eyeHeightMeters === settings.eyeHeightMeters &&
    next.targetHeightMeters === settings.targetHeightMeters
  ) {
    return;
  }
  settings = next;
  listeners.forEach((l) => l());
}

export function resetAudienceViewSettings(): void {
  setAudienceViewSettings(AUDIENCE_VIEW_DEFAULTS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shared viewpoint hook. Every diagnostic panel reads the SAME state. */
export function useAudienceViewSettings(): AudienceViewSettings {
  return useSyncExternalStore(subscribe, getAudienceViewSettings, getAudienceViewSettings);
}
