/**
 * Trajectory Engine — assignment + time-parameterised morphing.
 *
 * Sampling is stateless and O(drones) per frame so the 3D viewport can drive it
 * directly at 60 fps. Full-show sampling (used by safety + export) is a
 * separate, coarser pass. Both are pure functions of the project, which keeps
 * the future Python implementation a drop-in replacement.
 */
import { lightColorAt } from "./lights";
import type { DroneSample, Easing, ShowProject, TimelineClip, Vec3 } from "./types";
import { showDuration } from "./types";

export function ease(t: number, kind: Easing): number {
  const x = Math.max(0, Math.min(1, t));
  switch (kind) {
    case "linear":
      return x;
    case "smooth":
      return x * x * (3 - 2 * x);
    case "minJerk":
      return 10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5;
  }
}

/**
 * Greedy nearest-neighbour matching between consecutive formations.
 * Cheap (O(n^2)) and stable; a Hungarian/auction solver belongs in the Python
 * computation service once fleets exceed a few hundred drones.
 */
export function assign(from: Vec3[], to: Vec3[]): number[] {
  const n = Math.min(from.length, to.length);
  const taken = new Array(n).fill(false);
  const map = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestD = Infinity;
    const a = from[i]!;
    for (let j = 0; j < n; j++) {
      if (taken[j]) continue;
      const b = to[j]!;
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    taken[best] = true;
    map[i] = best;
  }
  return map;
}

function padPoints(points: Vec3[], count: number): Vec3[] {
  if (points.length >= count) return points.slice(0, count);
  const out = points.slice();
  while (out.length < count) out.push(points[out.length % Math.max(1, points.length)] ?? [0, 1, 0]);
  return out;
}

export interface ResolvedClip extends TimelineClip {
  target: Vec3[];
  /** index i (drone) -> index in target */
  mapping: number[];
}

/** Resolves the timeline once; reused across frames by the viewport. */
export function resolveShow(project: ShowProject): ResolvedClip[] {
  const clips = [...project.timeline].sort((a, b) => a.start - b.start);
  const ground: Vec3[] = padPoints(
    project.formations[0]?.points ?? [],
    project.droneCount,
  ).map(([x, , z]) => [x, 0, z] as Vec3);

  let prev = ground;
  return clips.map((clip) => {
    const formation = project.formations.find((f) => f.id === clip.formationId);
    const target = padPoints(formation?.points ?? ground, project.droneCount);
    const mapping = assign(prev, target);
    prev = mapping.map((j) => target[j]!);
    return { ...clip, target, mapping };
  });
}

function clipPositions(clip: ResolvedClip): Vec3[] {
  return clip.mapping.map((j) => clip.target[j]!);
}

/** Positions of every drone at absolute show time `t` (seconds). */
export function samplePositions(
  project: ShowProject,
  resolved: ResolvedClip[],
  t: number,
): Vec3[] {
  const ground: Vec3[] = padPoints(project.formations[0]?.points ?? [], project.droneCount).map(
    ([x, , z]) => [x, 0, z] as Vec3,
  );
  if (resolved.length === 0) return ground;

  let prev = ground;
  for (const clip of resolved) {
    const end = clip.start + clip.transition + clip.hold;
    const positions = clipPositions(clip);
    if (t < clip.start) return prev;
    if (t <= clip.start + clip.transition) {
      const k = ease(clip.transition > 0 ? (t - clip.start) / clip.transition : 1, clip.easing);
      return positions.map((p, i) => {
        const a = prev[i] ?? p;
        // Lift the arc slightly so drones separate vertically while morphing.
        const arc = Math.sin(k * Math.PI) * 1.5;
        return [
          a[0] + (p[0] - a[0]) * k,
          a[1] + (p[1] - a[1]) * k + arc,
          a[2] + (p[2] - a[2]) * k,
        ] as Vec3;
      });
    }
    if (t <= end) return positions;
    prev = positions;
  }
  return prev;
}

export function activeClip(resolved: ResolvedClip[], t: number): ResolvedClip | undefined {
  let current: ResolvedClip | undefined;
  for (const clip of resolved) {
    if (t >= clip.start) current = clip;
  }
  return current;
}

export function sampleShow(
  project: ShowProject,
  resolved: ResolvedClip[],
  t: number,
): DroneSample[] {
  const positions = samplePositions(project, resolved, t);
  const clip = activeClip(resolved, t);
  return positions.map((position, i) => ({
    position,
    color: lightColorAt(clip, i, project.droneCount, t),
  }));
}

/** Coarse full-show sampling used by safety validation and export. */
export function sampleTimeline(
  project: ShowProject,
  resolved: ResolvedClip[],
  dt = 0.2,
): { t: number; positions: Vec3[] }[] {
  const duration = showDuration(project);
  const frames: { t: number; positions: Vec3[] }[] = [];
  for (let t = 0; t <= duration + 1e-6; t += dt) {
    frames.push({ t: Number(t.toFixed(3)), positions: samplePositions(project, resolved, t) });
  }
  return frames;
}
