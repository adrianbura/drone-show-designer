/**
 * CLIP THUMBNAILS — cheap, deterministic identification glyphs (pure).
 *
 * A thumbnail is a NORMALISED front-elevation (X right, Y up) point sample of the
 * geometry a clip resolves to at its representative instant. It is NEVER flight
 * output: it is decimated on purpose, it is never exported, and it is recomputed
 * only when the project changes (the caller memoises), never per animation frame.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import { thumbnailFromPoints } from "../../library/snapshot";
import type { ShowProject, TimelineClip, Vec3 } from "../types";
import { resolveSceneAt } from "./resolve";
import { sceneForClip } from "./migrate";

export type ThumbnailPoint = readonly [number, number];

/**
 * Representative local time of a clip: the middle of the hold, so a DYNAMIC clip
 * shows an expressive frame of its animation instead of its rest pose.
 */
export function representativeLocalTime(clip: TimelineClip): number {
  return Math.max(0, clip.hold) / 2;
}

export function clipThumbnailPoints(
  project: ShowProject,
  clip: TimelineClip,
  maxPoints = 64,
): ThumbnailPoint[] {
  try {
    const scene = sceneForClip(project, clip);
    const resolved = resolveSceneAt(project, scene, representativeLocalTime(clip));
    const points = resolved.points as readonly Vec3[];
    if (points.length === 0) return [];
    return thumbnailFromPoints(points, maxPoints).points.map((p) => [p[0], p[1]] as const);
  } catch {
    return [];
  }
}

/** One pass over the timeline: `clipId -> normalised points`. */
export function timelineThumbnails(
  project: ShowProject,
  maxPoints = 64,
): Record<string, ThumbnailPoint[]> {
  const out: Record<string, ThumbnailPoint[]> = {};
  for (const clip of project.timeline) {
    out[clip.id] = clipThumbnailPoints(project, clip, maxPoints);
  }
  return out;
}
