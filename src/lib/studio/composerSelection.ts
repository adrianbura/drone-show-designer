/**
 * SCENE COMPOSER SELECTION (pure, editor-only).
 *
 * Selection is the primary authoring mechanism: selecting a VISUAL OBJECT is
 * what colour, lighting and motion commands act on. Physical drone identity is
 * NEVER part of selection — the participation and assignment engines stay the
 * only authority for which drone flies which slot. Highlighted logical slots are
 * always DERIVED from `resolveScene`, never stored.
 *
 * This module composes over the canonical `SceneSelection` helpers instead of
 * introducing a second selection model.
 */
import {
  applySceneClick,
  normalizeSceneSelection,
  selectAllSceneObjects,
  EMPTY_SCENE_SELECTION,
  type SceneSelection,
} from "../show/scene/selection";
import type { FormationScene } from "../show/scene/types";
import type { ResolvedScene } from "../show/scene/types";

export type ComposerSelectionMode = "OBJECT" | "POINT";

export interface ComposerSelection {
  readonly objects: SceneSelection;
  /** Point/subset selection inside the primary object. Empty in OBJECT mode. */
  readonly pointIds: readonly string[];
  readonly mode: ComposerSelectionMode;
}

export const EMPTY_COMPOSER_SELECTION: ComposerSelection = {
  objects: EMPTY_SCENE_SELECTION,
  pointIds: [],
  mode: "OBJECT",
};

/** Plain click: replace the selection and leave point mode. */
export function composerClick(
  scene: FormationScene | null | undefined,
  current: ComposerSelection,
  objectId: string,
): ComposerSelection {
  return {
    objects: applySceneClick(scene, current.objects, objectId, "REPLACE"),
    pointIds: [],
    mode: "OBJECT",
  };
}

/** Shift/Ctrl+click: multi-select objects. Point mode never survives. */
export function composerShiftClick(
  scene: FormationScene | null | undefined,
  current: ComposerSelection,
  objectId: string,
): ComposerSelection {
  return {
    objects: applySceneClick(scene, current.objects, objectId, "TOGGLE"),
    pointIds: [],
    mode: "OBJECT",
  };
}

/** Ctrl+A inside the composer. */
export function composerSelectAll(
  scene: FormationScene | null | undefined,
  current: ComposerSelection,
): ComposerSelection {
  return {
    objects: selectAllSceneObjects(scene, current.objects.primaryId),
    pointIds: [],
    mode: "OBJECT",
  };
}

/** Point/subset selection is only supported for STATIC sources (stable ids). */
export function supportsPointSelection(
  scene: FormationScene | null | undefined,
  objectId: string | null,
): boolean {
  if (!scene || !objectId) return false;
  const object = scene.objects.find((o) => o.id === objectId);
  return !!object && object.source.kind === "STATIC";
}

/** Double-click: enter point mode when the primary object supports it. */
export function composerDoubleClick(
  scene: FormationScene | null | undefined,
  current: ComposerSelection,
  objectId: string,
): ComposerSelection {
  const objects = applySceneClick(scene, current.objects, objectId, "REPLACE");
  if (!supportsPointSelection(scene, objectId)) {
    return { objects, pointIds: [], mode: "OBJECT" };
  }
  return { objects, pointIds: [], mode: "POINT" };
}

export function setComposerPointIds(
  current: ComposerSelection,
  pointIds: readonly string[],
): ComposerSelection {
  if (current.mode !== "POINT") return current;
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of pointIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return { ...current, pointIds: next };
}

/** Reconciles the composer selection against a (possibly restored) scene. */
export function reconcileComposerSelection(
  scene: FormationScene | null | undefined,
  current: ComposerSelection,
): ComposerSelection {
  const objects = normalizeSceneSelection(scene, current.objects.ids, current.objects.primaryId);
  if (objects.ids.length === 0) return EMPTY_COMPOSER_SELECTION;
  const mode: ComposerSelectionMode =
    current.mode === "POINT" && supportsPointSelection(scene, objects.primaryId)
      ? "POINT"
      : "OBJECT";
  return { objects, pointIds: mode === "POINT" ? current.pointIds : [], mode };
}

/**
 * DERIVED highlight: the combined logical slot indices of the selected objects.
 * These are point slots of the resolved scene, NOT physical drone ids.
 */
export function highlightedSlotIndices(
  resolved: ResolvedScene | null | undefined,
  selection: ComposerSelection,
): number[] {
  if (!resolved) return [];
  const wanted = new Set(selection.objects.ids);
  const out: number[] = [];
  for (const group of resolved.groups) {
    if (!wanted.has(group.instanceId)) continue;
    for (let i = 0; i < group.pointCount; i++) out.push(group.offset + i);
  }
  return out;
}
