/**
 * GROUP-LAYOUT SCENE TRANSFORMS — pure, deterministic batch editing.
 *
 * These helpers are the ONLY authority for multi-object scene gestures. They
 * differ from the per-object helpers in `edit.ts`: a group rotate/scale moves the
 * LAYOUT of the selected objects around a shared pivot AND updates each
 * instance's own orientation / uniform scale, so a viewport gizmo behaves like a
 * professional editor instead of scaling every object in place.
 *
 * Artistic composition only: nothing here knows about physical drones, planning,
 * ownership or export.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import { quatFromEulerDeg, rotateByQuat } from "../dynamic/math";
import type { ShowProject, Vector3Tuple } from "../types";
import { nextObjectId, nextObjectName } from "./edit";
import {
  applyInstanceTransform,
  findDynamicSource,
  findStaticSource,
  geometricCentre,
  instancePivot,
} from "./resolve";
import type { FormationScene, SceneFormationInstance } from "./types";

/** Viewport gizmo mode (Windows-first shortcuts: W / E / R). */
export type SceneGizmoMode = "MOVE" | "ROTATE" | "SCALE";

export interface SceneGroupDelta {
  /** World-space translation added to every selected object. */
  readonly position?: Vector3Tuple;
  /** Euler XYZ degrees added to every selected object, layout rotated too. */
  readonly rotationDeg?: Vector3Tuple;
  /** Multiplier on each object's uniform scale, layout scaled too. */
  readonly scaleFactor?: number;
}

const ZERO: Vector3Tuple = [0, 0, 0];

/** Asset-local base points of one instance (never mutates the asset). */
export function objectBasePoints(
  project: ShowProject,
  object: SceneFormationInstance,
): readonly Vector3Tuple[] {
  if (object.source.kind === "STATIC") {
    return findStaticSource(project, object.source.formationId)?.points ?? [];
  }
  return findDynamicSource(project, object.source.dynamicFormationId)?.points.map((p) => p.base) ?? [];
}

/**
 * Scene-local centre of one instance. `applyInstanceTransform` is affine, so the
 * transform of the mean equals the mean of the transformed points — the centre
 * is exact, never sampled.
 */
export function objectCentre(project: ShowProject, object: SceneFormationInstance): Vector3Tuple {
  const base = objectBasePoints(project, object);
  const pivot = instancePivot(object.transform, base);
  return applyInstanceTransform(geometricCentre(base), object.transform, pivot);
}

/** Deterministic group pivot: component-wise mean of selected object centres. */
export function sceneGroupPivot(
  project: ShowProject,
  scene: FormationScene,
  objectIds: readonly string[],
): Vector3Tuple {
  const wanted = new Set(objectIds);
  const centres = scene.objects.filter((o) => wanted.has(o.id)).map((o) => objectCentre(project, o));
  return geometricCentre(centres);
}

