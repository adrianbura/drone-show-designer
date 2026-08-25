/**
 * Bridge from the creative model (ShowProject + timeline clip) to a
 * TransitionInput. Pure: it reads a project and a plan, and returns data.
 *
 * CANONICAL TARGET AUTHORITY: the target geometry comes from
 * `canonicalClipTarget()` (trajectory/target.ts) — the exact resolver
 * `buildShowPlan()` uses — so the optimiser can never analyse a transition the
 * scheduler would not fly. No scene/dynamic/participation logic is duplicated
 * here.
 *
 * Only SHOW clips whose target is representable as a fleet-indexed permutation
 * are optimizable (see `clipOptimizability`): TAKEOFF/LANDING keep their
 * dedicated vertical planners, and partial-fleet participation clips are
 * explicitly rejected instead of being optimised against base formation points.
 */
import type { AssignmentStrategyId } from "../assignment";
import type { ShowPlan } from "../trajectory/schedule";
import { positionsAt } from "../trajectory/schedule";
import { canonicalClipTarget, clipOptimizability } from "../trajectory/target";
import type { ShowProject, Vector3Tuple } from "../types";
import type { TransitionInput } from "./types";
import { TransitionOptimizationError } from "./types";

export interface ClipTransitionOptions {
  readonly strategy: AssignmentStrategyId;
  readonly sampleRate?: number;
  /** Overrides the clip's own transition duration (for what-if analysis). */
  readonly duration?: number;
}

/** Home/pad positions as the plan resolved them (pads when a pre-show exists). */
function planHome(plan: ShowPlan): Vector3Tuple[] {
  return plan.drones.map((d) => d.homePosition);
}

export function isOptimizableClip(project: ShowProject, clipId: string, plan?: ShowPlan): boolean {
  const home = plan ? planHome(plan) : project.formations.length ? [] : [];
  return clipOptimizability(project, clipId, home).optimizable;
}

/** Structured reason, for UI messaging. */
export function clipOptimizabilityReason(project: ShowProject, clipId: string, plan?: ShowPlan) {
  return clipOptimizability(project, clipId, plan ? planHome(plan) : []);
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
  const home = planHome(plan);
  const eligibility = clipOptimizability(project, clipId, home);
  if (!eligibility.optimizable) {
    throw new TransitionOptimizationError("INVALID_TARGET_FORMATION", eligibility.message, {
      clipId,
      code: eligibility.code,
    });
  }
  const resolved = canonicalClipTarget(project, clip, home);
  // Source = where the fleet actually is when this clip's transition begins.
  const source: Vector3Tuple[] = positionsAt(plan, Math.max(plan.startTime, clip.start - 1e-4));
  return {
    drones: plan.drones,
    source,
    // Fleet-indexed canonical target: `targetPointIndex` produced by the
    // optimiser indexes THIS list, which is exactly what the scheduler assigns.
    target: resolved.rawTarget as Vector3Tuple[],
    duration: Math.max(0.1, options.duration ?? clip.transition),
    limits: project.limits,
    area: project.area,
    strategy: options.strategy,
    easing: clip.easing,
    ...(options.sampleRate !== undefined ? { sampleRate: options.sampleRate } : {}),
    startTime: clip.start,
    clipId: clip.id,
  };
}
