/**
 * Constructors, editing operations and animation presets for dynamic
 * formations. Everything here is a pure function returning a NEW formation, so
 * the studio can keep an undo history of plain immutable values.
 */
import type { Formation, RGB, Vector3Tuple } from "../types";
import { centroid } from "./math";
import {
  DYNAMIC_FORMATION_ALGORITHM_VERSION,
  type DynamicFormation,
  type DynamicFormationPoint,
  type GroupDeformationKeyframe,
  type LoopMode,
  type MotionGroup,
  type TransformKeyframe,
} from "./types";

const GROUP_COLORS: RGB[] = [
  [255, 122, 89],
  [122, 214, 255],
  [180, 255, 140],
  [255, 214, 102],
  [214, 148, 255],
  [120, 255, 226],
];

/** Stable point id for a base index (`FP-001`). */
export function pointId(index: number): string {
  return `FP-${String(index + 1).padStart(3, "0")}`;
}

export function neutralTransformKeyframe(t: number): TransformKeyframe {
  return { t, translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], interpolation: "smooth" };
}

export function neutralGroupKeyframe(t: number): GroupDeformationKeyframe {
  return { t, offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1, interpolation: "smooth" };
}

export interface CreateDynamicOptions {
  readonly id: string;
  readonly name?: string;
  readonly duration?: number;
  readonly loop?: LoopMode;
  readonly seed?: number;
  readonly pivot?: Vector3Tuple;
}

/** Wraps a static formation as a dynamic one with no animation yet. */
export function dynamicFromFormation(
  formation: Formation,
  options: CreateDynamicOptions,
): DynamicFormation {
  const points: DynamicFormationPoint[] = formation.points.map((base, i) => ({
    id: pointId(i),
    base,
  }));
  return {
    id: options.id,
    name: options.name ?? `${formation.name} (dynamic)`,
    sourceFormationId: formation.id,
    points,
    pivot: options.pivot ?? centroid(points.map((p) => p.base)),
    duration: options.duration ?? 8,
    loop: options.loop ?? "REPEAT",
    transform: [neutralTransformKeyframe(0)],
    groups: [],
    seed: options.seed ?? 1,
    algorithmVersion: DYNAMIC_FORMATION_ALGORITHM_VERSION,
  };
}

/**
 * Regenerates the base cloud from a (possibly resized) static formation while
 * preserving every group membership that still refers to an existing point id.
 * This keeps fleet-size changes valid: exact-N stays exact-N.
 */
export function rebasePoints(
  formation: DynamicFormation,
  basePoints: readonly Vector3Tuple[],
): DynamicFormation {
  const points: DynamicFormationPoint[] = basePoints.map((base, i) => ({ id: pointId(i), base }));
  const known = new Set(points.map((p) => p.id));
  return {
    ...formation,
    points,
    pivot: centroid(points.map((p) => p.base)),
    groups: formation.groups.map((g) => ({
      ...g,
      pointIds: g.pointIds.filter((id) => known.has(id)),
    })),
  };
}

export function addMotionGroup(
  formation: DynamicFormation,
  name: string,
  pointIds: readonly string[],
  groupId?: string,
): DynamicFormation {
  const id = groupId ?? `mg-${formation.groups.length + 1}-${Math.abs(hash(name + formation.id))}`;
  const group: MotionGroup = {
    id,
    name,
    pointIds: [...new Set(pointIds)],
    color: GROUP_COLORS[formation.groups.length % GROUP_COLORS.length]!,
    keyframes: [neutralGroupKeyframe(0)],
    loop: "REPEAT",
    phaseOffset: 0,
    enabled: true,
  };
  return { ...formation, groups: [...formation.groups, group] };
}

export function removeMotionGroup(formation: DynamicFormation, groupId: string): DynamicFormation {
  return { ...formation, groups: formation.groups.filter((g) => g.id !== groupId) };
}

export function patchMotionGroup(
  formation: DynamicFormation,
  groupId: string,
  patch: Partial<MotionGroup>,
): DynamicFormation {
  return {
    ...formation,
    groups: formation.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
  };
}

