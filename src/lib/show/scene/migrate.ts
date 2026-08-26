/**
 * SCENE BINDING + BACKWARD COMPATIBILITY.
 *
 * Every timeline clip IS a scene. A project saved before Sprint 7.3.5 has no
 * `scenes` array, so a scene is SYNTHESISED on read: one clip -> one scene with
 * exactly one object at identity transform. That synthesis is geometrically a
 * no-op (identity transform, full asset point list), which is why migration can
 * never change a single trajectory of an existing show.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { ShowProject, TimelineClip } from "../types";
import { clipPhase } from "../types";
import {
  IDENTITY_INSTANCE_TRANSFORM,
  SCENE_SCHEMA_VERSION,
  type FormationScene,
  type InstanceTransform,
  type SceneFormationInstance,
  type ScenePointGroup,
} from "./types";
import { isIdentityTransform } from "./resolve";

/** Explicitly authored scene of a clip, if the project has one. */
export function projectScene(project: ShowProject, clipId: string): FormationScene | undefined {
  return project.scenes?.find((s) => s.id === clipId);
}

/** Single-object scene equivalent to a legacy clip. */
export function synthesizeScene(project: ShowProject, clip: TimelineClip): FormationScene {
  const dynamic = clip.dynamicFormationId
    ? project.dynamicFormations?.find((d) => d.id === clip.dynamicFormationId)
    : undefined;
  const formation = project.formations.find((f) => f.id === clip.formationId);
  const object: SceneFormationInstance = {
    id: `${clip.id}-obj-1`,
    name: dynamic?.name ?? formation?.name ?? "Formation",
    source: dynamic
      ? { kind: "DYNAMIC", dynamicFormationId: dynamic.id }
      : { kind: "STATIC", formationId: clip.formationId },
    transform: IDENTITY_INSTANCE_TRANSFORM,
    ...(dynamic
      ? {
          animation: {
            playbackRate: clip.playbackRate ?? 1,
            startOffset: clip.dynamicStartOffset ?? 0,
          },
        }
      : {}),
    lighting: { color: clip.color, effect: clip.effect },
  };
  return {
    id: clip.id,
    name: formation?.name ?? clip.id,
    schemaVersion: SCENE_SCHEMA_VERSION,
    objects: [object],
    transform: IDENTITY_INSTANCE_TRANSFORM,
  };
}

/** The scene of a clip — authored when present, synthesised otherwise. */
export function sceneForClip(project: ShowProject, clip: TimelineClip): FormationScene {
  return projectScene(project, clip.id) ?? synthesizeScene(project, clip);
}

/**
 * True when a clip needs the multi-object scene pipeline. A legacy clip, or an
 * authored scene holding exactly one untransformed full-asset object, keeps the
 * historical single-formation code path bit-for-bit.
 */
export function isCompositeScene(project: ShowProject, clip: TimelineClip): boolean {
  if (clipPhase(clip) !== "SHOW") return false;
  const scene = projectScene(project, clip.id);
  if (!scene || scene.objects.length === 0) return false;
  if (scene.objects.length > 1) return true;
  if (!isIdentityTransform(scene.transform)) return true;
  const object = scene.objects[0]!;
  return (
    !isIdentityTransform(object.transform) ||
    (object.requestedDroneCount ?? null) !== null ||
    object.visible === false
  );
}

/** Clips that carry an authored multi-object composition. */
export function compositeClipIds(project: ShowProject): string[] {
  return project.timeline.filter((c) => isCompositeScene(project, c)).map((c) => c.id);
}

export function upsertScene(project: ShowProject, scene: FormationScene): ShowProject {
  const scenes = project.scenes ?? [];
  const exists = scenes.some((s) => s.id === scene.id);
  return {
    ...project,
    scenes: exists ? scenes.map((s) => (s.id === scene.id ? scene : s)) : [...scenes, scene],
  };
}

export function removeScene(project: ShowProject, sceneId: string): ShowProject {
  if (!project.scenes) return project;
  return { ...project, scenes: project.scenes.filter((s) => s.id !== sceneId) };
}

