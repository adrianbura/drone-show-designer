/**
 * Timeline helpers (creative layer). No flight computation lives here.
 */
import type { ShowProject, TimelineClip } from "./types";
import { clipPhase } from "./types";

export function sortedClips(project: ShowProject): TimelineClip[] {
  return [...project.timeline].sort((a, b) => a.start - b.start);
}

/** Clip governing lighting/creative state at absolute show time t. */
export function activeClipAt(project: ShowProject, t: number): TimelineClip | undefined {
  let current: TimelineClip | undefined;
  for (const clip of sortedClips(project)) {
    if (t >= clip.start) current = clip;
  }
  return current;
}

export function clipEnd(clip: TimelineClip): number {
  return clip.start + clip.transition + clip.hold;
}

export function phaseAt(project: ShowProject, t: number) {
  const clip = activeClipAt(project, t);
  return clip ? clipPhase(clip) : "TAKEOFF";
}
