/**
 * CLIP PHASE VOCABULARY (presentation only).
 *
 * Pure projections of the canonical phase authority `clipPhase()`. Nothing here
 * mutates the project, plans trajectories or touches persistence.
 */
import { clipPhase, type TimelineClip } from "@/lib/show/types";

export const CLIP_PHASE_NOTICE = "This is a flight phase. Select a SHOW clip to edit visuals.";
export const NO_SHOW_CLIP_NOTICE = "Add a visual to create a SHOW clip.";

/** Semantic badge label for one clip. */
export function clipPhaseBadge(clip: TimelineClip): string {
  const phase = clipPhase(clip);
  return phase === "SHOW" ? "SHOW · Editable visual" : `${phase} · Flight phase`;
}

/** Nearest SHOW clip to a reference start time, or null when none exists. */
export function nearestShowClip(
  timeline: readonly TimelineClip[],
  fromStart: number,
): TimelineClip | null {
  let best: TimelineClip | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const clip of timeline) {
    if (clipPhase(clip) !== "SHOW") continue;
    const distance = Math.abs(clip.start - fromStart);
    if (distance < bestDistance) {
      best = clip;
      bestDistance = distance;
    }
  }
  return best;
}
