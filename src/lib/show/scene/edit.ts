/**
 * SCENE EDITING — pure, deterministic composition operations.
 *
 * Every helper returns a NEW scene. Nothing here touches library assets, physical
 * drones or derived plans: the studio store commits these results, the engines
 * recompute from them.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { ShowProject, Vector3Tuple } from "../types";
import { geometricCentre, instancePivot, findDynamicSource, findStaticSource } from "./resolve";
import {
  IDENTITY_INSTANCE_TRANSFORM,
  SCENE_SCHEMA_VERSION,
  type FormationScene,
  type InstanceTransform,
  type SceneFormationInstance,
  type SceneObjectSource,
} from "./types";

export function emptyScene(id: string, name: string): FormationScene {
  return {
    id,
    name,
    schemaVersion: SCENE_SCHEMA_VERSION,
    objects: [],
    transform: IDENTITY_INSTANCE_TRANSFORM,
  };
}

/** Deterministic unique instance id inside one scene. */
export function nextObjectId(scene: FormationScene): string {
  let n = scene.objects.length + 1;
  const used = new Set(scene.objects.map((o) => o.id));
  let id = `${scene.id}-obj-${n}`;
  while (used.has(id)) {
    n++;
    id = `${scene.id}-obj-${n}`;
  }
  return id;
}

