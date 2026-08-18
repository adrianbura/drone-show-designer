/**
 * Timeline helpers (creative layer). No flight computation lives here.
 */
import type { ShowPhase, ShowProject, TimelineClip } from "./types";
import { clipPhase } from "./types";

/**
 * Canonical phase for a newly created clip: the first authored clip of a clean
 * project is TAKEOFF, everything afterwards is SHOW.
 */
export function defaultPhaseForNewClip(timeline: TimelineClip[]): ShowPhase {
  return timeline.length === 0 ? "TAKEOFF" : "SHOW";
}


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
