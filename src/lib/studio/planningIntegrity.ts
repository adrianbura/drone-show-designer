/**
 * PLANNING STATE INTEGRITY (timeline history + override validity).
 *
 * An applied `ClipTransitionOverride` is NOT a UI preference: it replaces both
 * the assignment and the deconfliction decorators for one SHOW clip, so it
 * decides the flown trajectory. It is produced by the TransitionOptimizer for a
 * specific geometry AND a specific timing:
 *
 *   - `targetPointIndex` indexes the clip's formation point list
 *     (`schedule.ts`: clamped against `formation.points`),
 *   - `startOffsets` are bounded by `transition * 0.5` and consumed as
 *     `duration = transition - startOffset`,
 *   - feasibility was assessed against `input.duration = clip.transition` and
 *     against the source positions sampled at `clip.start`
 *     (`transition/project.ts` -> `positionsAt(plan, clip.start - eps)`).
 *
 * Therefore the override is TIMING-DEPENDENT in `start` and `transition`, and
 * timing-INDEPENDENT in `hold` (hold happens after the transition and never
 * feeds the optimizer input for its own clip).
 *
 * `overrideBasis` captures exactly those inputs. When the basis of a clip
 * changes, its override is stale and must be dropped — but only that clip's.
 */
import type { ShowProject, Vector3Tuple } from "../show/types";
import { clipPhase } from "../show/types";
import type { ClipTransitionOverride } from "../show/trajectory/schedule";
import { buildDroneDefinitions } from "../show/drones";
import { canonicalClipTarget, clipOptimizability } from "../show/trajectory/target";

export type OverrideBasisMap = Readonly<Record<string, string>>;

function quantize(points: readonly Vector3Tuple[]): string {
  return points.map((p) => p.map((v) => Number(v.toFixed(4)).toFixed(4)).join(",")).join(";");
}

/**
 * Stable signature of everything an override for `clipId` was computed for.
 *
 * It hashes the CANONICAL resolved target (composite scene transforms, scene
 * object geometry/budgets, dynamic entry state, base formation points) — the
 * exact optimisation input — plus timing and the safety limits that drive
 * feasibility. Anything that changes the target therefore invalidates exactly
 * this clip's override, and nothing else.
 */
export function overrideBasis(project: ShowProject, clipId: string): string | null {
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip || clipPhase(clip) !== "SHOW") return null;
  const home = buildDroneDefinitions(project).map((d) => d.homePosition);
  if (!clipOptimizability(project, clipId, home).optimizable) return null;
  const resolved = canonicalClipTarget(project, clip, home);
  return [
    project.droneCount,
    clip.start.toFixed(4),
    clip.transition.toFixed(4),
    clip.easing,
    clip.formationId,
    resolved.kind,
    resolved.dynamicFormationId ?? "-",
    resolved.rawTarget.length,
    quantize(resolved.rawTarget),
    project.limits.maxVelocity,
    project.limits.maxAcceleration,
    project.limits.maxJerk,
    project.limits.minSeparation,
    project.limits.maxAltitude,
  ].join("|");
}


/** Basis for every clip that currently carries an override. */
export function computeOverrideBasis(
  project: ShowProject,
  overrides: Readonly<Record<string, ClipTransitionOverride>>,
): OverrideBasisMap {
  const basis: Record<string, string> = {};
  for (const clipId of Object.keys(overrides)) {
    const value = overrideBasis(project, clipId);
    if (value !== null) basis[clipId] = value;
  }
  return basis;
}

export interface PrunedOverrides {
  readonly overrides: Record<string, ClipTransitionOverride>;
  readonly basis: OverrideBasisMap;
  /** Clip ids whose override was invalidated by this project revision. */
  readonly invalidated: readonly string[];
  readonly changed: boolean;
}

/**
 * Keeps every override whose planning basis is unchanged and drops exactly the
 * stale ones. A blanket reset is wrong: it silently reverts a saved, optimized
 * project to unoptimized planning on the first unrelated edit.
 */
export function pruneTransitionOverrides(
  project: ShowProject,
  overrides: Readonly<Record<string, ClipTransitionOverride>>,
  previous: OverrideBasisMap,
): PrunedOverrides {
  const kept: Record<string, ClipTransitionOverride> = {};
  const basis: Record<string, string> = {};
  const invalidated: string[] = [];

  for (const [clipId, override] of Object.entries(overrides)) {
    const current = overrideBasis(project, clipId);
    if (current === null) {
      invalidated.push(clipId);
      continue;
    }
    const before = previous[clipId];
    if (before !== undefined && before !== current) {
      invalidated.push(clipId);
      continue;
    }
    if (override.targetPointIndex.length !== project.droneCount) {
      invalidated.push(clipId);
      continue;
    }
    kept[clipId] = override;
    basis[clipId] = current;
  }

  return {
    overrides: kept,
    basis,
    invalidated,
    changed: invalidated.length > 0,
  };
}

/**
 * One undoable timeline revision. Contains every canonical authoring/planning
 * state a timeline command can change; transient analysis reports are excluded
 * on purpose (they are derived and recomputed from these two).
 */
export interface TimelineHistorySnapshot {
  readonly project: ShowProject;
  readonly transitionOverrides: Readonly<Record<string, ClipTransitionOverride>>;
}
