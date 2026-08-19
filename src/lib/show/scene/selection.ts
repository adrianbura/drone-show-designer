/**
 * SCENE MULTI-SELECTION EDITING — pure batch operations for design tooling.
 *
 * This module intentionally edits INSTANCE transforms only. It does not resolve
 * drone identity, re-plan trajectories, mutate library assets or infer semantic
 * grouping. The studio/store remains responsible for committing the returned
 * scene as one authoring transaction.
 *
 * Selection order is canonicalised to scene object order, so the same set of ids
 * always produces the same result regardless of UI selection order.
 */
import type { Vector3Tuple } from "../types";
import { duplicateObject } from "./edit";
import type { FormationScene, SceneFormationInstance } from "./types";

export interface SceneSelectionDuplicateResult {
  readonly scene: FormationScene;
  readonly objectIds: readonly string[];
}

export interface SceneSelectionState {
  /** Canonical scene-order selection. */
  readonly objectIds: readonly string[];
  /** The object whose absolute controls / reference metrics are shown. */
  readonly primaryObjectId: string | null;
}

/** Existing selected ids, unique and ordered exactly like scene.objects. */
export function canonicalSceneSelection(
  scene: FormationScene,
  objectIds: readonly string[],
): string[] {
  if (objectIds.length === 0 || scene.objects.length === 0) return [];
  const wanted = new Set(objectIds);
  return scene.objects.filter((object) => wanted.has(object.id)).map((object) => object.id);
}

/**
 * Reconciles editor selection after clip/object changes.
 * The primary must always belong to the selection; otherwise the first selected
 * object becomes primary. An empty selection always has a null primary.
 */
export function reconcileSceneSelection(
  scene: FormationScene,
  state: SceneSelectionState,
): SceneSelectionState {
  const objectIds = canonicalSceneSelection(scene, state.objectIds);
  if (objectIds.length === 0) return { objectIds: [], primaryObjectId: null };
  return {
    objectIds,
    primaryObjectId:
      state.primaryObjectId && objectIds.includes(state.primaryObjectId)
        ? state.primaryObjectId
        : objectIds[0]!,
  };
}

/** Plain click: replace the selection with exactly one object. */
export function replaceSceneSelection(
  scene: FormationScene,
  objectId: string | null,
): SceneSelectionState {
  if (!objectId || !scene.objects.some((object) => object.id === objectId)) {
    return { objectIds: [], primaryObjectId: null };
  }
  return { objectIds: [objectId], primaryObjectId: objectId };
}

/**
 * Ctrl/Shift click semantics: toggle membership without ever leaving a stale
 * primary. Toggling an object ON makes it primary; toggling the primary OFF
 * falls back deterministically to the first remaining scene-order object.
 */
export function toggleSceneSelection(
  scene: FormationScene,
  state: SceneSelectionState,
  objectId: string,
): SceneSelectionState {
  if (!scene.objects.some((object) => object.id === objectId)) {
    return reconcileSceneSelection(scene, state);
  }
  const current = new Set(canonicalSceneSelection(scene, state.objectIds));
  if (current.has(objectId)) current.delete(objectId);
  else current.add(objectId);
  const objectIds = canonicalSceneSelection(scene, [...current]);
  if (objectIds.length === 0) return { objectIds: [], primaryObjectId: null };
  if (current.has(objectId)) return { objectIds, primaryObjectId: objectId };
  return {
    objectIds,
    primaryObjectId:
      state.primaryObjectId && objectIds.includes(state.primaryObjectId)
        ? state.primaryObjectId
        : objectIds[0]!,
  };
}

/** Ctrl+A while the Scene editor is focused. */
export function selectAllSceneObjects(scene: FormationScene): SceneSelectionState {
  const objectIds = scene.objects.map((object) => object.id);
  return { objectIds, primaryObjectId: objectIds[0] ?? null };
}

/**
 * Applies one immutable object transform to every selected instance.
 * Unknown ids are ignored. Unselected objects retain referential identity.
 */
export function mapSelectedSceneObjects(
  scene: FormationScene,
  objectIds: readonly string[],
  edit: (object: SceneFormationInstance) => SceneFormationInstance,
): FormationScene {
  const selected = new Set(canonicalSceneSelection(scene, objectIds));
  if (selected.size === 0) return scene;
  let changed = false;
  const objects = scene.objects.map((object) => {
    if (!selected.has(object.id)) return object;
    const next = edit(object);
    if (next !== object) changed = true;
    return next;
  });
  return changed ? { ...scene, objects } : scene;
}

/** Translate every selected object by the same show-local delta. */
export function translateSceneSelection(
  scene: FormationScene,
  objectIds: readonly string[],
  delta: Vector3Tuple,
): FormationScene {
  if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return scene;
  return mapSelectedSceneObjects(scene, objectIds, (object) => ({
    ...object,
    transform: {
      ...object.transform,
      position: [
        object.transform.position[0] + delta[0],
        object.transform.position[1] + delta[1],
        object.transform.position[2] + delta[2],
      ],
    },
  }));
}

/** Add the same local Euler rotation delta to every selected object. */
export function rotateSceneSelection(
  scene: FormationScene,
  objectIds: readonly string[],
  deltaDeg: Vector3Tuple,
): FormationScene {
  if (deltaDeg[0] === 0 && deltaDeg[1] === 0 && deltaDeg[2] === 0) return scene;
  return mapSelectedSceneObjects(scene, objectIds, (object) => ({
    ...object,
    transform: {
      ...object.transform,
      rotationDeg: [
        object.transform.rotationDeg[0] + deltaDeg[0],
        object.transform.rotationDeg[1] + deltaDeg[1],
        object.transform.rotationDeg[2] + deltaDeg[2],
      ],
    },
  }));
}

/**
 * Multiplies each selected object's own uniform scale.
 * This does NOT move object centres; group-layout scaling is a separate operation.
 */
export function scaleSceneSelection(
  scene: FormationScene,
  objectIds: readonly string[],
  factor: number,
  minimumScale = 0.05,
): FormationScene {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return scene;
  const floor = Math.max(1e-6, minimumScale);
  return mapSelectedSceneObjects(scene, objectIds, (object) => ({
    ...object,
    transform: {
      ...object.transform,
      scale: Math.max(floor, object.transform.scale * factor),
    },
  }));
}

/** Toggle local X mirroring on every selected object. */
export function mirrorSceneSelectionX(
  scene: FormationScene,
  objectIds: readonly string[],
): FormationScene {
  return mapSelectedSceneObjects(scene, objectIds, (object) => ({
    ...object,
    transform: { ...object.transform, mirrorX: !object.transform.mirrorX },
  }));
}

/**
 * Duplicate the selected objects as new instances, preserving canonical scene
 * order and returning the fresh ids. Library/source payloads are never copied.
 */
export function duplicateSceneSelection(
  scene: FormationScene,
  objectIds: readonly string[],
  offset: Vector3Tuple = [0, 0, 0],
): SceneSelectionDuplicateResult {
  const selected = canonicalSceneSelection(scene, objectIds);
  if (selected.length === 0) return { scene, objectIds: [] };

  let next = scene;
  const created: string[] = [];
  for (const objectId of selected) {
    const result = duplicateObject(next, objectId, offset);
    next = result.scene;
    if (result.objectId !== objectId) created.push(result.objectId);
  }
  return { scene: next, objectIds: created };
}
