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

/**
 * REFERENTIAL INTEGRITY (clip deletion).
 *
 * A timeline clip OWNS its composed scene (`scene.id === clip.id`), its
 * participation override (`participation.clips[clipId]`) and every lighting
 * effect targeting it (`effect.target.clipId === clipId`). Deleting the clip
 * must delete exactly that unit — and NOTHING else. Reusable assets
 * (formations, dynamic formations, SVG sources, library assets) are never
 * touched. Pure: inputs are not mutated.
 */
export function removeTimelineClipReferences(project: ShowProject, clipId: string): ShowProject {
  const next: ShowProject = { ...project, timeline: project.timeline.filter((c) => c.id !== clipId) };

  if (project.scenes) {
    const scenes = project.scenes.filter((s) => s.id !== clipId);
    if (scenes.length !== project.scenes.length) next.scenes = scenes;
  }

  const clips = project.participation?.clips;
  if (project.participation && clips && Object.prototype.hasOwnProperty.call(clips, clipId)) {
    const rest: Record<string, (typeof clips)[string]> = {};
    for (const [key, value] of Object.entries(clips)) if (key !== clipId) rest[key] = value;
    next.participation = { ...project.participation, clips: rest };
  }

  const effects = project.lighting?.effects;
  if (project.lighting && effects) {
    const kept = effects.filter((e) => e.target.clipId !== clipId);
    if (kept.length !== effects.length) next.lighting = { ...project.lighting, effects: kept };
  }

  return next;
}

/**
 * Deterministic selection fallback after a clip is deleted: the nearest
 * surviving clip in show time, then the first surviving clip, then null.
 */
export function nextSelectedClipId(
  remaining: readonly TimelineClip[],
  removed: TimelineClip | undefined,
): string | null {
  if (remaining.length === 0) return null;
  const sorted = [...remaining].sort((a, b) => a.start - b.start);
  if (!removed) return sorted[0]!.id;
  let best = sorted[0]!;
  let bestDistance = Math.abs(best.start - removed.start);
  for (const clip of sorted) {
    const distance = Math.abs(clip.start - removed.start);
    if (distance < bestDistance) {
      best = clip;
      bestDistance = distance;
    }
  }
  return best.id;
}
