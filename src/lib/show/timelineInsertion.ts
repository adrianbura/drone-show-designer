import type { TimelineClip } from "./types";

/** Duration contributed by one authored clip to timeline placement. */
export function authoredClipSpan(clip: Pick<TimelineClip, "transition" | "hold">): number {
  return Math.max(0, clip.transition) + Math.max(0, clip.hold);
}

/** Latest authored end among non-LANDING clips. */
export function timelineBodyEnd(timeline: readonly TimelineClip[]): number {
  return timeline
    .filter((clip) => clip.phase !== "LANDING")
    .reduce((end, clip) => Math.max(end, clip.start + authoredClipSpan(clip)), 0);
}

/**
 * Canonical "append authored content" placement.
 *
 * New content is inserted after the current non-LANDING body. Every LANDING clip
 * is kept after it and shifted by exactly the inserted clip span. The input is
 * never mutated.
 *
 * This helper deliberately does not choose phase/default timings; callers remain
 * responsible for authoring semantics. It only owns timeline placement so static,
 * dynamic and scene-library insertion cannot drift apart.
 */
export function insertBeforeLanding(
  timeline: readonly TimelineClip[],
  clip: TimelineClip,
): { readonly timeline: TimelineClip[]; readonly clip: TimelineClip } {
  const body = timeline.filter((item) => item.phase !== "LANDING");
  const landing = timeline.filter((item) => item.phase === "LANDING");
  const placed: TimelineClip = { ...clip, start: timelineBodyEnd(timeline) };
  const shift = authoredClipSpan(placed);

  return {
    clip: placed,
    timeline: [
      ...body,
      placed,
      ...landing.map((item) => ({ ...item, start: item.start + shift })),
    ],
  };
}
