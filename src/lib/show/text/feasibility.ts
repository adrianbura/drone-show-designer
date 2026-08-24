/**
 * TEXT GEOMETRY FEASIBILITY DIAGNOSTIC.
 *
 * Generating exactly N points proves ALLOCATION, not flyability. This module
 * answers the physical question instead: given the project's separation minimum,
 * can this many drones actually sit on this text at this size?
 *
 * MEASURED, never assumed:
 *   - `minPairSeparationMeters`: real minimum distance over ALL point pairs
 *     (exact, not nearest-neighbour heuristics), in the static text plane;
 *   - `violationPairCount`: how many pairs are closer than the limit;
 *   - `capacity`: how many points the sampled stroke length can carry at the
 *     required spacing, which is what makes "too many drones for this size"
 *     explainable instead of mysterious.
 *
 * This diagnostic NEVER relaxes validation: it is advisory evidence in front of
 * the canonical static preflight / full-show readiness, and it can only make
 * Apply stricter, never looser.
 *
 * Pure module: no React, no I/O.
 */
import type { ShowLimits, Vec3 } from "../types";
import type { TextGeometryResult } from "./types";

export type TextFeasibilityStatus = "FEASIBLE" | "TIGHT" | "INFEASIBLE";

export interface TextFeasibilityReport {
  readonly status: TextFeasibilityStatus;
  readonly participation: number;
  readonly requiredSeparationMeters: number;
  readonly minPairSeparationMeters: number;
  readonly violationPairCount: number;
  /** Distinct points involved in at least one violating pair. */
  readonly violatingPointCount: number;
  readonly requestedWidthMeters: number;
  readonly requestedHeightMeters: number;
  readonly usedWidthMeters: number;
  readonly usedHeightMeters: number;
  readonly pathMeters: number;
  /** Points the sampled stroke length can carry at the required separation. */
  readonly capacityPoints: number;
  /** True when participation exceeds that capacity. */
  readonly overCapacity: boolean;
  /** Size multiplier that would bring the geometry to the required spacing. */
  readonly suggestedScale: number;
  readonly suggestedWidthMeters: number;
  readonly suggestedHeightMeters: number;
  readonly note: string;
}

function minPairSeparation(points: readonly Vec3[], limit: number): {
  min: number;
  pairs: number;
  offenders: number;
} {
  let min = Infinity;
  let pairs = 0;
  const offenders = new Set<number>();
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    for (let j = i + 1; j < points.length; j += 1) {
      const b = points[j]!;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < min) min = d;
      if (d < limit) {
        pairs += 1;
        offenders.add(i);
        offenders.add(j);
      }
    }
  }
  return { min: Number.isFinite(min) ? min : 0, pairs, offenders: offenders.size };
}

export function evaluateTextFeasibility(
  geometry: TextGeometryResult,
  limits: Pick<SafetyLimits, "minSeparation">,
): TextFeasibilityReport {
  const required = limits.minSeparation;
  const { min, pairs, offenders } = minPairSeparation(geometry.points, required);
  // A curve of length L can carry at most floor(L / required) + 1 points spaced
  // at `required`; strokes are disjoint, so this is an upper bound, not a promise.
  const capacityPoints = Math.floor(geometry.pathMeters / Math.max(1e-9, required)) + 1;
  const participation = geometry.points.length;
  const overCapacity = participation > capacityPoints;
  const suggestedScale = min > 0 ? Math.max(1, required / min) : 1;
  const status: TextFeasibilityStatus =
    pairs > 0 || overCapacity ? "INFEASIBLE" : min < required * 1.25 ? "TIGHT" : "FEASIBLE";
  const note =
    status === "INFEASIBLE"
      ? overCapacity
        ? `The text strokes are ${geometry.pathMeters.toFixed(1)} m long, which can carry about ${capacityPoints} drones at ${required} m spacing — ${participation} are required. Increase the text size or shorten the text.`
        : `${pairs} drone pair(s) sit closer than the ${required} m minimum (closest ${min.toFixed(2)} m). Increase the size by about ${suggestedScale.toFixed(2)}x.`
      : status === "TIGHT"
        ? `Spacing holds (closest ${min.toFixed(2)} m vs ${required} m) but has little margin.`
        : `Spacing holds with margin (closest ${min.toFixed(2)} m vs ${required} m minimum).`;
  return {
    status,
    participation,
    requiredSeparationMeters: required,
    minPairSeparationMeters: min,
    violationPairCount: pairs,
    violatingPointCount: offenders,
    requestedWidthMeters: geometry.recipe.widthMeters,
    requestedHeightMeters: geometry.recipe.heightMeters,
    usedWidthMeters: geometry.bounds.widthMeters,
    usedHeightMeters: geometry.bounds.heightMeters,
    pathMeters: geometry.pathMeters,
    capacityPoints,
    overCapacity,
    suggestedScale,
    suggestedWidthMeters: geometry.recipe.widthMeters * suggestedScale,
    suggestedHeightMeters: geometry.recipe.heightMeters * suggestedScale,
    note,
  };
}
