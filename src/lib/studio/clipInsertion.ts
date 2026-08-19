/**
 * CANONICAL TIMELINE INSERTION MATHS (pure).
 *
 * Every authoring path that appends a clip (SVG commit, plain clip, dynamic
 * clip, scene-asset insertion) routes through here, so the body/LANDING
 * contract is expressed exactly once:
 *
 * - the new clip starts at the end of the non-LANDING body,
 * - LANDING clips shift forward by the inserted duration,
 * - LANDING always remains the final phase.
 */
import type { TimelineClip } from "../show/types";

/** End time of the authored body (every clip that is not LANDING). */
export function timelineBodyEnd(timeline: readonly TimelineClip[]): number {
  return timeline
    .filter((c) => c.phase !== "LANDING")
    .reduce((m, c) => Math.max(m, c.start + c.transition + c.hold), 0);
}

/** Duration a clip occupies on the timeline. */
export function clipDuration(clip: Pick<TimelineClip, "transition" | "hold">): number {
  return clip.transition + clip.hold;
}

/**
 * Inserts `clip` before LANDING. `clip.start` is overwritten with the canonical
 * body end so callers can never author a conflicting start.
 */
export function insertClipBeforeLanding(
  timeline: readonly TimelineClip[],
  clip: TimelineClip,
): TimelineClip[] {
  const body = timeline.filter((c) => c.phase !== "LANDING");
  const landing = timeline.filter((c) => c.phase === "LANDING");
  const placed: TimelineClip = { ...clip, start: timelineBodyEnd(timeline) };
  const shift = clipDuration(placed);
  return [...body, placed, ...landing.map((c) => ({ ...c, start: c.start + shift }))];
}
