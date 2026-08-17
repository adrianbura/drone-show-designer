/**
 * Pure dynamic-formation sampler.
 *
 *   P_i(t) = pivot + T(t) + R(t) * S(t) * [ (base_i - pivot) + D_i(t) ]
 *
 * `sampleDynamicFormation` is a pure function of (formation, localTime) and
 * ALWAYS returns exactly `formation.points.length` points, in point order, so
 * every downstream layer (assignment, planner, safety, export) sees the same
 * exact-N contract as a static formation.
 */
import type { Vector3Tuple } from "../types";
import {
  centroid,
  keyframeSpan,
  lerp,
  lerpVec,
  mapLoopTime,
  quatFromEulerDeg,
  quatSlerp,
  rotateByQuat,
  type Quat,
} from "./math";
import {
  DynamicFormationError,
  type DynamicFormation,
  type GroupDeformationKeyframe,
  type MotionGroup,
  type TransformKeyframe,
} from "./types";

const ZERO: Vector3Tuple = [0, 0, 0];
const ONE: Vector3Tuple = [1, 1, 1];

export interface GlobalTransformState {
  readonly translation: Vector3Tuple;
  readonly rotation: Quat;
  readonly scale: Vector3Tuple;
}

function sortedByTime<K extends { t: number }>(keys: readonly K[]): K[] {
  return [...keys].sort((a, b) => a.t - b.t);
}

/** Global T/R/S at a local time already mapped into the animation cycle. */
export function globalTransformAt(
  keys: readonly TransformKeyframe[],
  localTime: number,
): GlobalTransformState {
  const span = keyframeSpan(sortedByTime(keys), localTime);
  if (!span) return { translation: ZERO, rotation: [0, 0, 0, 1], scale: ONE };
  const { a, b, u } = span;
  return {
    translation: lerpVec(a.translation, b.translation, u),
    rotation: quatSlerp(quatFromEulerDeg(a.rotation), quatFromEulerDeg(b.rotation), u),
    scale: lerpVec(a.scale, b.scale, u),
  };
}

export interface GroupDeformationState {
  readonly offset: Vector3Tuple;
  readonly rotation: Quat;
  readonly scale: number;
}

/** Deformation state of one group at its own (phase-shifted, looped) time. */
export function groupDeformationAt(
  group: MotionGroup,
  formationDuration: number,
  localTime: number,
): GroupDeformationState {
  const period =
    group.loopDuration && group.loopDuration > 0 ? group.loopDuration : formationDuration;
  const t = mapLoopTime(localTime + group.phaseOffset, period, group.loop);
  const span = keyframeSpan<GroupDeformationKeyframe>(sortedByTime(group.keyframes), t);
  if (!span) return { offset: ZERO, rotation: [0, 0, 0, 1], scale: 1 };
  const { a, b, u } = span;
  return {
    offset: lerpVec(a.offset, b.offset, u),
    rotation: quatSlerp(quatFromEulerDeg(a.rotation), quatFromEulerDeg(b.rotation), u),
    scale: lerp(a.scale, b.scale, u),
  };
}

export function groupPivot(group: MotionGroup, basisById: Map<string, Vector3Tuple>): Vector3Tuple {
  if (group.pivot) return group.pivot;
  const pts = group.pointIds.map((id) => basisById.get(id)).filter((p): p is Vector3Tuple => !!p);
  return centroid(pts);
}

/**
 * Samples the whole formation at local time `localTime` (seconds, may exceed the
 * duration — the loop mode decides what happens then).
 */