/** Inserts or replaces a global transform keyframe at `key.t`. */
export function upsertTransformKeyframe(
  formation: DynamicFormation,
  key: TransformKeyframe,
): DynamicFormation {
  return { ...formation, transform: upsert(formation.transform, key) };
}

export function removeTransformKeyframe(formation: DynamicFormation, t: number): DynamicFormation {
  const remaining = formation.transform.filter((k) => !near(k.t, t));
  return { ...formation, transform: remaining.length > 0 ? remaining : [neutralTransformKeyframe(0)] };
}

export function upsertGroupKeyframe(
  formation: DynamicFormation,
  groupId: string,
  key: GroupDeformationKeyframe,
): DynamicFormation {
  return patchMotionGroup(formation, groupId, {
    keyframes: upsert(formation.groups.find((g) => g.id === groupId)?.keyframes ?? [], key),
  });
}

export function removeGroupKeyframe(
  formation: DynamicFormation,
  groupId: string,
  t: number,
): DynamicFormation {
  const group = formation.groups.find((g) => g.id === groupId);
  if (!group) return formation;
  const remaining = group.keyframes.filter((k) => !near(k.t, t));
  return patchMotionGroup(formation, groupId, {
    keyframes: remaining.length > 0 ? remaining : [neutralGroupKeyframe(0)],
  });
}

