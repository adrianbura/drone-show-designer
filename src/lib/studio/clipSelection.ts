/**
 * CLIP SELECTION LIFECYCLE (pure).
 *
 * Switching the selected clip is EDITOR STATE ONLY: it never mutates project
 * content, never pushes history and never promotes reference ownership. What it
 * must do is reconcile every clip-scoped editor selection, so nothing from the
 * previous clip can resurrect when the operator comes back to it later.
 *
 * The same reconciliation is reused after clip deletion and after undo/redo, so
 * there is exactly one reconciliation authority in the studio.
 */
import type { ShowProject } from "../show/types";
import { EMPTY_SCENE_SELECTION, sceneForClip, type SceneSelection } from "../show/scene";
import { normalizeSceneSelection } from "../show/scene";

export interface EditorClipSelectionState {
  /** Scene object multi-selection (ids + primary). */
  readonly sceneSelection: SceneSelection;
  /** Currently inspected lighting effect, if any. */
  readonly selectedLightingEffectId: string | null;
  /** Explicit dynamic-formation selection (independent of the clip binding). */
  readonly explicitDynamicId: string | null;
  /** Dynamic editor point selection. */
  readonly selectedPointIds: readonly string[];
  /** Dynamic editor motion-group selection. */
  readonly selectedMotionGroupId: string | null;
  /** Whether a transient viewport gizmo draft is active. */
  readonly gizmoDraftActive: boolean;
}

export const EMPTY_EDITOR_CLIP_SELECTION: EditorClipSelectionState = {
  sceneSelection: EMPTY_SCENE_SELECTION,
  selectedLightingEffectId: null,
  explicitDynamicId: null,
  selectedPointIds: [],
  selectedMotionGroupId: null,
  gizmoDraftActive: false,
};

/**
 * Reconciles editor selection for a clip change.
 *
 * `previousClipId` distinguishes a real clip switch (drop clip-derived dynamic
 * selection) from a same-clip reconciliation after undo/redo (keep what still
 * resolves).
 */
export function reconcileEditorSelection(
  project: ShowProject,
  nextClipId: string | null,
  current: EditorClipSelectionState,
  previousClipId: string | null = null,
): EditorClipSelectionState {
  const clip = nextClipId ? (project.timeline.find((c) => c.id === nextClipId) ?? null) : null;
  const previousClip = previousClipId
    ? (project.timeline.find((c) => c.id === previousClipId) ?? null)
    : null;
  const clipChanged = (previousClipId ?? null) !== (nextClipId ?? null);
  const scene = clip ? sceneForClip(project, clip) : null;

  // Scene selection: explicitly cleared on a real clip switch (no resurrection),
  // otherwise reconciled against the restored scene (no stale ids).
  const sceneSelection = clipChanged
    ? EMPTY_SCENE_SELECTION
    : normalizeSceneSelection(scene, current.sceneSelection.ids, current.sceneSelection.primaryId);

  // Lighting: keep only an effect that still exists AND targets the selected clip.
  const lightingEffect = (project.lighting?.effects ?? []).find(
    (e) => e.id === current.selectedLightingEffectId,
  );
  const selectedLightingEffectId =
    lightingEffect && nextClipId && lightingEffect.target.clipId === nextClipId
      ? lightingEffect.id
      : null;

  // Dynamic formation: a clip binding always wins; a clip-derived explicit
  // selection from the previous clip is dropped, standalone editing survives.
  const dynamicList = project.dynamicFormations ?? [];
  let explicitDynamicId: string | null = null;
  if (clip?.dynamicFormationId && dynamicList.some((d) => d.id === clip.dynamicFormationId)) {
    explicitDynamicId = clip.dynamicFormationId;
  } else if (
    current.explicitDynamicId &&
    dynamicList.some((d) => d.id === current.explicitDynamicId) &&
    !(clipChanged && previousClip?.dynamicFormationId === current.explicitDynamicId)
  ) {
    explicitDynamicId = current.explicitDynamicId;
  }

  const dynamicResolved = explicitDynamicId
    ? (dynamicList.find((d) => d.id === explicitDynamicId) ?? null)
    : null;
  const keepDynamicSubSelection = !clipChanged && dynamicResolved !== null;
  const pointIds = keepDynamicSubSelection
    ? current.selectedPointIds.filter((id) =>
        dynamicResolved!.points.some((p) => p.id === id),
      )
    : [];
  const motionGroupId =
    keepDynamicSubSelection &&
    current.selectedMotionGroupId &&
    dynamicResolved!.groups.some((g) => g.id === current.selectedMotionGroupId)
      ? current.selectedMotionGroupId
      : null;

  return {
    sceneSelection,
    selectedLightingEffectId,
    explicitDynamicId,
    selectedPointIds: pointIds,
    selectedMotionGroupId: motionGroupId,
    // A gizmo draft is transient by contract: never carried across a clip
    // change or a history restore.
    gizmoDraftActive: false,
  };
}
