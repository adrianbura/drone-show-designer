/**
 * CONTEXTUAL SELECTION SUMMARY (pure).
 *
 * Answers the one question the operator asks after clicking a clip: WHAT is
 * selected, WHEN does it happen, HOW is it represented, and WHO owns the
 * trajectories in that range. It reads existing domain state only — it is not a
 * second readiness / ownership / validation authority.
 */

import type { ShowProject, TimelineClip } from "@/lib/show/types";
import { clipPhase } from "@/lib/show/types";
import type { ClipOwnership, ClipRepresentation } from "./commands";

export interface ClipSelectionSummary {
  readonly clipId: string;
  readonly label: string;
  readonly phase: string;
  readonly representation: ClipRepresentation;
  readonly start: number;
  readonly end: number;
  /** `12.0 s → 20.5 s · 8.5 s` style range, formatted by the caller's locale. */
  readonly duration: number;
  readonly ownership: ClipOwnership;
  readonly hasAuthoredLighting: boolean;
}

export function clipRepresentation(project: ShowProject, clip: TimelineClip): ClipRepresentation {
  if ((project.scenes ?? []).some((s) => s.id === clip.id)) return "SCENE";
  if (clip.dynamicFormationId) return "DYNAMIC";
  return "STATIC";
}

export function clipLabel(project: ShowProject, clip: TimelineClip): string {
  return (
    project.dynamicFormations?.find((d) => d.id === clip.dynamicFormationId)?.name ??
    project.formations.find((f) => f.id === clip.formationId)?.name ??
    "Missing formation"
  );
}

export function summarizeClipSelection(
  project: ShowProject,
  clipId: string | null,
  ownership: ClipOwnership,
  hasAuthoredLighting: boolean,
): ClipSelectionSummary | null {
  if (!clipId) return null;
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip) return null;
  const end = clip.start + clip.transition + clip.hold;
  return {
    clipId: clip.id,
    label: clipLabel(project, clip),
    phase: clipPhase(clip),
    representation: clipRepresentation(project, clip),
    start: clip.start,
    end,
    duration: end - clip.start,
    ownership,
    hasAuthoredLighting,
  };
}