function upsert<K extends { t: number }>(keys: readonly K[], key: K): K[] {
  const out = keys.filter((k) => !near(k.t, key.t));
  out.push(key);
  return out.sort((a, b) => a.t - b.t);
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-4;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/* ----------------------------- Group helpers ----------------------------- */

/** Splits points into left / right halves about the formation pivot X. */
export function splitLeftRight(formation: DynamicFormation): {
  left: string[];
  right: string[];
  centre: string[];
} {
  const left: string[] = [];
  const right: string[] = [];
  const centre: string[] = [];
  const x0 = formation.pivot[0];
  const spanX =
    Math.max(...formation.points.map((p) => Math.abs(p.base[0] - x0)), 1) * 0.12;
  for (const p of formation.points) {
    const d = p.base[0] - x0;
    if (d < -spanX) left.push(p.id);
    else if (d > spanX) right.push(p.id);
    else centre.push(p.id);
  }
  return { left, right, centre };
}

/** Splits points into `bands` groups along an axis (0=X, 1=Y, 2=Z). */
export function bandGroups(
  formation: DynamicFormation,
  axis: 0 | 1 | 2,
  bands: number,
): string[][] {
  const n = Math.max(1, Math.floor(bands));
  const values = formation.points.map((p) => p.base[axis]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-6, max - min);
  const out: string[][] = Array.from({ length: n }, () => []);
  formation.points.forEach((p) => {
    const k = Math.min(n - 1, Math.floor(((p.base[axis] - min) / span) * n));
    out[k]!.push(p.id);
  });
  return out;
}

/* -------------------------------- Presets -------------------------------- */

export type DynamicPresetId = "PULSE" | "ORBIT" | "WAVE" | "FLAP" | "TWIST" | "DRIFT";

export const DYNAMIC_PRESETS: { id: DynamicPresetId; label: string; description: string }[] = [
  { id: "PULSE", label: "Pulse", description: "Global breathing scale" },
  { id: "ORBIT", label: "Orbit", description: "Full yaw rotation about the pivot" },
  { id: "WAVE", label: "Wave", description: "Phase-shifted vertical bands" },
  { id: "FLAP", label: "Flap", description: "Left / right wings rotating in opposition" },
  { id: "TWIST", label: "Twist", description: "Bands counter-rotating around Y" },
  { id: "DRIFT", label: "Drift", description: "Slow global translation loop" },
];

/**
 * Applies an animation preset. Presets are ordinary keyframe data — nothing in
 * the sampler special-cases them, so any preset can be edited afterwards.
 */
export function applyPreset(
  formation: DynamicFormation,
  preset: DynamicPresetId,
  amount = 1,
): DynamicFormation {
  const d = formation.duration > 0 ? formation.duration : 8;
  const half = d / 2;
  const k = Math.max(0.05, amount);
  switch (preset) {
    case "PULSE": {
      const s = 1 + 0.18 * k;
      return {
        ...formation,
        loop: "PING_PONG",
        transform: [
          neutralTransformKeyframe(0),
          { ...neutralTransformKeyframe(half), scale: [s, s, s] },
          neutralTransformKeyframe(d),
        ],
      };
    }
    case "ORBIT":
      return {
        ...formation,
        loop: "REPEAT",
        transform: [
          neutralTransformKeyframe(0),
          { ...neutralTransformKeyframe(half), rotation: [0, 180 * k, 0], interpolation: "linear" },
          { ...neutralTransformKeyframe(d), rotation: [0, 360 * k, 0], interpolation: "linear" },
        ],
      };
    case "DRIFT": {
      const a = 12 * k;
      return {
        ...formation,
        loop: "PING_PONG",
        transform: [
          neutralTransformKeyframe(0),
          { ...neutralTransformKeyframe(half), translation: [a, a * 0.25, 0] },
          neutralTransformKeyframe(d),
        ],
      };
    }
    case "WAVE": {
      const bands = bandGroups(formation, 0, 6);
      let next: DynamicFormation = { ...formation, groups: [] };
      bands.forEach((ids, i) => {
        if (ids.length === 0) return;
        next = addMotionGroup(next, `Wave band ${i + 1}`, ids, `mg-wave-${i}`);
        next = patchMotionGroup(next, `mg-wave-${i}`, {
          loop: "PING_PONG",
          loopDuration: d / 2,
          phaseOffset: (i * d) / (bands.length * 2),
          keyframes: [
            neutralGroupKeyframe(0),
            { ...neutralGroupKeyframe(d / 4), offset: [0, 5 * k, 0] },
            neutralGroupKeyframe(d / 2),
          ],
        });
      });
      return next;
    }
    case "FLAP": {
      const { left, right } = splitLeftRight(formation);
      let next: DynamicFormation = { ...formation, groups: [] };
      if (left.length > 0) {
        next = addMotionGroup(next, "Left wing", left, "mg-wing-left");
        next = patchMotionGroup(next, "mg-wing-left", {
          loop: "PING_PONG",
          loopDuration: d / 2,
          keyframes: [
            { ...neutralGroupKeyframe(0), rotation: [0, 0, -22 * k] },
            { ...neutralGroupKeyframe(d / 2), rotation: [0, 0, 26 * k] },
          ],
        });
      }
      if (right.length > 0) {
        next = addMotionGroup(next, "Right wing", right, "mg-wing-right");
        next = patchMotionGroup(next, "mg-wing-right", {
          loop: "PING_PONG",
          loopDuration: d / 2,
          keyframes: [
            { ...neutralGroupKeyframe(0), rotation: [0, 0, 22 * k] },
            { ...neutralGroupKeyframe(d / 2), rotation: [0, 0, -26 * k] },
          ],
        });
      }
      return next;
    }
    case "TWIST": {
      const bands = bandGroups(formation, 1, 4);
      let next: DynamicFormation = { ...formation, groups: [] };
      bands.forEach((ids, i) => {
        if (ids.length === 0) return;
        const id = `mg-twist-${i}`;
        const sign = i % 2 === 0 ? 1 : -1;
        next = addMotionGroup(next, `Twist band ${i + 1}`, ids, id);
        next = patchMotionGroup(next, id, {
          loop: "PING_PONG",
          loopDuration: d,
          pivot: formation.pivot,
          keyframes: [
            { ...neutralGroupKeyframe(0), rotation: [0, -18 * k * sign, 0] },
            { ...neutralGroupKeyframe(d), rotation: [0, 18 * k * sign, 0] },
          ],
        });
      });
      return next;
    }
    default:
      return formation;
  }
}

/** Mirrors every group deformation about the formation X pivot (left <-> right). */
export function mirrorGroupsX(formation: DynamicFormation): DynamicFormation {
  return {
    ...formation,
    groups: formation.groups.map((g) => ({
      ...g,
      keyframes: g.keyframes.map((k) => ({
        ...k,
        offset: [-k.offset[0], k.offset[1], k.offset[2]] as Vector3Tuple,
        rotation: [k.rotation[0], -k.rotation[1], -k.rotation[2]] as Vector3Tuple,
      })),
    })),
  };
}
