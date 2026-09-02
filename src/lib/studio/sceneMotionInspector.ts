/**
 * EVERYDAY MOTION INSPECTOR (pure helpers).
 *
 * Reads the CANONICAL motion model only:
 *   - `DynamicFormation` (points, groups, keyframes, duration, loop);
 *   - `SceneFormationInstance.animation` (playbackRate, startOffset, phaseCycles).
 *
 * There is no second motion-effect model here: every function is a pure
 * projection of, or a pure edit on, the canonical project. Removal and
 * duplication return a NEW project so the store can commit them as exactly one
 * revision (one Undo entry).
 *
 * No React, no Three.js, no I/O.
 */
import type { DynamicFormation, MotionGroup } from "../show/dynamic";
import type { FormationScene, SceneFormationInstance } from "../show/scene";
import { projectScene, upsertScene } from "../show/scene";
import type { ShowProject } from "../show/types";

export type MotionScope = "OBJECT" | "DRONES";

export interface MotionGroupView {
  readonly id: string;
  readonly name: string;
  readonly droneCount: number;
  readonly enabled: boolean;
  readonly phaseOffset: number;
  readonly loopDuration: number;
}

export interface SceneMotionState {
  readonly clipId: string;
  readonly objectId: string;
  readonly objectName: string;
  readonly dynamic: DynamicFormation;
  /** Human description inferred from canonical data, never invented state. */
  readonly motionLabel: string;
  readonly cycleDuration: number;
  readonly playbackRate: number;
  readonly startOffset: number;
  readonly phaseCycles: number;
  readonly loop: DynamicFormation["loop"];
  readonly droneCount: number;
  readonly scope: MotionScope;
  /** Motion group matching the selected drone points, when there is one. */
  readonly group: MotionGroupView | null;
  /** How many scene objects (in this scene) share the dynamic asset. */
  readonly sharedBy: number;
  /** True when the static source formation still exists and can be restored. */
  readonly canRestoreStatic: boolean;
}

/** Local dynamic point ids (`FP-001`) for globally-scoped selected point ids. */
export function localPointIds(objectId: string, selected: readonly string[]): string[] {
  return selected
    .filter((id) => id.startsWith(`${objectId}#`))
    .map((id) => id.slice(objectId.length + 1))
    .map((id) => (/^\d+$/.test(id) ? `FP-${String(Number(id) + 1).padStart(3, "0")}` : id));
}

/** Descriptive label from canonical group names / global track. */
export function inferMotionLabel(dynamic: DynamicFormation): string {
  const named = dynamic.groups.find((group) => group.name.length > 0);
  if (named) return named.name;
  if (dynamic.transform.length > 1) return "Global motion track";
  return "No motion authored yet";
}

export function motionGroupView(group: MotionGroup, cycleDuration: number): MotionGroupView {
  return {
    id: group.id,
    name: group.name,
    droneCount: group.pointIds.length,
    enabled: group.enabled,
    phaseOffset: group.phaseOffset,
    loopDuration: group.loopDuration && group.loopDuration > 0 ? group.loopDuration : cycleDuration,
  };
}

