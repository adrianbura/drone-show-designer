import type { ShowProject } from "../types";
import type { FormationScene, SceneFormationInstance } from "./types";
import { objectCentre, translateSceneObjects } from "./group";

export type SceneAxis = "X" | "Y" | "Z";
export type SceneAlignMode = "MIN" | "CENTER" | "MAX";

const axisIndex = (axis: SceneAxis): 0 | 1 | 2 => axis === "X" ? 0 : axis === "Y" ? 1 : 2;

function selectedObjects(scene: FormationScene, objectIds: readonly string[]): SceneFormationInstance[] {
  const wanted = new Set(objectIds);
  return scene.objects.filter((object) => wanted.has(object.id));
}

/**
 * Align selected object CENTRES on one world-space axis.
 *
 * MIN/MAX use the extreme selected centre; CENTER uses their midpoint. This is
 * intentionally centre-based (not bounding-box based): scene objects can contain
 * arbitrary rotated/dynamic geometry and objectCentre is already the canonical
 * exact centre authority used by group transforms.
 */
export function alignSceneObjects(
  project: ShowProject,
  scene: FormationScene,
  objectIds: readonly string[],
  axis: SceneAxis,
  mode: SceneAlignMode,
): FormationScene {
  const objects = selectedObjects(scene, objectIds);
  if (objects.length < 2) return scene;
  const i = axisIndex(axis);
  const centres = objects.map((object) => objectCentre(project, object));
  const values = centres.map((centre) => centre[i]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const target = mode === "MIN" ? min : mode === "MAX" ? max : (min + max) / 2;

  let next = scene;
  for (let n = 0; n < objects.length; n += 1) {
    const delta: [number, number, number] = [0, 0, 0];
    delta[i] = target - centres[n]![i];
    next = translateSceneObjects(next, [objects[n]!.id], delta);
  }
  return next;
}

/** Match every selected object's world-space centre altitude to the first selected object. */
export function matchSceneObjectAltitude(
  project: ShowProject,
  scene: FormationScene,
  objectIds: readonly string[],
): FormationScene {
  const objects = selectedObjects(scene, objectIds);
  if (objects.length < 2) return scene;
  const target = objectCentre(project, objects[0]!)[1];
  let next = scene;
  for (const object of objects.slice(1)) {
    const current = objectCentre(project, object)[1];
    next = translateSceneObjects(next, [object.id], [0, target - current, 0]);
  }
  return next;
}

/**
 * Evenly distribute selected object centres between the two existing extremes.
 * Stable ties use scene order, so identical input always yields identical output.
 */
export function distributeSceneObjects(
  project: ShowProject,
  scene: FormationScene,
  objectIds: readonly string[],
  axis: "X" | "Z",
): FormationScene {
  const objects = selectedObjects(scene, objectIds);
  if (objects.length < 3) return scene;
  const i = axisIndex(axis);
  const ranked = objects
    .map((object, order) => ({ object, order, centre: objectCentre(project, object) }))
    .sort((a, b) => a.centre[i] - b.centre[i] || a.order - b.order);
  const min = ranked[0]!.centre[i];
  const max = ranked[ranked.length - 1]!.centre[i];
  const step = (max - min) / (ranked.length - 1);

  let next = scene;
  ranked.forEach((entry, index) => {
    const delta: [number, number, number] = [0, 0, 0];
    delta[i] = min + step * index - entry.centre[i];
    next = translateSceneObjects(next, [entry.object.id], delta);
  });
  return next;
}
