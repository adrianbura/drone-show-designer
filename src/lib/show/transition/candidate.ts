import type { AssignmentStrategyId } from "../assignment";
import { sampleReferenceShow } from "../../import/essp/playback";
import { referenceKinematicsAt } from "../../import/essp/native/derivatives";
import type { ReferenceAuthorityInput } from "../fullshow/effective";
import { buildShowPlan, type ClipTransitionOverride } from "../trajectory/schedule";
import type { ShowProject, Vector3Tuple } from "../types";
import { optimizeTransition } from "./optimizer";
import { isOptimizableClip, transitionInputForClip } from "./project";
import { DEFAULT_OPTIMIZATION_SETTINGS, type TransitionOptimizationResult } from "./types";

export interface CandidateTransitionOptimization {
  readonly result: TransitionOptimizationResult;
  readonly override: ClipTransitionOverride;
}

export interface CandidateGeometryTransitionOptimizations {
  /** Chronological transition ids whose boundary depends on the edited clip. */
  readonly clipIds: readonly string[];
  readonly optimizations: Readonly<Record<string, CandidateTransitionOptimization>>;
  readonly overrides: Readonly<Record<string, ClipTransitionOverride>>;
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
  readonly boundarySourcePositions?: readonly Vector3Tuple[];
  readonly boundaryTargetPositions?: readonly Vector3Tuple[];
  readonly boundarySourceVelocities?: readonly Vector3Tuple[];
  readonly boundaryTargetVelocities?: readonly Vector3Tuple[];
  /** A reference handoff is identity-bound: target swaps would reintroduce a splice jump. */
  readonly lockTargetIdentity?: boolean;
}): CandidateTransitionOptimization {
  const transitionOverrides = { ...(input.transitionOverrides ?? {}) };
  delete transitionOverrides[input.clipId];
  const plan = buildShowPlan(input.project, {
    assignmentStrategy: input.assignmentStrategy,
    transitionOverrides,
  });
  const baseInput = transitionInputForClip(input.project, plan, input.clipId, {
    strategy: input.lockTargetIdentity ? "identity" : input.assignmentStrategy,
    ...(input.sampleRate !== undefined ? { sampleRate: input.sampleRate } : {}),
  });
  const transitionInput = {
    ...baseInput,
    ...(input.boundarySourcePositions ? { source: input.boundarySourcePositions } : {}),
    ...(input.boundaryTargetPositions ? { target: input.boundaryTargetPositions } : {}),
    ...(input.boundarySourceVelocities ? { sourceVelocities: input.boundarySourceVelocities } : {}),
    ...(input.boundaryTargetVelocities ? { targetVelocities: input.boundaryTargetVelocities } : {}),
  };
  const result = optimizeTransition(
    transitionInput,
    input.lockTargetIdentity
      ? { ...DEFAULT_OPTIMIZATION_SETTINGS, enableSwaps: false }
      : DEFAULT_OPTIMIZATION_SETTINGS,
  );
  const override: ClipTransitionOverride = {
    targetPointIndex: result.final.dronePlans.map((plan) => plan.targetPointIndex),
    startOffsets: result.final.dronePlans.map((plan) => plan.startOffset),
    laneOffsets: result.final.dronePlans.map((plan) => plan.lane.offsetMetres),
    lateralOffsets: result.final.dronePlans.map((plan) => plan.lateralOffsetMetres ?? 0),
    ...(input.boundarySourcePositions
      ? {
          boundarySourcePositions: input.boundarySourcePositions.map(
            (point) => [...point] as Vector3Tuple,
          ),
        }
      : {}),
    ...(input.boundaryTargetPositions
      ? {
          boundaryTargetPositions: input.boundaryTargetPositions.map(
            (point) => [...point] as Vector3Tuple,
          ),
        }
      : {}),
    ...(input.boundarySourceVelocities
      ? {
          boundarySourceVelocities: input.boundarySourceVelocities.map(
            (velocity) => [...velocity] as Vector3Tuple,
          ),
        }
      : {}),
    ...(input.boundaryTargetVelocities
      ? {
          boundaryTargetVelocities: input.boundaryTargetVelocities.map(
            (velocity) => [...velocity] as Vector3Tuple,
          ),
        }
      : {}),
    strategy: `${result.final.metrics.assignmentStrategy}+candidate-optimized`,
  };
  return { result, override };
}

/**
 * Optimises every transition boundary changed by replacing one clip's
 * geometry. A transition is owned by its destination clip, therefore editing
 * clip N changes both the transition into N and (when it is an optimizable SHOW
 * clip) the transition into N + 1.
 *
 * The optimisations are deliberately sequential. The outgoing boundary must
 * resolve its source positions from a show plan that already contains the
 * accepted incoming override; otherwise the two independently valid answers
 * may describe different candidate shows.
 */