/** Deterministic unique object name (`Heart`, `Heart 2`, `Heart 3`, ...). */
export function nextObjectName(scene: FormationScene, base: string): string {
  const used = new Set(scene.objects.map((o) => o.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

const assetSpan = (project: ShowProject, source: SceneObjectSource): number => {
  const points =
    source.kind === "STATIC"
      ? (findStaticSource(project, source.formationId)?.points ?? [])
      : (findDynamicSource(project, source.dynamicFormationId)?.points.map((p) => p.base) ?? []);
  if (points.length === 0) return 20;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
  }
  return Math.max(5, maxX - minX);
};

/**
 * SMART DEFAULT PLACEMENT — a deterministic side-by-side offset so a newly added
 * object is immediately editable instead of sitting inside the existing one.
 * This is a usability convenience, NOT an artistic optimisation: the user stays
 * fully in control of the final placement.
 */
export function defaultPlacement(
  project: ShowProject,
  scene: FormationScene,
  source: SceneObjectSource,
): Vector3Tuple {
  if (scene.objects.length === 0) return [0, 0, 0];
  const span = assetSpan(project, source);
  const step = span * 1.2;
  // Alternate right / left of the composition centre, growing outwards.
  const n = scene.objects.length;
  const ring = Math.ceil(n / 2);
  const sign = n % 2 === 1 ? 1 : -1;
  return [sign * ring * step, 0, 0];
}

export function addObject(
  project: ShowProject,
  scene: FormationScene,
  input: {
    readonly source: SceneObjectSource;
    readonly name: string;
    readonly assetId?: string;
    readonly requestedDroneCount?: number | null;
    readonly position?: Vector3Tuple;
  },
): { readonly scene: FormationScene; readonly objectId: string } {
  const id = nextObjectId(scene);
  const object: SceneFormationInstance = {
    id,
    name: nextObjectName(scene, input.name),
    source: input.source,
    ...(input.assetId ? { assetId: input.assetId } : {}),
    transform: {
      ...IDENTITY_INSTANCE_TRANSFORM,
      position: input.position ?? defaultPlacement(project, scene, input.source),
    },
    ...(input.requestedDroneCount
      ? { requestedDroneCount: Math.max(1, Math.round(input.requestedDroneCount)) }
      : {}),
  };
  return { scene: { ...scene, objects: [...scene.objects, object] }, objectId: id };
}

export function patchObject(
  scene: FormationScene,
  objectId: string,
  patch: Partial<SceneFormationInstance>,
): FormationScene {
  return {
    ...scene,
    objects: scene.objects.map((o) => (o.id === objectId ? { ...o, ...patch } : o)),
  };
}

export function patchObjectTransform(
  scene: FormationScene,
  objectId: string,
  patch: Partial<InstanceTransform>,
): FormationScene {
  return {
    ...scene,
    objects: scene.objects.map((o) =>
      o.id === objectId ? { ...o, transform: { ...o.transform, ...patch } } : o,
    ),
  };
}

/** A duplicate is a NEW INSTANCE of the SAME asset — never an asset copy. */
export function duplicateObject(
  scene: FormationScene,
  objectId: string,
  offset: Vector3Tuple = [0, 0, 0],
): { readonly scene: FormationScene; readonly objectId: string } {
  const source = scene.objects.find((o) => o.id === objectId);
  if (!source) return { scene, objectId };
  const id = nextObjectId(scene);
  const copy: SceneFormationInstance = {
    ...source,
    id,
    name: nextObjectName(scene, source.name),
    transform: {
      ...source.transform,
      position: [
        source.transform.position[0] + offset[0],
        source.transform.position[1] + offset[1],
        source.transform.position[2] + offset[2],
      ],
    },
  };
  const index = scene.objects.findIndex((o) => o.id === objectId);
  const objects = [...scene.objects];
  objects.splice(index + 1, 0, copy);
  return { scene: { ...scene, objects }, objectId: id };
}

export function removeObject(scene: FormationScene, objectId: string): FormationScene {
  return { ...scene, objects: scene.objects.filter((o) => o.id !== objectId) };
}

export function mirrorObjectX(scene: FormationScene, objectId: string): FormationScene {
  const object = scene.objects.find((o) => o.id === objectId);
  if (!object) return scene;
  return patchObjectTransform(scene, objectId, { mirrorX: !object.transform.mirrorX });
}

export type SceneAlignment = "CENTER_X" | "CENTER_Y" | "DISTRIBUTE_X" | "DISTRIBUTE_Y";

/** Editor geometry tools operating on instance transforms only. */
export function alignObjects(
  project: ShowProject,
  scene: FormationScene,
  alignment: SceneAlignment,
): FormationScene {
  if (scene.objects.length < 2) return scene;
  const centres = scene.objects.map((o) => {
    const base =
      o.source.kind === "STATIC"
        ? (findStaticSource(project, o.source.formationId)?.points ?? [])
        : (findDynamicSource(project, o.source.dynamicFormationId)?.points.map((p) => p.base) ?? []);
    const pivot = instancePivot(o.transform, base);
    const centre = geometricCentre(base);
    return {
      id: o.id,
      // World centre = pivot + translation + (centre - pivot) * scale.
      x: pivot[0] + o.transform.position[0] + (centre[0] - pivot[0]) * o.transform.scale,
      y: pivot[1] + o.transform.position[1] + (centre[1] - pivot[1]) * o.transform.scale,
    };
  });
  const axis = alignment === "CENTER_X" || alignment === "DISTRIBUTE_X" ? 0 : 1;
  const values = centres.map((c) => (axis === 0 ? c.x : c.y));

  if (alignment === "CENTER_X" || alignment === "CENTER_Y") {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return {
      ...scene,
      objects: scene.objects.map((o, i) => {
        const delta = mean - values[i]!;
        const position: Vector3Tuple = [
          o.transform.position[0] + (axis === 0 ? delta : 0),
          o.transform.position[1] + (axis === 1 ? delta : 0),
          o.transform.position[2],
        ];
        return { ...o, transform: { ...o.transform, position } };
      }),
    };
  }

  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const min = order[0]!.v;
  const max = order[order.length - 1]!.v;
  const step = (max - min) / (order.length - 1);
  const targets = new Map<number, number>();
  order.forEach((entry, k) => targets.set(entry.i, min + k * step));
  return {
    ...scene,
    objects: scene.objects.map((o, i) => {
      const delta = (targets.get(i) ?? values[i]!) - values[i]!;
      const position: Vector3Tuple = [
        o.transform.position[0] + (axis === 0 ? delta : 0),
        o.transform.position[1] + (axis === 1 ? delta : 0),
        o.transform.position[2],
      ];
      return { ...o, transform: { ...o.transform, position } };
    }),
  };
}
