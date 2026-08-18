/**
 * OBJECT-LEVEL PROXIMITY — ADVISORY ONLY.
 *
 * A cheap design-time hint that two visual objects share the same air. It is NOT
 * a safety mechanism and it is NOT a substitute for anything: the trajectory
 * conflict detector and the safety validator remain authoritative, run over the
 * FULL fleet, and can report violations this check never sees (and vice versa).
 *
 * The separation threshold comes from the EXISTING safety configuration
 * (`limits.minSeparation`); no second minimum-distance setting is invented.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { SafetyLimits, Vector3Tuple } from "../types";
import type { ResolvedScene } from "./types";

export interface ObjectBounds {
  readonly groupId: string;
  readonly name: string;
  readonly min: Vector3Tuple;
  readonly max: Vector3Tuple;
}

export interface ObjectProximityWarning {
  readonly a: string;
  readonly b: string;
  readonly aName: string;
  readonly bName: string;
  /** Axis-aligned gap in metres. Negative means the footprints intersect. */
  readonly gap: number;
  readonly overlapping: boolean;
}

export function objectBounds(scene: ResolvedScene): ObjectBounds[] {
  return scene.groups.map((group) => {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = group.offset; i < group.offset + group.pointCount; i++) {
      const p = scene.points[i];
      if (!p) continue;
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      minZ = Math.min(minZ, p[2]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
      maxZ = Math.max(maxZ, p[2]);
    }
    return {
      groupId: group.groupId,
      name: group.name,
      min: [minX, minY, minZ] as Vector3Tuple,
      max: [maxX, maxY, maxZ] as Vector3Tuple,
    };
  });
}

const axisGap = (aMin: number, aMax: number, bMin: number, bMax: number): number =>
  bMin > aMax ? bMin - aMax : aMin > bMax ? aMin - bMax : -Math.min(aMax - bMin, bMax - aMin);

/** Advisory warnings for object footprints closer than `minSeparation`. */
export function objectProximityWarnings(
  scene: ResolvedScene,
  limits: SafetyLimits,
): ObjectProximityWarning[] {
  const bounds = objectBounds(scene);
  const out: ObjectProximityWarning[] = [];
  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i]!;
      const b = bounds[j]!;
      const gaps = [
        axisGap(a.min[0], a.max[0], b.min[0], b.max[0]),
        axisGap(a.min[1], a.max[1], b.min[1], b.max[1]),
        axisGap(a.min[2], a.max[2], b.min[2], b.max[2]),
      ];
      // Separated as soon as ONE axis separates them.
      const gap = Math.max(...gaps);
      if (gap < limits.minSeparation) {
        out.push({
          a: a.groupId,
          b: b.groupId,
          aName: a.name,
          bName: b.name,
          gap: Number(gap.toFixed(3)),
          // Footprints intersect (or exactly touch) on every axis. A flat object
          // has a zero-span axis, so `<= 0` is the correct intersection test.
          overlapping: gap <= 0,
        });
      }
    }
  }
  return out;
}
