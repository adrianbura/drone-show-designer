/**
 * CANONICAL PROJECT PERSISTENCE OPTIONS.
 *
 * Every persistence writer (manual save, autosave, recovery snapshots) must
 * serialize the same planning/reference/editor authority. Keeping this mapping
 * pure prevents semantic drift where one writer silently drops authoring intent
 * such as transition designs while another preserves it.
 */
import type { ReferenceTrajectoryLayer } from "../import/essp/native";
import type { ProjectEditorPreferences, ProjectPlanningState } from "../project";
import type { AssignmentStrategyId } from "../show/assignment";
import type { TransitionDesignState } from "../show/transition";
import type { ClipTransitionOverride } from "../show/trajectory";

export interface ProjectPersistenceState {
  assignmentStrategy: AssignmentStrategyId;
  transitionOverrides: Record<string, ClipTransitionOverride>;
  transitionDesigns: Record<string, TransitionDesignState>;
  referenceLayer: ReferenceTrajectoryLayer | null;
  selectedClipId: string | null;
  sampleRate: number;
}

export interface ProjectPersistenceOptions {
  planning: ProjectPlanningState;
  referenceLayer: ReferenceTrajectoryLayer | null;
  editor: ProjectEditorPreferences;
}

/** Single mapping used by every project-envelope writer. */
export function projectPersistenceOptions(
  state: ProjectPersistenceState,
): ProjectPersistenceOptions {
  return {
    planning: {
      assignmentStrategy: state.assignmentStrategy,
      transitionOverrides: { ...state.transitionOverrides },
      transitionDesigns: { ...state.transitionDesigns },
    },
    referenceLayer: state.referenceLayer,
    editor: {
      selectedClipId: state.selectedClipId,
      sampleRate: state.sampleRate,
    },
  };
}
