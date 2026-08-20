/**
 * RIPPLE TIMING AUTHORITY (pure).
 *
 * Sequential show clips must not overlap when the operator resizes one of them.
 * This module is the ONLY place cascading timeline timing math lives: React
 * drafts a gesture, the store commits the whole result of `rippleClipTiming`
 * atomically as one undo entry.
 *
 * CANONICAL CLIP MODEL (unchanged): a clip owns `start`, `transition` (morph
 * into the formation) and `hold`; its end is `start + transition + hold`. The
 * left handle in the editor drags the FORMATION-READY boundary (it edits
 * `transition`, never `start`), the right handle drags the clip end (`hold`).
 * Both move the clip end, so both ripple identically.
 *
 * ANCHORED CONTENT: nothing else is touched. Clip-anchored lighting effects
 * follow their clip through `resolveEffectStart` (SCENE_START /
 * FORMATION_READY / SCENE_END are relative), while markers, music sections,
 * audio and ABSOLUTE-anchored effects keep their absolute show time — exactly
 * the authority that exists today.
 */
import type { TimelineClip } from "../show/types";
import { clipPhase } from "../show/types";
import { MIN_HOLD, MIN_TRANSITION, roundTime, safeTime } from "./timelineEdit";

export type RippleMode = "RIPPLE" | "FREE";

/** Timing fields a timeline gesture may write. */
export interface ClipTimingPatch {
  readonly start?: number;
  readonly transition?: number;
  readonly hold?: number;
}

export interface RippleResult {
  /** Complete next timeline timing state (same order as the input). */
  readonly timeline: TimelineClip[];
  /** Applied shift of every following clip, in seconds (0 in FREE mode). */
  readonly delta: number;
  /** Ids of clips whose timing actually changed, resized clip included. */
  readonly changedClipIds: readonly string[];
}

function clipEnd(clip: TimelineClip): number {
  return safeTime(clip.start) + Math.max(0, safeTime(clip.transition)) + Math.max(0, safeTime(clip.hold));
}

/** Clamp a drafted patch to the canonical domain floors. */
export function normalizeTimingPatch(clip: TimelineClip, patch: ClipTimingPatch): TimelineClip {
  const start = patch.start === undefined ? clip.start : Math.max(0, roundTime(safeTime(patch.start)));
  const transition =
    patch.transition === undefined
      ? clip.transition
      : Math.max(MIN_TRANSITION, roundTime(safeTime(patch.transition)));
  const hold = patch.hold === undefined ? clip.hold : Math.max(MIN_HOLD, roundTime(safeTime(patch.hold)));
  return { ...clip, start, transition, hold };
}

/**
 * Clips that follow `clip` chronologically. Ordering is deterministic: by
 * `start`, then end, then id — the same total order the timeline renders with.
 */
export function followingClips(
  timeline: readonly TimelineClip[],
  clip: TimelineClip,
): readonly TimelineClip[] {
  const key = (c: TimelineClip): [number, number, string] => [safeTime(c.start), clipEnd(c), c.id];
  const [ks, ke, ki] = key(clip);
  return timeline.filter((c) => {
    if (c.id === clip.id) return false;
    const [s, e, i] = key(c);
    return s > ks || (s === ks && (e > ke || (e === ke && i > ki)));
  });
}

/**
 * RIPPLE EDIT.
 *
 * The resized clip receives `patch`; every FOLLOWING clip is translated by the
 * same delta, so relative gaps between them are preserved (never closed) and
 * chronological order — including the LANDING-final contract — is untouched.
 * Preceding clips (and TAKEOFF, when it precedes the edit) are never moved.
 *
 * FREE mode returns the plain single-clip patch: advanced, intentional overlap.
 */
export function rippleClipTiming(
  timeline: readonly TimelineClip[],
  clipId: string,
  patch: ClipTimingPatch,
  mode: RippleMode = "RIPPLE",
): RippleResult {
  const clip = timeline.find((c) => c.id === clipId);
  if (!clip) return { timeline: [...timeline], delta: 0, changedClipIds: [] };

  const next = normalizeTimingPatch(clip, patch);
  const changed =
    next.start !== clip.start || next.transition !== clip.transition || next.hold !== clip.hold;
  if (!changed) return { timeline: [...timeline], delta: 0, changedClipIds: [] };

  if (mode === "FREE") {
    return {
      timeline: timeline.map((c) => (c.id === clipId ? next : c)),
      delta: 0,
      changedClipIds: [clipId],
    };
  }

  const followers = followingClips(timeline, clip);
  let delta = roundTime(clipEnd(next) - clipEnd(clip));

  // Never push a following clip into negative show time.
  if (delta < 0 && followers.length > 0) {
    const minStart = Math.min(...followers.map((c) => safeTime(c.start)));
    delta = Math.max(delta, -minStart);
  }

  // A clamped ripple must not desynchronise the resized clip from its followers:
  // fold the clamp back into the edited field so no overlap is ever produced.
  let applied = next;
  const requested = roundTime(clipEnd(next) - clipEnd(clip));
  if (delta !== requested) {
    const correction = delta - requested;
    if (patch.hold !== undefined) {
      applied = { ...next, hold: Math.max(MIN_HOLD, roundTime(next.hold + correction)) };
    } else if (patch.transition !== undefined) {
      applied = { ...next, transition: Math.max(MIN_TRANSITION, roundTime(next.transition + correction)) };
    }
  }

  const followerIds = new Set(followers.map((c) => c.id));
  const result = timeline.map((c) => {
    if (c.id === clipId) return applied;
    if (!followerIds.has(c.id) || delta === 0) return c;
    return { ...c, start: roundTime(Math.max(0, safeTime(c.start) + delta)) };
  });

  const changedIds = [applied.id, ...(delta === 0 ? [] : followers.map((c) => c.id))];
  return { timeline: result, delta, changedClipIds: changedIds };
}

/** True when no two clips in the timeline overlap in show time. */
export function hasTimelineOverlap(timeline: readonly TimelineClip[]): boolean {
  const ordered = [...timeline].sort((a, b) => safeTime(a.start) - safeTime(b.start));
  for (let i = 1; i < ordered.length; i++) {
    if (safeTime(ordered[i]!.start) < clipEnd(ordered[i - 1]!) - 1e-9) return true;
  }
  return false;
}

/** LANDING must remain the final authored clip after any ripple. */
export function landingIsFinal(timeline: readonly TimelineClip[]): boolean {
  const landing = timeline.filter((c) => clipPhase(c) === "LANDING");
  if (landing.length === 0) return true;
  const lastStart = Math.max(...timeline.map((c) => safeTime(c.start)));
  return landing.every((c) => safeTime(c.start) >= lastStart - 1e-9);
}
