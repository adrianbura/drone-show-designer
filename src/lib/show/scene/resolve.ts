/**
 * SCENE RESOLUTION — asset-local geometry -> world-space scene targets.
 *
 * Asset immutability is structural here: nothing in this module ever writes to a
 * `Formation` or `DynamicFormation`. Instances READ asset geometry and emit new
 * arrays, so the same asset may appear any number of times in any number of
 * scenes with completely independent transforms.
 *
 * Transform composition (deterministic, never render-order dependent):
 *
 *   world = SCENE( OBJECT( DYNAMIC_LOCAL( asset point ) ) )
 *
 * and per level: mirror -> scale -> rotate (Euler XYZ around pivot) -> translate.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import { createDynamicEvaluator, type DynamicEvaluator } from "../dynamic/sampler";
import { quatFromEulerDeg, rotateByQuat } from "../dynamic/math";
import type { DynamicFormation } from "../dynamic/types";
import type { Formation, ShowProject, Vector3Tuple } from "../types";
import {
  IDENTITY_INSTANCE_TRANSFORM,
  SceneError,
  type FormationScene,
  type InstanceTransform,
  type ResolvedScene,
  type ResolvedSceneGroup,
  type SceneFormationInstance,
} from "./types";

/** Deterministic even sub-sample of `n` indices down to `k` (k <= n). */
export function subsampleIndices(n: number, k: number): number[] {
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k <= 0) return [];
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(Math.round((i * (n - 1)) / (k - 1 || 1)));
  // Even spacing can collide on tiny ratios; repair deterministically.
  const seen = new Set<number>();
  for (let i = 0; i < out.length; i++) {
    let v = out[i]!;
    while (seen.has(v) && v < n - 1) v++;
    while (seen.has(v) && v > 0) v--;
    seen.add(v);
    out[i] = v;
  }
  return out;
}

export function findStaticSource(project: ShowProject, id: string): Formation | undefined {
  return project.formations.find((f) => f.id === id);
}

export function findDynamicSource(
  project: ShowProject,
  id: string,
): DynamicFormation | undefined {
  return project.dynamicFormations?.find((d) => d.id === id);
}

