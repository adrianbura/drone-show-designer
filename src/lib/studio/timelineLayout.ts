/**
 * ADAPTIVE TIMELINE LAYOUT — pure presentation geometry.
 *
 * This module decides only what time range the editor must be able to show and
 * how overlapping clip blocks are packed into visual lanes. It never mutates
 * project timing and never participates in flight planning.
 */
import { resolveEffectStart } from "../show/lighting/engine";
import type { ShowProject, TimelineClip } from "../show/types";

export interface TimelineContentRange {
  readonly start: number;
  readonly end: number;
}

export interface TimelineLaneLayout {
  /** Visual lane index for each clip id. */
  readonly laneByClipId: Readonly<Record<string, number>>;
  /** At least one lane so an empty timeline keeps a usable drop/scrub surface. */
  readonly laneCount: number;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clipEnd(clip: TimelineClip): number {
  return finite(clip.start) + Math.max(0, finite(clip.transition)) + Math.max(0, finite(clip.hold));
}

/**
 * Canonical authored-content bounds for the editor.
 *
 * Derived validation/simulation overlays deliberately do NOT enlarge this range:
 * they describe authored content and must not make the editing canvas jump.
 * Reference playback has its own externally supplied range and bypasses this
 * helper in the store.
 */
export function timelineContentRange(project: ShowProject, planStart = 0): TimelineContentRange {
  let start = Math.min(0, finite(planStart));
  let end = 0;

  for (const clip of project.timeline) {
    start = Math.min(start, finite(clip.start));
    end = Math.max(end, clipEnd(clip));
  }

  if (project.audio.attached) {
    const audioStart = finite(project.audio.offset);
    const audioEnd = audioStart + Math.max(0, finite(project.audio.duration));
    start = Math.min(start, audioStart);
    end = Math.max(end, audioEnd);
  }

  for (const marker of project.markers ?? []) {
    if (!Number.isFinite(marker.time)) continue;
    start = Math.min(start, marker.time);
    end = Math.max(end, marker.time);
  }

  for (const section of project.musicSections ?? []) {
    if (Number.isFinite(section.start)) start = Math.min(start, section.start);
    if (Number.isFinite(section.end)) end = Math.max(end, section.end);
  }

  const clipsById = new Map(project.timeline.map((clip) => [clip.id, clip] as const));
  for (const effect of project.lighting?.effects ?? []) {
    if (!effect.enabled || !Number.isFinite(effect.duration)) continue;
    const clip = clipsById.get(effect.target.clipId);
    if (!clip) continue;
    const sceneStart = finite(clip.start);
    const formationReady = sceneStart + Math.max(0, finite(clip.transition));
    const sceneEnd = clipEnd(clip);
    const effectStart = resolveEffectStart(effect, { sceneStart, formationReady, sceneEnd });
    if (!Number.isFinite(effectStart)) continue;
    start = Math.min(start, effectStart);
    end = Math.max(end, effectStart + Math.max(0, effect.duration));
  }

  // A completely empty project still gets a one-second editable surface.
  if (!(end > start)) end = start + 1;
  return { start, end };
}

/**
 * Deterministic interval packing for clip blocks.
 *
 * Sequential clips reuse lane 0. Only clips whose visible intervals overlap are
 * stacked. Ties are stable by id so the same project always renders identically.
 */
export function packTimelineClipLanes(clips: readonly TimelineClip[]): TimelineLaneLayout {
  const ordered = [...clips].sort(
    (a, b) => finite(a.start) - finite(b.start) || clipEnd(a) - clipEnd(b) || a.id.localeCompare(b.id),
  );
  const laneEnds: number[] = [];
  const laneByClipId: Record<string, number> = {};

  for (const clip of ordered) {
    const start = finite(clip.start);
    const end = Math.max(start, clipEnd(clip));
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    laneByClipId[clip.id] = lane;
  }

  return { laneByClipId, laneCount: Math.max(1, laneEnds.length) };
}