/** The motion group that best matches the selected drone points of an object. */
export function motionGroupForPoints(
  dynamic: DynamicFormation,
  objectId: string,
  selectedPointIds: readonly string[],
): MotionGroup | null {
  const wanted = new Set(localPointIds(objectId, selectedPointIds));
  if (wanted.size === 0) return null;
  let best: MotionGroup | null = null;
  let bestOverlap = 0;
  for (const group of dynamic.groups) {
    const overlap = group.pointIds.filter((id) => wanted.has(id)).length;
    if (overlap > bestOverlap) {
      best = group;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** How many objects of the scene reference one dynamic asset. */
export function dynamicUsageCount(scene: FormationScene, dynamicFormationId: string): number {
  return scene.objects.filter(
    (object) =>
      object.source.kind === "DYNAMIC" && object.source.dynamicFormationId === dynamicFormationId,
  ).length;
}

function objectDroneCount(object: SceneFormationInstance, dynamic: DynamicFormation): number {
  const requested = object.requestedDroneCount;
  if (requested && requested > 0) return Math.min(requested, dynamic.points.length);
  return dynamic.points.length;
}

export interface SceneMotionStateInput {
  readonly clipId: string;
  readonly scene: FormationScene | null;
  readonly dynamics: readonly DynamicFormation[];
  readonly formationIds: readonly string[];
  readonly primaryObjectId: string | null;
  readonly selectionMode: MotionScope;
  readonly selectedPointIds: readonly string[];
}

/**
 * Canonical motion state of the CURRENT selection. Pure read: browsing or
 * selecting never mutates the project.
 */
export function sceneMotionState(input: SceneMotionStateInput): SceneMotionState | null {
  const { scene, primaryObjectId } = input;
  if (!scene || !primaryObjectId) return null;
  const object = scene.objects.find((candidate) => candidate.id === primaryObjectId);
  if (!object || object.source.kind !== "DYNAMIC") return null;
  const dynamicId = object.source.dynamicFormationId;
  const dynamic = input.dynamics.find((candidate) => candidate.id === dynamicId);
  if (!dynamic) return null;
  const scope: MotionScope = input.selectionMode === "DRONES" ? "DRONES" : "OBJECT";
  const group =
    scope === "DRONES" ? motionGroupForPoints(dynamic, object.id, input.selectedPointIds) : null;
  return {
    clipId: input.clipId,
    objectId: object.id,
    objectName: object.name,
    dynamic,
    motionLabel: inferMotionLabel(dynamic),
    cycleDuration: dynamic.duration,
    playbackRate: object.animation?.playbackRate ?? 1,
    startOffset: object.animation?.startOffset ?? 0,
    phaseCycles: object.animation?.phaseCycles ?? 0,
    loop: dynamic.loop,
    droneCount: objectDroneCount(object, dynamic),
    scope,
    group: group ? motionGroupView(group, dynamic.duration) : null,
    sharedBy: dynamicUsageCount(scene, dynamic.id),
    canRestoreStatic:
      !!dynamic.sourceFormationId && input.formationIds.includes(dynamic.sourceFormationId),
  };
}

/* ------------------------------------------------------------- pure edits */

/**
 * Detaches motion from ONE object: the object goes back to its static source
 * when that formation still exists. The dynamic asset is only dropped when no
 * other object (or clip) still uses it.
 */
export function removeObjectMotion(
  project: ShowProject,
  clipId: string,
  objectId: string,
): ShowProject {
  const scene = projectScene(project, clipId);
  if (!scene) return project;
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  if (!object || object.source.kind !== "DYNAMIC") return project;
  const dynamicId = object.source.dynamicFormationId;
  const dynamic = (project.dynamicFormations ?? []).find((candidate) => candidate.id === dynamicId);
  const sourceId = dynamic?.sourceFormationId;
  if (!sourceId || !project.formations.some((formation) => formation.id === sourceId)) {
    return project;
  }
  const objects = scene.objects.map((candidate) => {
    if (candidate.id !== objectId) return candidate;
    const { animation: _dropped, ...rest } = candidate;
    return { ...rest, source: { kind: "STATIC" as const, formationId: sourceId } };
  });
  const nextScene = { ...scene, objects };
  const stillUsedInScene = dynamicUsageCount(nextScene, dynamicId) > 0;
  const usedByOtherScenes = (project.scenes ?? []).some(
    (candidate) => candidate.id !== scene.id && dynamicUsageCount(candidate, dynamicId) > 0,
  );
  const usedByClip = project.timeline.some((clip) => clip.dynamicFormationId === dynamicId);
  const keepAsset = stillUsedInScene || usedByOtherScenes || usedByClip;
  const dynamics = keepAsset
    ? (project.dynamicFormations ?? [])
    : (project.dynamicFormations ?? []).filter((candidate) => candidate.id !== dynamicId);
  return upsertScene({ ...project, dynamicFormations: dynamics }, nextScene);
}

/**
 * Gives ONE object an independent copy of its dynamic asset, so later edits
 * never leak into the original.
 */
export function duplicateObjectMotion(
  project: ShowProject,
  clipId: string,
  objectId: string,
  newId: string,
): ShowProject {
  const scene = projectScene(project, clipId);
  if (!scene) return project;
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  if (!object || object.source.kind !== "DYNAMIC") return project;
  const sourceDynamicId = object.source.dynamicFormationId;
  const dynamic = (project.dynamicFormations ?? []).find(
    (candidate) => candidate.id === sourceDynamicId,
  );
  if (!dynamic) return project;
  const copy: DynamicFormation = {
    ...dynamic,
    id: newId,
    name: `${dynamic.name} copy`,
    points: dynamic.points.map((point) => ({ ...point })),
    groups: dynamic.groups.map((group) => ({
      ...group,
      pointIds: [...group.pointIds],
      keyframes: group.keyframes.map((keyframe) => ({ ...keyframe })),
    })),
    transform: dynamic.transform.map((keyframe) => ({ ...keyframe })),
  };
  const objects = scene.objects.map((candidate) =>
    candidate.id === objectId
      ? { ...candidate, source: { kind: "DYNAMIC" as const, dynamicFormationId: copy.id } }
      : candidate,
  );
  return upsertScene(
    { ...project, dynamicFormations: [...(project.dynamicFormations ?? []), copy] },
    { ...scene, objects },
  );
}