/** Component-wise mean of the points — the default deterministic pivot. */
export function geometricCentre(points: readonly Vector3Tuple[]): Vector3Tuple {
  if (points.length === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length;
  return [x / n, y / n, z / n];
}

export function instancePivot(
  transform: InstanceTransform,
  basePoints: readonly Vector3Tuple[],
): Vector3Tuple {
  return transform.pivot ?? geometricCentre(basePoints);
}

/** One level of the hierarchy: mirror -> scale -> rotate -> translate. */
export function applyInstanceTransform(
  point: Vector3Tuple,
  transform: InstanceTransform,
  pivot: Vector3Tuple,
): Vector3Tuple {
  const scale = Number.isFinite(transform.scale) && transform.scale !== 0 ? transform.scale : 1;
  const mirror = transform.mirrorX ? -1 : 1;
  const local: Vector3Tuple = [
    (point[0] - pivot[0]) * mirror * scale,
    (point[1] - pivot[1]) * scale,
    (point[2] - pivot[2]) * scale,
  ];
  const rotated = rotateByQuat(local, quatFromEulerDeg(transform.rotationDeg));
  return [
    pivot[0] + transform.position[0] + rotated[0],
    pivot[1] + transform.position[1] + rotated[1],
    pivot[2] + transform.position[2] + rotated[2],
  ];
}

export function isIdentityTransform(t: InstanceTransform | undefined): boolean {
  if (!t) return true;
  return (
    t.position[0] === 0 &&
    t.position[1] === 0 &&
    t.position[2] === 0 &&
    t.rotationDeg[0] === 0 &&
    t.rotationDeg[1] === 0 &&
    t.rotationDeg[2] === 0 &&
    t.scale === 1 &&
    !t.mirrorX
  );
}

interface PreparedInstance {
  readonly instance: SceneFormationInstance;
  readonly group: ResolvedSceneGroup;
  /** Asset point indices this instance uses, in order. */
  readonly indices: readonly number[];
  readonly pointIds: readonly string[];
  /** Asset-local base points (index aligned with `indices`). */
  readonly base: readonly Vector3Tuple[];
  readonly evaluator: DynamicEvaluator | null;
}

function prepare(project: ShowProject, scene: FormationScene): PreparedInstance[] {
  const prepared: PreparedInstance[] = [];
  let offset = 0;
  for (const instance of scene.objects) {
    if (instance.source.kind === "STATIC") {
      const formation = findStaticSource(project, instance.source.formationId);
      if (!formation || formation.points.length === 0) {
        throw new SceneError("MISSING_SOURCE", `Scene object ${instance.id} has no geometry.`, {
          sceneId: scene.id,
          instanceId: instance.id,
        });
      }
      const indices = subsampleIndices(
        formation.points.length,
        instance.requestedDroneCount ?? formation.points.length,
      );
      prepared.push({
        instance,
        indices,
        pointIds: indices.map((i) => `${instance.id}#${i}`),
        base: indices.map((i) => formation.points[i]!),
        evaluator: null,
        group: {
          groupId: instance.id,
          instanceId: instance.id,
          name: instance.name,
          formationId: formation.id,
          offset,
          pointCount: indices.length,
        },
      });
      offset += indices.length;
      continue;
    }
    const dynamic = findDynamicSource(project, instance.source.dynamicFormationId);
    if (!dynamic || dynamic.points.length === 0) {
      throw new SceneError("MISSING_SOURCE", `Scene object ${instance.id} has no geometry.`, {
        sceneId: scene.id,
        instanceId: instance.id,
      });
    }
    const indices = subsampleIndices(
      dynamic.points.length,
      instance.requestedDroneCount ?? dynamic.points.length,
    );
    const duration = dynamic.duration > 0 ? dynamic.duration : 1;
    const animation = instance.animation ?? {};
    prepared.push({
      instance,
      indices,
      pointIds: indices.map((i) => `${instance.id}#${dynamic.points[i]!.id}`),
      base: indices.map((i) => dynamic.points[i]!.base),
      evaluator: createDynamicEvaluator(dynamic, {
        playbackRate: animation.playbackRate ?? 1,
        startOffset: (animation.startOffset ?? 0) + (animation.phaseCycles ?? 0) * duration,
      }),
      group: {
        groupId: instance.id,
        instanceId: instance.id,
        name: instance.name,
        formationId: dynamic.sourceFormationId ?? null,
        dynamicFormationId: dynamic.id,
        offset,
        pointCount: indices.length,
      },
    });
    offset += indices.length;
  }
  return prepared;
}

/** Combined world-space target points of a scene at LOCAL scene time `t`. */
export function resolveSceneAt(
  project: ShowProject,
  scene: FormationScene,
  localTime = 0,
): ResolvedScene {
  const prepared = prepare(project, scene);
  const sceneTransform = scene.transform ?? IDENTITY_INSTANCE_TRANSFORM;
  const points: Vector3Tuple[] = [];
  const pointIds: string[] = [];
  const groups: ResolvedSceneGroup[] = [];

  // The SCENE pivot is the mean of every object's untransformed centre, so
  // rotating a whole composition keeps the relative arrangement intact.
  const objectCentres = prepared.map((p) => geometricCentre(p.base));
  const scenePivot = sceneTransform.pivot ?? geometricCentre(objectCentres);

  for (const p of prepared) {
    groups.push(p.group);
    const animated = p.evaluator
      ? p.evaluator.positionsAt(localTime)
      : null;
    const local = p.indices.map((assetIndex, k) =>
      animated ? (animated[assetIndex] ?? p.base[k]!) : p.base[k]!,
    );
    const pivot = instancePivot(p.instance.transform, p.base);
    for (let k = 0; k < local.length; k++) {
      const object = applyInstanceTransform(local[k]!, p.instance.transform, pivot);
      points.push(applyInstanceTransform(object, sceneTransform, scenePivot));
      pointIds.push(p.pointIds[k]!);
    }
  }

  return {
    sceneId: scene.id,
    groups,
    points,
    pointIds,
    animated: prepared.some((p) => p.evaluator !== null),
  };
}

/**
 * Memoised evaluator for one scene. Shape-compatible with `DynamicEvaluator`'s
 * sampling surface, so `planDynamicPoint` can turn any scene point into a
 * canonical `PlannedTrajectory` without a second trajectory format.
 */
export interface SceneEvaluator {
  readonly scene: FormationScene;
  readonly groups: readonly ResolvedSceneGroup[];
  readonly pointCount: number;
  readonly animated: boolean;
  positionsAt(t: number): readonly Vector3Tuple[];
  pointAt(pointIndex: number, t: number): Vector3Tuple;
  readonly pointIds: readonly string[];
}

export function createSceneEvaluator(
  project: ShowProject,
  scene: FormationScene,
  options: { readonly quantum?: number } = {},
): SceneEvaluator {
  const quantum = options.quantum && options.quantum > 0 ? options.quantum : 0.001;
  const initial = resolveSceneAt(project, scene, 0);
  const cache = new Map<number, readonly Vector3Tuple[]>();
  cache.set(0, initial.points);

  const positionsAt = (t: number): readonly Vector3Tuple[] => {
    if (!initial.animated) return initial.points;
    const key = Math.round(t / quantum);
    const hit = cache.get(key);
    if (hit) return hit;
    const value = resolveSceneAt(project, scene, key * quantum).points;
    if (cache.size > 100_000) cache.clear();
    cache.set(key, value);
    return value;
  };

  return {
    scene,
    groups: initial.groups,
    pointCount: initial.points.length,
    animated: initial.animated,
    pointIds: initial.pointIds,
    positionsAt,
    pointAt: (pointIndex, t) => positionsAt(t)[pointIndex] ?? initial.points[pointIndex] ?? [0, 0, 0],
  };
}
