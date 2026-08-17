/**
 * Builds a NATIVE DynamicFormation from a segment decomposition.
 *
 * The native model is used exactly as designed — no hidden fields, no special
 * cases in the sampler:
 *
 *   pivot   = C_ref                    (world metres)
 *   base_i  = P_i(t_ref)               (world metres, so base_i - pivot = Q_i)
 *   T/R     = global transform track   (translation metres, euler degrees)
 *   D_i(t)  = a single-point motion group whose OFFSET keyframes carry the
 *             local deformation. For a one-point group the group pivot is the
 *             point itself, so the group contributes exactly `offset`.
 *
 * Points with no measurable deformation get no group at all, which keeps rigid
 * segments cheap.
 */
import type { RGB, Vector3Tuple } from "../../../show/types";
import {
  DYNAMIC_FORMATION_ALGORITHM_VERSION,
  type DynamicFormation,
  type DynamicFormationPoint,
  type GroupDeformationKeyframe,
  type MotionGroup,
  type TransformKeyframe,
} from "../../../show/dynamic/types";
import type { SegmentDecomposition } from "./decompose";
import type { SuggestedMotionGroup } from "./types";

/** Stable converted-point id: source drone k -> `DP-001`. */
export function conversionPointId(index: number): string {
  return `DP-${String(index + 1).padStart(3, "0")}`;
}

const DEFORMATION_EPSILON = 1e-9;

const SUGGESTION_COLORS: RGB[] = [
  [122, 214, 255],
  [255, 122, 89],
  [180, 255, 140],
  [255, 214, 102],
  [214, 148, 255],
  [120, 255, 226],
];

export interface BuildFormationInput {
  readonly decomposition: SegmentDecomposition;
  /** Sample indices kept as global transform keyframes. */
  readonly transformIndices: readonly number[];
  /** Per-point sample indices kept as deformation keyframes. */
  readonly deformationIndices: readonly (readonly number[])[];
  readonly id: string;
  readonly name: string;
  readonly seed: number;
  readonly suggestedGroups?: readonly SuggestedMotionGroup[];
}

export function buildDynamicFormationFromDecomposition(
  input: BuildFormationInput,
): DynamicFormation {
  const d = input.decomposition;
  const duration = Math.max(1e-6, d.localTimes[d.localTimes.length - 1] ?? 0);

  const points: DynamicFormationPoint[] = d.basePoints.map((base, i) => ({
    id: conversionPointId(i),
    base: [base[0], base[1], base[2]] as Vector3Tuple,
  }));

  const transform: TransformKeyframe[] = input.transformIndices.map((k) => {
    const s = d.transform[k]!;
    return {
      t: s.t,
      translation: [s.translation[0], s.translation[1], s.translation[2]] as Vector3Tuple,
      rotation: [s.rotationEulerDeg[0], s.rotationEulerDeg[1], s.rotationEulerDeg[2]] as Vector3Tuple,
      scale: [1, 1, 1] as Vector3Tuple,
      interpolation: "linear",
    };
  });

  const groups: MotionGroup[] = [];
  for (let i = 0; i < d.droneCount; i++) {
    const indices = input.deformationIndices[i] ?? [];
    if (indices.length === 0) continue;
    let moves = false;
    const keyframes: GroupDeformationKeyframe[] = indices.map((k) => {
      const o = k * d.droneCount * 3 + i * 3;
      const offset: Vector3Tuple = [d.deformation[o]!, d.deformation[o + 1]!, d.deformation[o + 2]!];
      if (Math.abs(offset[0]) > DEFORMATION_EPSILON) moves = true;
      if (Math.abs(offset[1]) > DEFORMATION_EPSILON) moves = true;
      if (Math.abs(offset[2]) > DEFORMATION_EPSILON) moves = true;
      return { t: d.localTimes[k]!, offset, rotation: [0, 0, 0], scale: 1, interpolation: "linear" };
    });
    if (!moves) continue;
    const pointId = conversionPointId(i);
    groups.push({
      id: `dg-${pointId}`,
      name: `Deformation ${pointId}`,
      pointIds: [pointId],
      color: [148, 163, 184],
      keyframes,
      loop: "NONE",
      loopDuration: duration,
      phaseOffset: 0,
      enabled: true,
    });
  }

  // Suggested groups are MEMBERSHIP ONLY: disabled and neutral, so they cannot
  // change geometry. They exist so the operator can rename and animate them.
  (input.suggestedGroups ?? []).forEach((s, i) => {
    if (s.pointIds.length === 0) return;
    groups.push({
      id: s.id,
      name: s.name,
      pointIds: [...s.pointIds],
      color: SUGGESTION_COLORS[i % SUGGESTION_COLORS.length]!,
      keyframes: [{ t: 0, offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1, interpolation: "linear" }],
      loop: "NONE",
      phaseOffset: 0,
      enabled: false,
    });
  });

  return {
    id: input.id,
    name: input.name,
    points,
    pivot: [d.pivot[0], d.pivot[1], d.pivot[2]] as Vector3Tuple,
    duration,
    loop: "NONE",
    transform: transform.length > 0 ? transform : [
      { t: 0, translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], interpolation: "linear" },
    ],
    groups,
    seed: input.seed,
    algorithmVersion: DYNAMIC_FORMATION_ALGORITHM_VERSION,
  };
}

/** Total keyframe count of a formation (transform + every group). */
export function countKeyframes(formation: DynamicFormation): {
  transform: number;
  deformation: number;
  total: number;
} {
  const transform = formation.transform.length;
  const deformation = formation.groups.reduce(
    (sum, g) => sum + (g.enabled ? g.keyframes.length : 0),
    0,
  );
  return { transform, deformation, total: transform + deformation };
}