function sanitizeTransform(value: unknown): InstanceTransform {
  const t = (value ?? {}) as Partial<InstanceTransform>;
  const vec = (v: unknown, fallback: readonly [number, number, number]) =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
      ? ([v[0], v[1], v[2]] as [number, number, number])
      : ([...fallback] as [number, number, number]);
  return {
    position: vec(t.position, [0, 0, 0]),
    rotationDeg: vec(t.rotationDeg, [0, 0, 0]),
    scale: typeof t.scale === "number" && Number.isFinite(t.scale) && t.scale !== 0 ? t.scale : 1,
    ...(t.mirrorX ? { mirrorX: true } : {}),
    ...(t.pivot ? { pivot: vec(t.pivot, [0, 0, 0]) } : {}),
  };
}

/**
 * Defensive read of persisted scenes. An unknown FUTURE scene schema version is
 * dropped rather than silently reinterpreted: the clip then falls back to its
 * legacy single-formation behaviour instead of producing wrong geometry.
 */
export function sanitizeScenes(raw: unknown): FormationScene[] {
  if (!Array.isArray(raw)) return [];
  const out: FormationScene[] = [];
  for (const value of raw) {
    const scene = value as Partial<FormationScene> | null;
    if (!scene || typeof scene.id !== "string" || !Array.isArray(scene.objects)) continue;
    if (typeof scene.schemaVersion === "number" && scene.schemaVersion > SCENE_SCHEMA_VERSION) {
      continue;
    }
    const objects: SceneFormationInstance[] = [];
    for (const rawObject of scene.objects) {
      const object = rawObject as Partial<SceneFormationInstance> | null;
      const source = object?.source;
      if (!object || typeof object.id !== "string" || !source) continue;
      if (source.kind === "STATIC" && typeof source.formationId !== "string") continue;
      if (source.kind === "DYNAMIC" && typeof source.dynamicFormationId !== "string") continue;
      if (source.kind !== "STATIC" && source.kind !== "DYNAMIC") continue;
      objects.push({
        id: object.id,
        name: typeof object.name === "string" && object.name ? object.name : object.id,
        source,
        ...(object.assetId ? { assetId: object.assetId } : {}),
        transform: sanitizeTransform(object.transform),
        ...(typeof object.requestedDroneCount === "number" && object.requestedDroneCount > 0
          ? { requestedDroneCount: Math.round(object.requestedDroneCount) }
          : {}),
        ...(object.animation ? { animation: object.animation } : {}),
        ...(object.lighting ? { lighting: object.lighting } : {}),
        ...(object.visible === false ? { visible: false } : {}),
        ...(object.metadata ? { metadata: object.metadata } : {}),
      });
    }
    if (objects.length === 0) continue;
    const objectIds = new Set(objects.map((object) => object.id));
    const pointGroups: ScenePointGroup[] = [];
    if (Array.isArray(scene.pointGroups)) {
      for (const rawGroup of scene.pointGroups) {
        const group = rawGroup as Partial<ScenePointGroup> | null;
        if (
          !group ||
          typeof group.id !== "string" ||
          typeof group.instanceId !== "string" ||
          !objectIds.has(group.instanceId) ||
          !Array.isArray(group.pointIds)
        )
          continue;
        const pointIds = [
          ...new Set(group.pointIds.filter((id): id is string => typeof id === "string")),
        ];
        if (pointIds.length === 0) continue;
        pointGroups.push({
          id: group.id,
          name: typeof group.name === "string" && group.name ? group.name : group.id,
          instanceId: group.instanceId,
          pointIds,
        });
      }
    }
    out.push({
      id: scene.id,
      name: typeof scene.name === "string" && scene.name ? scene.name : scene.id,
      schemaVersion: SCENE_SCHEMA_VERSION,
      objects,
      ...(pointGroups.length > 0 ? { pointGroups } : {}),
      transform: sanitizeTransform(scene.transform),
      ...(scene.expanded ? { expanded: true } : {}),
    });
  }
  return out;
}