export function optimizeCandidateGeometryTransitions(input: {
  readonly project: ShowProject;
  readonly editedClipId: string;
  readonly assignmentStrategy: AssignmentStrategyId;
  readonly sampleRate?: number;
  readonly transitionOverrides?: Readonly<Record<string, ClipTransitionOverride>>;
  readonly reference?: ReferenceAuthorityInput | null;
}): CandidateGeometryTransitionOptimizations {
  const ordered = [...input.project.timeline].sort(
    (a, b) => a.start - b.start || a.id.localeCompare(b.id),
  );
  const editedIndex = ordered.findIndex((clip) => clip.id === input.editedClipId);
  if (editedIndex < 0) {
    throw new Error(`Edited clip ${input.editedClipId} not found`);
  }

  const bindings = input.reference
    ? [...input.reference.layer.bindings].sort(
        (a, b) => a.order - b.order || a.referenceStart - b.referenceStart,
      )
    : [];
  const editedBindingIndex = bindings.findIndex((binding) => binding.clipId === input.editedClipId);
  const referenceSuccessor = editedBindingIndex >= 0 ? bindings[editedBindingIndex + 1] : undefined;
  const candidateBoundaryClipIds = [
    ordered[editedIndex],
    referenceSuccessor
      ? ordered.find((clip) => clip.id === referenceSuccessor.clipId)
      : ordered[editedIndex + 1],
  ]
    .filter((clip): clip is NonNullable<typeof clip> => !!clip)
    .filter((clip) => (clip.phase ?? "SHOW") === "SHOW")
    .map((clip) => clip.id);

  const overrides: Record<string, ClipTransitionOverride> = {
    ...(input.transitionOverrides ?? {}),
  };
  const optimizations: Record<string, CandidateTransitionOptimization> = {};
  const clipIds: string[] = [];
  for (const [boundaryIndex, clipId] of candidateBoundaryClipIds.entries()) {
    const plan = buildShowPlan(input.project, {
      assignmentStrategy: input.assignmentStrategy,
      transitionOverrides: overrides,
    });
    if (!isOptimizableClip(input.project, clipId, plan)) continue;
    const clip = input.project.timeline.find((item) => item.id === clipId)!;
    const boundarySourcePositions =
      boundaryIndex === 0 && input.reference
        ? sampleReferenceShow(
            input.reference.show,
            bindings[editedBindingIndex]?.referenceStart ?? clip.start,
          ).map((sample) => sample.position as Vector3Tuple)
        : undefined;
    const boundarySourceVelocities =
      boundaryIndex === 0 && input.reference
        ? input.reference.show.drones.map(
            (drone) =>
              referenceKinematicsAt(
                drone,
                bindings[editedBindingIndex]?.referenceStart ?? clip.start,
                input.reference!.show.timing,
              ).velocity,
          )
        : undefined;
    const boundaryTargetPositions =
      boundaryIndex === 1 && input.reference
        ? sampleReferenceShow(
            input.reference.show,
            referenceSuccessor?.referenceHoldStart ?? clip.start + clip.transition,
          ).map((sample) => sample.position as Vector3Tuple)
        : undefined;
    const boundaryTargetVelocities =
      boundaryIndex === 1 && input.reference
        ? input.reference.show.drones.map(
            (drone) =>
              referenceKinematicsAt(
                drone,
                referenceSuccessor?.referenceHoldStart ?? clip.start + clip.transition,
                input.reference!.show.timing,
              ).velocity,
          )
        : undefined;
    const optimized = optimizeCandidateClipTransition({
      project: input.project,
      clipId,
      assignmentStrategy: input.assignmentStrategy,
      ...(input.sampleRate !== undefined ? { sampleRate: input.sampleRate } : {}),
      transitionOverrides: overrides,
      ...(boundarySourcePositions ? { boundarySourcePositions } : {}),
      ...(boundarySourceVelocities ? { boundarySourceVelocities } : {}),
      ...(boundaryTargetPositions ? { boundaryTargetPositions, lockTargetIdentity: true } : {}),
      ...(boundaryTargetVelocities ? { boundaryTargetVelocities } : {}),
    });
    optimizations[clipId] = optimized;
    overrides[clipId] = optimized.override;
    clipIds.push(clipId);
  }

  return {
    clipIds,
    optimizations,
    overrides: Object.fromEntries(clipIds.map((clipId) => [clipId, overrides[clipId]!])),
  };
}
