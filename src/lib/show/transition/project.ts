/**
 * Bridge from the creative model (ShowProject + timeline clip) to a
 * TransitionInput. Pure: it reads a project and a plan, and returns data.
 *
 * Only SHOW -> SHOW clip transitions are analysed here. TAKEOFF and LANDING
 * keep their existing behaviour and are intentionally not optimised in this
 * sprint (they have vertical semantics and deserve dedicated planners).
 */
import type { AssignmentStrategyId } from "../assignment";
import type { ShowPlan } from "../trajectory/schedule";
import { positionsAt } from "../trajectory/schedule";
import { clipPhase, type ShowProject, type Vector3Tuple } from "../types";
import type { TransitionInput } from "./types";
import { TransitionOptimizationError } from "./types";

export interface ClipTransitionOptions {
  readonly strategy: AssignmentStrategyId;
  readonly sampleRate?: number;
  /** Overrides the clip's own transition duration (for what-if analysis). */
  readonly duration?: number;
}

export function isOptimizableClip(project: ShowProject, clipId: string): boolean {
  const clip = project.timeline.find((c) => c.id === clipId);
  return !!clip && clipPhase(clip) === "SHOW";
}

export function transitionInputForClip(
  project: ShowProject,
  plan: ShowPlan,
  clipId: string,
  options: ClipTransitionOptions,
): TransitionInput {
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip) {
    throw new TransitionOptimizationError("INVALID_TARGET_FORMATION", `Clip ${clipId} not found`);
  }
  const formation = project.formations.find((f) => f.id === clip.formationId);
  if (!formation || formation.points.length === 0) {
    throw new TransitionOptimizationError(
      "INVALID_TARGET_FORMATION",
      `Clip ${clipId} has no usable target formation`,
      { formationId: clip.formationId },
    );
  }
  // Source = where the fleet actually is when this clip's transition begins.
  const source: Vector3Tuple[] = positionsAt(plan, Math.max(0, clip.start - 1e-4));
  return {
    drones: plan.drones,
    source,
    target: formation.points as Vector3Tuple[],
    duration: Math.max(0.1, options.duration ?? clip.transition),
    limits: project.limits,
    strategy: options.strategy,
    easing: clip.easing,
    ...(options.sampleRate !== undefined ? { sampleRate: options.sampleRate } : {}),
    startTime: clip.start,
    clipId: clip.id,
  };
}
