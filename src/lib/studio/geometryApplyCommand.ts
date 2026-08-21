import { reconcileReferenceLayer, type ReferenceTrajectoryLayer } from "../import/essp/native";
import type { GeometryApplyReadinessReport } from "../show/diagnostics/geometryApplyReadiness";
import type { AssignmentStrategyId } from "../show/assignment";
import type { ShowProject } from "../show/types";
import type { ClipTransitionOverride } from "../show/trajectory";
import type { TransitionDesignState } from "../show/transition";
import {
  computeOverrideBasis,
  pruneTransitionOverrides,
  type TimelineHistorySnapshot,
} from "./planningIntegrity";

/**
 * PURE PREPARATION OF A FUTURE GEOMETRY APPLY COMMAND.
 *
 * This module does not write React/store state. It prepares the complete atomic
 * before/after snapshots that the store must commit as ONE undoable authoring
 * revision once the UI Apply action is enabled.
 *
 * Canonical side effects represented here:
 * - project geometry replacement/materialisation
 * - transition-override invalidation caused by changed geometry
 * - imported ESSP ownership reconciliation/promotion
 *
 * Transient diagnostics/validation reports are deliberately excluded; they are
 * stale after the commit and must be recomputed.
 */

export type GeometryApplyPreparationBlocker =
  | "READINESS_BLOCKED"
  | "PROJECT_ID_MISMATCH"
  | "PROJECT_IDENTITY_UNCHANGED";

export interface GeometryApplyPreparationInput {
  readonly beforeProject: ShowProject;
  readonly afterProject: ShowProject;
  readonly readiness: GeometryApplyReadinessReport;
  readonly transitionOverrides: Readonly<Record<string, ClipTransitionOverride>>;
  readonly transitionDesigns?: Readonly<Record<string, TransitionDesignState>>;
  readonly referenceLayer?: ReferenceTrajectoryLayer | null;
  readonly assignmentStrategy: AssignmentStrategyId;
  /** Stable timestamp supplied by the command boundary, never generated here. */
  readonly promotedAt: string;
}

export interface GeometryApplyPreparationSuccess {
  readonly ok: true;
  readonly before: TimelineHistorySnapshot;
  readonly after: TimelineHistorySnapshot;
  readonly invalidatedTransitionOverrideClipIds: readonly string[];
  readonly promotedReferenceClipIds: readonly string[];
  readonly note: string;
}

export interface GeometryApplyPreparationFailure {
  readonly ok: false;
  readonly blocker: GeometryApplyPreparationBlocker;
  readonly note: string;
}

export type GeometryApplyPreparationResult =
  | GeometryApplyPreparationSuccess
  | GeometryApplyPreparationFailure;

function snapshot(
  project: ShowProject,
  transitionOverrides: Readonly<Record<string, ClipTransitionOverride>>,
  transitionDesigns: Readonly<Record<string, TransitionDesignState>> | undefined,
  referenceLayer: ReferenceTrajectoryLayer | null | undefined,
): TimelineHistorySnapshot {
  return {
    project,
    transitionOverrides,
    ...(transitionDesigns ? { transitionDesigns } : {}),
    referenceLayer: referenceLayer ?? null,
  };
}

function newlyPromotedClipIds(
  before: ReferenceTrajectoryLayer,
  after: ReferenceTrajectoryLayer,
): string[] {
  const beforeOwners = new Map(before.intervals.map((interval) => [interval.clipId, interval.owner] as const));
  const promoted = new Set<string>();
  for (const interval of after.intervals) {
    if (interval.owner === "PLANNER" && beforeOwners.get(interval.clipId) === "REFERENCE") {
      promoted.add(interval.clipId);
    }
  }
  return [...promoted].sort();
}

/**
 * Prepares ONE atomic authoring revision. The caller must push `before` to the
 * existing history and install `after.project`, `after.transitionOverrides` and
 * `after.referenceLayer` together. Any partial commit would violate undo/redo
 * and imported-source ownership semantics.
 */
export function prepareGeometryApplyCommand(
  input: GeometryApplyPreparationInput,
): GeometryApplyPreparationResult {
  if (!input.readiness.canApply || input.readiness.status === "BLOCKED") {
    return {
      ok: false,
      blocker: "READINESS_BLOCKED",
      note: input.readiness.blockers.join(" ") || "Geometry apply readiness is blocked.",
    };
  }
  if (input.beforeProject.id !== input.afterProject.id) {
    return {
      ok: false,
      blocker: "PROJECT_ID_MISMATCH",
      note: "A geometry proposal may edit the open project but may not replace its project identity.",
    };
  }
  if (input.beforeProject === input.afterProject) {
    return {
      ok: false,
      blocker: "PROJECT_IDENTITY_UNCHANGED",
      note: "The proposed project is the same object as the current project; there is no prepared authoring revision.",
    };
  }

  const beforeBasis = computeOverrideBasis(input.beforeProject, input.transitionOverrides);
  const pruned = pruneTransitionOverrides(input.afterProject, input.transitionOverrides, beforeBasis);

  let nextLayer = input.referenceLayer ?? null;
  let promotedReferenceClipIds: string[] = [];
  if (input.referenceLayer) {
    const reconciled = reconcileReferenceLayer(
      input.afterProject,
      input.referenceLayer,
      {
        assignmentStrategy: input.assignmentStrategy,
        transitionOverrides: pruned.overrides,
      },
      input.promotedAt,
    );
    nextLayer = reconciled.layer;
    promotedReferenceClipIds = newlyPromotedClipIds(input.referenceLayer, reconciled.layer);
  }

  return {
    ok: true,
    before: snapshot(
      input.beforeProject,
      input.transitionOverrides,
      input.transitionDesigns,
      input.referenceLayer,
    ),
    after: snapshot(
      input.afterProject,
      pruned.overrides,
      input.transitionDesigns,
      nextLayer,
    ),
    invalidatedTransitionOverrideClipIds: [...pruned.invalidated],
    promotedReferenceClipIds,
    note:
      "PREPARED ATOMIC AUTHORING REVISION. Store integration must commit project geometry, pruned transition overrides and reconciled imported ownership together as one undoable history entry; validation evidence becomes stale and must be recomputed.",
  };
}
