/**
 * SCENE SELECTION — canonical multi-selection semantics (pure).
 *
 * Selection is EDITOR state: it never touches flight output, never promotes a
 * reference-owned clip and never changes planning. These helpers only keep the
 * invariants honest:
 *   - ids are unique and always belong to the scene they were reconciled against
 *   - the primary object always belongs to a non-empty selection
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { FormationScene } from "./types";

export interface SceneSelection {
  readonly ids: readonly string[];
  readonly primaryId: string | null;
}

export type SceneClickMode = "REPLACE" | "TOGGLE";

export const EMPTY_SCENE_SELECTION: SceneSelection = { ids: [], primaryId: null };

export function allSceneObjectIds(scene: FormationScene | null | undefined): string[] {
  return scene ? scene.objects.map((o) => o.id) : [];
}

/** Normalises any candidate selection: dedupes, drops stale ids, fixes primary. */
export function normalizeSceneSelection(
  scene: FormationScene | null | undefined,
  ids: readonly string[],
  primaryId: string | null,
): SceneSelection {
  const known = new Set(allSceneObjectIds(scene));
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  if (next.length === 0) return EMPTY_SCENE_SELECTION;
  const primary = primaryId && seen.has(primaryId) ? primaryId : next[next.length - 1]!;
  return { ids: next, primaryId: primary };
}

/** Selection after a click, honouring plain (replace) vs Ctrl/Shift (toggle). */
export function applySceneClick(
  scene: FormationScene | null | undefined,
  current: SceneSelection,
  objectId: string,
  mode: SceneClickMode,
): SceneSelection {
  if (mode === "REPLACE") return normalizeSceneSelection(scene, [objectId], objectId);
  const has = current.ids.includes(objectId);
  const ids = has ? current.ids.filter((id) => id !== objectId) : [...current.ids, objectId];
  const primary = has ? (ids.length > 0 ? (ids[ids.length - 1] ?? null) : null) : objectId;
  return normalizeSceneSelection(scene, ids, primary);
}

/** Ctrl+A inside the Scene editor. */
export function selectAllSceneObjects(
  scene: FormationScene | null | undefined,
  primaryId: string | null,
): SceneSelection {
  const ids = allSceneObjectIds(scene);
  return normalizeSceneSelection(scene, ids, primaryId);
}

/** Selection after removing ids (delete gesture). */
export function selectionAfterRemoval(
  scene: FormationScene | null | undefined,
  current: SceneSelection,
  removed: readonly string[],
): SceneSelection {
  const gone = new Set(removed);
  return normalizeSceneSelection(
    scene,
    current.ids.filter((id) => !gone.has(id)),
    current.primaryId && gone.has(current.primaryId) ? null : current.primaryId,
  );
}