export function sampleDynamicFormation(
  formation: DynamicFormation,
  localTime: number,
): Vector3Tuple[] {
  if (formation.points.length === 0) {
    throw new DynamicFormationError(
      "INVALID_DYNAMIC_FORMATION",
      `Dynamic formation ${formation.id} has no points`,
      { formationId: formation.id },
    );
  }
  if (!Number.isFinite(localTime)) {
    throw new DynamicFormationError("INVALID_LOCAL_TIME", `Invalid local time: ${localTime}`, {
      formationId: formation.id,
    });
  }
  const duration = formation.duration > 0 ? formation.duration : 1;
  const cycleTime = mapLoopTime(localTime, duration, formation.loop);
  const global = globalTransformAt(formation.transform, cycleTime);
  const pivot = formation.pivot;

  const basisById = new Map<string, Vector3Tuple>();
  for (const p of formation.points) basisById.set(p.id, p.base);

  // Deformation contributions are computed per group once, then applied to the
  // points that group owns. Groups are additive and order independent.
  const deformation = new Map<string, [number, number, number]>();
  for (const group of formation.groups) {
    if (!group.enabled || group.pointIds.length === 0) continue;
    const state = groupDeformationAt(group, duration, cycleTime);
    const gp = groupPivot(group, basisById);
    for (const id of group.pointIds) {
      const base = basisById.get(id);
      if (!base) continue;
      const rel: Vector3Tuple = [base[0] - gp[0], base[1] - gp[1], base[2] - gp[2]];
      const rotated = rotateByQuat(
        [rel[0] * state.scale, rel[1] * state.scale, rel[2] * state.scale],
        state.rotation,
      );
      const dx = gp[0] + rotated[0] + state.offset[0] - base[0];
      const dy = gp[1] + rotated[1] + state.offset[1] - base[1];
      const dz = gp[2] + rotated[2] + state.offset[2] - base[2];
      const acc = deformation.get(id);
      if (acc) {
        acc[0] += dx;
        acc[1] += dy;
        acc[2] += dz;
      } else {
        deformation.set(id, [dx, dy, dz]);
      }
    }
  }

  return formation.points.map((point) => {
    const d = deformation.get(point.id);
    const local: Vector3Tuple = [
      (point.base[0] - pivot[0] + (d?.[0] ?? 0)) * global.scale[0],
      (point.base[1] - pivot[1] + (d?.[1] ?? 0)) * global.scale[1],
      (point.base[2] - pivot[2] + (d?.[2] ?? 0)) * global.scale[2],
    ];
    const rotated = rotateByQuat(local, global.rotation);
    return [
      pivot[0] + global.translation[0] + rotated[0],
      pivot[1] + global.translation[1] + rotated[1],
      pivot[2] + global.translation[2] + rotated[2],
    ] as Vector3Tuple;
  });
}

export interface DynamicEvaluatorOptions {
  /** Local time multiplier. 1 = real time. */
  readonly playbackRate?: number;
  /** Local time the segment enters the animation at. */
  readonly startOffset?: number;
  /** Cache quantisation in seconds (default 1 ms). */
  readonly quantum?: number;
}

/**
 * Shared, memoised evaluator.
 *
 * Every drone in a dynamic clip needs the SAME formation sample at the same
 * time. Sampling per drone would be O(N^2); the evaluator caches one sample per
 * quantised segment time so a 200-drone clip stays O(N) per frame.
 */
export interface DynamicEvaluator {
  readonly formation: DynamicFormation;
  readonly playbackRate: number;
  readonly startOffset: number;
  /** All point positions at SEGMENT time `t` (0 = segment start). */
  positionsAt(t: number): readonly Vector3Tuple[];
  /** One point position at segment time `t`. */
  pointAt(pointIndex: number, t: number): Vector3Tuple;
  readonly cacheSize: () => number;
}

export function createDynamicEvaluator(
  formation: DynamicFormation,
  options: DynamicEvaluatorOptions = {},
): DynamicEvaluator {
  const playbackRate = options.playbackRate && options.playbackRate > 0 ? options.playbackRate : 1;
  const startOffset = options.startOffset ?? 0;
  const quantum = options.quantum && options.quantum > 0 ? options.quantum : 0.001;
  const cache = new Map<number, readonly Vector3Tuple[]>();

  const positionsAt = (t: number): readonly Vector3Tuple[] => {
    const key = Math.round(t / quantum);
    const hit = cache.get(key);
    if (hit) return hit;
    const value = sampleDynamicFormation(formation, startOffset + key * quantum * playbackRate);
    // Bounded memory: a long clip at 100 Hz stays well inside this window.
    if (cache.size > 200_000) cache.clear();
    cache.set(key, value);
    return value;
  };

  return {
    formation,
    playbackRate,
    startOffset,
    positionsAt,
    pointAt: (pointIndex, t) =>
      positionsAt(t)[pointIndex] ?? formation.points[pointIndex]?.base ?? [0, 0, 0],
    cacheSize: () => cache.size,
  };
}