function addVec(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mapSelected(
  scene: FormationScene,
  objectIds: readonly string[],
  fn: (object: SceneFormationInstance) => SceneFormationInstance,
): FormationScene {
  const wanted = new Set(objectIds);
  if (wanted.size === 0) return scene;
  return { ...scene, objects: scene.objects.map((o) => (wanted.has(o.id) ? fn(o) : o)) };
}

/** Same world delta for every selected object; relative spacing is preserved. */
export function translateSceneObjects(
  scene: FormationScene,
  objectIds: readonly string[],
  delta: Vector3Tuple,
): FormationScene {
  if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return scene;
  return mapSelected(scene, objectIds, (o) => ({
    ...o,
    transform: { ...o.transform, position: addVec(o.transform.position, delta) },
  }));
}

/**
 * Rotates the GROUP LAYOUT around `pivot` and rotates each selected instance's
 * own orientation by the same Euler delta. Pairwise distances are preserved.
 */
export function rotateSceneObjects(
  project: ShowProject,
  scene: FormationScene,
  objectIds: readonly string[],
  deltaDeg: Vector3Tuple,
  pivot?: Vector3Tuple,
): FormationScene {
  if (deltaDeg[0] === 0 && deltaDeg[1] === 0 && deltaDeg[2] === 0) return scene;
  const centre = pivot ?? sceneGroupPivot(project, scene, objectIds);
  const quat = quatFromEulerDeg(deltaDeg);
  return mapSelected(scene, objectIds, (o) => {
    const before = objectCentre(project, o);
    const target = addVec(centre, rotateByQuat(subVec(before, centre), quat));
    const rotated: SceneFormationInstance = {
      ...o,
      transform: {
        ...o.transform,
        rotationDeg: [
          o.transform.rotationDeg[0] + deltaDeg[0],
          o.transform.rotationDeg[1] + deltaDeg[1],
          o.transform.rotationDeg[2] + deltaDeg[2],
        ],
      },
    };
    // Compensate the centre drift introduced by the orientation change so the
    // object lands exactly on the rotated layout position.
    const after = objectCentre(project, rotated);
    return {
      ...rotated,
      transform: {
        ...rotated.transform,
        position: addVec(rotated.transform.position, subVec(target, after)),
      },
    };
  });
}

/**
 * Scales the GROUP LAYOUT around `pivot` and multiplies each selected object's
 * uniform scale by the same factor.
 */
export function scaleSceneObjects(
  project: ShowProject,
  scene: FormationScene,
  objectIds: readonly string[],
  factor: number,
  pivot?: Vector3Tuple,
): FormationScene {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  if (f === 1) return scene;
  const centre = pivot ?? sceneGroupPivot(project, scene, objectIds);
  return mapSelected(scene, objectIds, (o) => {
    const before = objectCentre(project, o);
    const target: Vector3Tuple = [
      centre[0] + (before[0] - centre[0]) * f,
      centre[1] + (before[1] - centre[1]) * f,
      centre[2] + (before[2] - centre[2]) * f,
    ];
    const scaled: SceneFormationInstance = {
      ...o,
      transform: { ...o.transform, scale: Math.max(0.01, o.transform.scale * f) },
    };
    const after = objectCentre(project, scaled);
    return {
      ...scaled,
      transform: {
        ...scaled.transform,
        position: addVec(scaled.transform.position, subVec(target, after)),
      },
    };
  });
}

/** Toggles the local X mirror of every selected object. */
export function mirrorSceneObjects(
  scene: FormationScene,
  objectIds: readonly string[],
): FormationScene {
  return mapSelected(scene, objectIds, (o) => ({
    ...o,
    transform: { ...o.transform, mirrorX: !o.transform.mirrorX },
  }));
}

/** ONE canonical batch gesture: translate, then rotate, then scale the group. */
export function applySceneGroupDelta(
  project: ShowProject,
  scene: FormationScene,
  objectIds: readonly string[],
  delta: SceneGroupDelta,
  pivot?: Vector3Tuple,
): FormationScene {
  const centre = pivot ?? sceneGroupPivot(project, scene, objectIds);
  let next = translateSceneObjects(scene, objectIds, delta.position ?? ZERO);
  if (delta.rotationDeg) {
    next = rotateSceneObjects(
      project,
      next,
      objectIds,
      delta.rotationDeg,
      addVec(centre, delta.position ?? ZERO),
    );
  }
  if (delta.scaleFactor && delta.scaleFactor !== 1) {
    next = scaleSceneObjects(
      project,
      next,
      objectIds,
      delta.scaleFactor,
      addVec(centre, delta.position ?? ZERO),
    );
  }
  return next;
}

/** Deterministic duplicate of every selected object; returns the new ids. */
export function duplicateSceneObjects(
  scene: FormationScene,
  objectIds: readonly string[],
  offset: Vector3Tuple = ZERO,
): { readonly scene: FormationScene; readonly objectIds: readonly string[] } {
  const wanted = scene.objects.filter((o) => objectIds.includes(o.id));
  let next = scene;
  const created: string[] = [];
  for (const source of wanted) {
    const id = nextObjectId(next);
    const copy: SceneFormationInstance = {
      ...source,
      id,
      name: nextObjectName(next, source.name),
      transform: { ...source.transform, position: addVec(source.transform.position, offset) },
    };
    next = { ...next, objects: [...next.objects, copy] };
    created.push(id);
  }
  return { scene: next, objectIds: created };
}

/** Removes every selected object at once (one mutation, one undo entry). */
export function removeSceneObjects(
  scene: FormationScene,
  objectIds: readonly string[],
): FormationScene {
  const gone = new Set(objectIds);
  const objects = scene.objects.filter((o) => !gone.has(o.id));
  // A scene always keeps at least one object: the timeline clip needs geometry.
  if (objects.length === 0) return scene;
  return { ...scene, objects };
}

export interface MixedTransformFlags {
  readonly position: boolean;
  readonly rotationDeg: boolean;
  readonly scale: boolean;
  readonly mirrorX: boolean;
}

/** True per field when the selected objects do NOT share the same value. */
export function mixedTransformFlags(
  scene: FormationScene,
  objectIds: readonly string[],
): MixedTransformFlags {
  const wanted = new Set(objectIds);
  const list = scene.objects.filter((o) => wanted.has(o.id));
  const first = list[0];
  if (!first || list.length < 2) {
    return { position: false, rotationDeg: false, scale: false, mirrorX: false };
  }
  const same = (a: Vector3Tuple, b: Vector3Tuple) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  return {
    position: list.some((o) => !same(o.transform.position, first.transform.position)),
    rotationDeg: list.some((o) => !same(o.transform.rotationDeg, first.transform.rotationDeg)),
    scale: list.some((o) => o.transform.scale !== first.transform.scale),
    mirrorX: list.some((o) => !!o.transform.mirrorX !== !!first.transform.mirrorX),
  };
}

/** Snaps a world delta to an increment (0 = free movement). */
export function snapDelta(delta: Vector3Tuple, increment: number): Vector3Tuple {
  if (!increment || increment <= 0) return delta;
  return [
    Math.round(delta[0] / increment) * increment,
    Math.round(delta[1] / increment) * increment,
    Math.round(delta[2] / increment) * increment,
  ];
}

/** Snaps a degree value to an increment (0 = free rotation). */
export function snapDegrees(value: number, increment: number): number {
  if (!increment || increment <= 0) return value;
  return Math.round(value / increment) * increment;
}
