import type { AssignmentStrategyId } from "../assignment";
import { buildShowPlan, type ClipTransitionOverride } from "../trajectory/schedule";
import type { ShowProject } from "../types";
import { optimizeTransition } from "./optimizer";
import { transitionInputForClip } from "./project";
import type { TransitionOptimizationResult } from "./types";

export interface CandidateTransitionOptimization {
  readonly result: TransitionOptimizationResult;
  readonly override: ClipTransitionOverride;
}

/**
 * Optimises one clip on a hypothetical project revision.
 *
 * Any previously authored override for the edited clip is deliberately removed
 * before the candidate source/target pair is resolved: it was computed for the
 * old geometry. Overrides for unrelated clips remain active so the candidate is
 * analysed in the same surrounding show state the user is editing.
 */
export function optimizeCandidateClipTransition(input: {
  readonly project: ShowProject;
  readonly clipId: string;
  readonly assignmentStrategy: AssignmentStrategyId;
  readonly sampleRate?: number;
  readonly transitionOverrides?: Readonly<Record<string, ClipTransitionOverride>>;
}): CandidateTransitionOptimization {
  const transitionOverrides = { ...(input.transitionOverrides ?? {}) };
  delete transitionOverrides[input.clipId];
  const plan = buildShowPlan(input.project, {
    assignmentStrategy: input.assignmentStrategy,
    transitionOverrides,
  });
  const transitionInput = transitionInputForClip(input.project, plan, input.clipId, {
    strategy: input.assignmentStrategy,
    ...(input.sampleRate !== undefined ? { sampleRate: input.sampleRate } : {}),
  });
  const result = optimizeTransition(transitionInput);
  const override: ClipTransitionOverride = {
    targetPointIndex: result.final.dronePlans.map((plan) => plan.targetPointIndex),
    startOffsets: result.final.dronePlans.map((plan) => plan.startOffset),
    laneOffsets: result.final.dronePlans.map((plan) => plan.lane.offsetMetres),
    strategy: `${result.final.metrics.assignmentStrategy}+candidate-optimized`,
  };
  return { result, override };
}
