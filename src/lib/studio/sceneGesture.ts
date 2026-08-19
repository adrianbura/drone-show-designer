import type { ShowProject } from "../show/types";
import type { FormationScene } from "../show/scene";
import type { TimelineHistorySnapshot } from "./planningIntegrity";
import type { ClipTransitionOverride } from "../show/trajectory";

/**
 * One in-progress Scene gizmo gesture.
 *
 * The starting canonical snapshot is captured exactly once on pointer-down.
 * Pointer-move previews may replace `previewProject` freely without producing
 * history entries. Pointer-up commits the final preview against `before` as one
 * undoable authoring transaction; Escape restores `before` byte-for-byte.
 */
export interface SceneGestureTransaction {
  readonly clipId: string;
  readonly objectIds: readonly string[];
  readonly before: TimelineHistorySnapshot;
  readonly previewProject: ShowProject;
}

export function beginSceneGesture(args: {
  readonly clipId: string;
  readonly objectIds: readonly string[];
  readonly project: ShowProject;
  readonly transitionOverrides: Readonly<Record<string, ClipTransitionOverride>>;
}): SceneGestureTransaction {
  return {
    clipId: args.clipId,
    objectIds: [...args.objectIds],
    before: {
      project: args.project,
      transitionOverrides: args.transitionOverrides,
    },
    previewProject: args.project,
  };
}

/** Replace only the transient preview. No history semantics live here. */
export function previewSceneGesture(
  transaction: SceneGestureTransaction,
  project: ShowProject,
): SceneGestureTransaction {
  if (project === transaction.previewProject) return transaction;
  return { ...transaction, previewProject: project };
}

/**
 * Cancel is exact: restore the canonical project and overrides captured before
 * the gesture. The caller must not push a history entry for this path.
 */
export function cancelSceneGesture(transaction: SceneGestureTransaction): TimelineHistorySnapshot {
  return transaction.before;
}

export interface SceneGestureCommit {
  /** Snapshot to push exactly once onto the undo stack. */
  readonly undoSnapshot: TimelineHistorySnapshot;
  /** Final preview project to adopt as canonical authoring state. */
  readonly project: ShowProject;
  /** True only when the gesture changed canonical project identity. */
  readonly changed: boolean;
}

/**
 * Finalises one pointer gesture. The caller pushes `undoSnapshot` iff changed.
 * Override pruning / ESSP semantic promotion remain store responsibilities and
 * therefore run once after adopting this final project, never per pointer-move.
 */
export function commitSceneGesture(transaction: SceneGestureTransaction): SceneGestureCommit {
  return {
    undoSnapshot: transaction.before,
    project: transaction.previewProject,
    changed: transaction.previewProject !== transaction.before.project,
  };
}

/** Convenience guard for store/UI code. */
export function sceneGestureTargets(
  transaction: SceneGestureTransaction,
  scene: FormationScene | null,
): readonly string[] {
  if (!scene || scene.id !== transaction.clipId) return [];
  const valid = new Set(scene.objects.map((object) => object.id));
  return transaction.objectIds.filter((id) => valid.has(id));
}
