/**
 * SCENE DESIGN ACTIONS — fast, deterministic composition edits (pure).
 *
 * These are the ONE-CLICK design tools the Scene panel exposes. They are built
 * exclusively on the existing batch primitives in `group.ts`, so a design action
 * and a viewport gizmo gesture always produce the SAME kind of instance-transform
 * result. Nothing here knows about physical drones, planning, assignment,
 * ownership or export: they edit artistic instance transforms only.
 *
 * SEMANTICS
 *   CENTER        moves the SELECTION AS A GROUP so its combined centre sits on
 *                 the show origin in X/Z; relative spacing and altitude are kept.
 *   ORIGIN_XZ     moves EACH selected object individually onto X=0/Z=0, keeping
 *                 its own altitude (useful to stack objects before composing).
 *   RAISE/LOWER   ±`delta` metres on Y for every selected object.
 *   ROTATE_90     +90° around Y for the group layout and each instance.
 *   MIRROR_X      toggles the instance X mirror.
 *   MIRROR_Z      Z mirror expressed EXACTLY in the supported transform algebra:
 *                 mirror(Z) = rotateY(180°) ∘ mirror(X). No new transform field
 *                 is invented, so persistence and resolution stay unchanged.
 *   SCALE_HALF/DOUBLE  ×0.5 / ×2 around the group pivot.
 *   RESET_TRANSFORM     back to the identity instance transform (exact).
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { ShowProject, Vector3Tuple } from "../types";
import {
  mirrorSceneObjects,
  objectCentre,
  rotateSceneObjects,
  scaleSceneObjects,
  sceneGroupPivot,
  translateSceneObjects,
} from "./group";
import { IDENTITY_INSTANCE_TRANSFORM, type FormationScene } from "./types";

export type SceneDesignActionKind =
  | "CENTER"
  | "ORIGIN_XZ"
  | "RAISE"
  | "LOWER"
  | "ROTATE_90"
  | "MIRROR_X"
  | "MIRROR_Z"
  | "SCALE_HALF"
  | "SCALE_DOUBLE"
  | "RESET_TRANSFORM";

/** Default vertical step of RAISE / LOWER in metres. */
export const DESIGN_ALTITUDE_STEP = 5;

function selected(scene: FormationScene, objectIds: readonly string[]) {
  const wanted = new Set(objectIds);
  return scene.objects.filter((o) => wanted.has(o.id));
}

/**
 * ONE design action = ONE new scene. The caller commits it as a single project
 * mutation, so it is also exactly one undo entry.
 */
export function applySceneDesignAction(
  project: ShowProject,
  scene: FormationScene,
  objectIds: readonly string[],
  action: SceneDesignActionKind,
  options: { readonly altitudeStep?: number } = {},
): FormationScene {
  const objects = selected(scene, objectIds);
  if (objects.length === 0) return scene;
  const ids = objects.map((o) => o.id);
  const step =
    options.altitudeStep !== undefined && Number.isFinite(options.altitudeStep)
      ? Math.abs(options.altitudeStep)
      : DESIGN_ALTITUDE_STEP;

  switch (action) {
    case "CENTER": {
      const pivot = sceneGroupPivot(project, scene, ids);
      return translateSceneObjects(scene, ids, [-pivot[0], 0, -pivot[2]]);
    }
    case "ORIGIN_XZ": {
      // Per object, so each one lands exactly on the origin column.
      let next = scene;
      for (const object of objects) {
        const centre = objectCentre(project, object);
        next = translateSceneObjects(next, [object.id], [-centre[0], 0, -centre[2]]);
      }
      return next;
    }
    case "RAISE":
      return translateSceneObjects(scene, ids, [0, step, 0]);
    case "LOWER":
      return translateSceneObjects(scene, ids, [0, -step, 0]);
    case "ROTATE_90":
      return rotateSceneObjects(project, scene, ids, [0, 90, 0]);
    case "MIRROR_X":
      return mirrorSceneObjects(scene, ids);
    case "MIRROR_Z":
      return rotateSceneObjects(project, mirrorSceneObjects(scene, ids), ids, [0, 180, 0]);
    case "SCALE_HALF":
      return scaleSceneObjects(project, scene, ids, 0.5);
    case "SCALE_DOUBLE":
      return scaleSceneObjects(project, scene, ids, 2);
    case "RESET_TRANSFORM": {
      const wanted = new Set(ids);
      return {
        ...scene,
        objects: scene.objects.map((o) =>
          wanted.has(o.id) ? { ...o, transform: { ...IDENTITY_INSTANCE_TRANSFORM } } : o,
        ),
      };
    }
    default:
      return scene;
  }
}

export type SceneAlignMode =
  | "ALIGN_MIN_X"
  | "ALIGN_MAX_X"
  | "ALIGN_CENTER_X"
  | "ALIGN_MIN_Z"
  | "ALIGN_MAX_Z"
  | "ALIGN_CENTER_Z"
  | "MATCH_ALTITUDE"
  | "DISTRIBUTE_X"
  | "DISTRIBUTE_Z";

const AXIS_OF: Record<SceneAlignMode, 0 | 1 | 2> = {
  ALIGN_MIN_X: 0,
  ALIGN_MAX_X: 0,
  ALIGN_CENTER_X: 0,
  ALIGN_MIN_Z: 2,
  ALIGN_MAX_Z: 2,
  ALIGN_CENTER_Z: 2,
  MATCH_ALTITUDE: 1,
  DISTRIBUTE_X: 0,
  DISTRIBUTE_Z: 2,
};

/**
 * ALIGNMENT / DISTRIBUTION on deterministic WORLD-SPACE object centres.
 *
 * Object membership is never changed: only the translation of already-selected
 * objects moves, and the result is stable for identical input (ties break on the
 * scene object order, never on iteration order of a map).
 */
export function alignSceneObjectsBy(
  project: ShowProject,
  scene: FormationScene,
  objectIds: readonly string[],
  mode: SceneAlignMode,
): FormationScene {
  const objects = selected(scene, objectIds);
  if (objects.length < 2) return scene;
  const axis = AXIS_OF[mode];
  const centres = objects.map((o) => objectCentre(project, o));
  const values = centres.map((c) => c[axis]);

  const targetOf = (index: number): number => {
    switch (mode) {
      case "ALIGN_MIN_X":
      case "ALIGN_MIN_Z":
        return Math.min(...values);
      case "ALIGN_MAX_X":
      case "ALIGN_MAX_Z":
        return Math.max(...values);
      case "ALIGN_CENTER_X":
      case "ALIGN_CENTER_Z":
      case "MATCH_ALTITUDE":
        return values.reduce((s, v) => s + v, 0) / values.length;
      default: {
        // DISTRIBUTE: evenly spaced between the extremes, order preserved.
        const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
        const min = order[0]!.v;
        const max = order[order.length - 1]!.v;
        const stepSize = (max - min) / (order.length - 1);
        const slot = order.findIndex((e) => e.i === index);
        return min + slot * stepSize;
      }
    }
  };

  let next = scene;
  objects.forEach((object, index) => {
    const delta = targetOf(index) - values[index]!;
    if (delta === 0) return;
    const move: Vector3Tuple = [
      axis === 0 ? delta : 0,
      axis === 1 ? delta : 0,
      axis === 2 ? delta : 0,
    ];
    next = translateSceneObjects(next, [object.id], move);
  });
  return next;
}
