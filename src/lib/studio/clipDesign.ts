/**
 * CLIP DESIGN COMMANDS — pure project transforms for the design workflow.
 *
 *   CONVERT STATIC CLIP TO SCENE ("Edit as Scene")
 *     Materialises the scene the clip ALREADY resolves to. `synthesizeScene` is
 *     geometrically a no-op (one object, identity transform, full asset point
 *     list), so the visible geometry, the clip timing and the clip lighting are
 *     preserved bit-for-bit; only the editing surface changes. No formation is
 *     duplicated: the object references the existing formation asset.
 *
 *   DUPLICATE SHOW CLIP ("Duplicate clip")
 *     A fresh clip id, a fresh scene id and fresh scene object ids, inserted
 *     before LANDING with the ordinary timeline semantics. Formation and dynamic
 *     ASSETS ARE SHARED, because a scene edit only writes instance transforms —
 *     the assets stay untouched. Editing that must diverge from the source (the
 *     ESSP editable-copy path) keeps using `duplicateSceneAsEditableCopy`, which
 *     copies dependencies on purpose.
 *
 * Neither command promotes reference ownership: an ESSP-owned source clip is
 * never rewritten, and a duplicate has no reference binding, so it is
 * planner-owned from creation by the ordinary ownership rule.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { LightingEffectInstance } from "../show/lighting";
import { projectScene, synthesizeScene, upsertScene } from "../show/scene";
import { SCENE_SCHEMA_VERSION, type FormationScene } from "../show/scene/types";
import { clipPhase, type ShowProject, type TimelineClip } from "../show/types";
import { insertClipBeforeLanding } from "./clipInsertion";

export interface ClipDesignResult {
  readonly project: ShowProject;
  readonly clipId: string;
  readonly sceneObjectIds: readonly string[];
}

/** True when "Edit as Scene" is meaningful: a SHOW clip without authored scene. */
export function canConvertClipToScene(project: ShowProject, clipId: string): boolean {
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip || clipPhase(clip) !== "SHOW") return false;
  return !projectScene(project, clipId);
}

/** Materialises the clip's implicit scene as an authored, editable scene. */
export function convertClipToScene(project: ShowProject, clipId: string): ClipDesignResult | null {
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip || !canConvertClipToScene(project, clipId)) return null;
  const scene = synthesizeScene(project, clip);
  if (scene.objects.length === 0) return null;
  return {
    project: upsertScene(project, scene),
    clipId,
    sceneObjectIds: scene.objects.map((o) => o.id),
  };
}

export interface ClipDuplicationIds {
  readonly clipId: string;
  readonly lightingEffectId: (index: number) => string;
}

/** Immutable, session-local snapshot used by Copy/Paste. */
export interface ClipClipboardPayload {
  readonly clip: TimelineClip;
  readonly scene: FormationScene | null;
  readonly lightingEffects: readonly LightingEffectInstance[];
}

const clonePlain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Copy never mutates project/history and captures the design at Copy time. */
export function copyShowClip(project: ShowProject, clipId: string): ClipClipboardPayload | null {
  const clip = project.timeline.find((candidate) => candidate.id === clipId);
  if (!clip || clipPhase(clip) !== "SHOW") return null;
  const scene = projectScene(project, clipId);
  return {
    clip: clonePlain(clip),
    scene: scene ? clonePlain(scene) : null,
    lightingEffects: clonePlain(
      (project.lighting?.effects ?? []).filter((effect) => effect.target.clipId === clipId),
    ),
  };
}

function clipboardDependenciesExist(project: ShowProject, payload: ClipClipboardPayload): boolean {
  const staticIds = new Set(project.formations.map((formation) => formation.id));
  const dynamicIds = new Set((project.dynamicFormations ?? []).map((formation) => formation.id));
  if (!staticIds.has(payload.clip.formationId)) return false;
  if (payload.clip.dynamicFormationId && !dynamicIds.has(payload.clip.dynamicFormationId))
    return false;
  return (payload.scene?.objects ?? []).every((object) =>
    object.source.kind === "STATIC"
      ? staticIds.has(object.source.formationId)
      : dynamicIds.has(object.source.dynamicFormationId),
  );
}

function sceneObjectIdMap(
  scene: FormationScene | null,
  clipId: string,
): ReadonlyMap<string, string> {
  return new Map(
    (scene?.objects ?? []).map((object, index) => [object.id, `${clipId}-obj-${index + 1}`]),
  );
}

function remapSceneObjects(
  scene: FormationScene,
  clipId: string,
  objectIds: ReadonlyMap<string, string>,
): FormationScene {
  const remap = (id: string) => objectIds.get(id) ?? id;
  return {
    ...clonePlain(scene),
    id: clipId,
    name: `${scene.name} copy`,
    schemaVersion: SCENE_SCHEMA_VERSION,
    objects: scene.objects.map((object) => ({ ...clonePlain(object), id: remap(object.id) })),
    ...(scene.pointGroups
      ? {
          pointGroups: scene.pointGroups.map((group) => ({
            ...clonePlain(group),
            instanceId: remap(group.instanceId),
          })),
        }
      : {}),
    ...(scene.visualGroups
      ? {
          visualGroups: scene.visualGroups.map((group) => ({
            ...clonePlain(group),
            objectIds: group.objectIds.map(remap),
          })),
        }
      : {}),
    ...(scene.visualStates
      ? {
          visualStates: scene.visualStates.map((state) => ({
            ...clonePlain(state),
            objects: state.objects.map((object) => ({
              ...clonePlain(object),
              objectId: remap(object.objectId),
            })),
          })),
        }
      : {}),
  };
}

/** Paste creates a fresh planner-owned SHOW clip as one complete project transform. */
export function pasteShowClip(
  project: ShowProject,
  payload: ClipClipboardPayload,
  ids: ClipDuplicationIds,
): ClipDesignResult | null {
  if (!clipboardDependenciesExist(project, payload)) return null;
  const timeline = insertClipBeforeLanding(project.timeline, {
    ...clonePlain(payload.clip),
    id: ids.clipId,
    phase: "SHOW",
  });
  const objectIds = sceneObjectIdMap(payload.scene, ids.clipId);
  const copiedEffects = payload.lightingEffects.map((effect, index) => ({
    ...clonePlain(effect),
    id: ids.lightingEffectId(index),
    target:
      "instanceId" in effect.target
        ? {
            ...clonePlain(effect.target),
            clipId: ids.clipId,
            instanceId: objectIds.get(effect.target.instanceId) ?? effect.target.instanceId,
          }
        : { ...clonePlain(effect.target), clipId: ids.clipId },
  }));
  let next: ShowProject = { ...project, timeline };
  if (copiedEffects.length > 0) {
    next = {
      ...next,
      lighting: {
        schemaVersion: project.lighting?.schemaVersion ?? 1,
        effects: [...(project.lighting?.effects ?? []), ...copiedEffects],
      },
    };
  }
  const scene = payload.scene ? remapSceneObjects(payload.scene, ids.clipId, objectIds) : null;
  if (scene) next = upsertScene(next, scene);
  return {
    project: next,
    clipId: ids.clipId,
    sceneObjectIds: scene?.objects.map((object) => object.id) ?? [],
  };
}

/**
 * Duplicates a SHOW clip for design work. TAKEOFF / LANDING clips are refused:
 * their semantics are owned by the pre-show and landing engines.
 */
export function duplicateShowClip(
  project: ShowProject,
  clipId: string,
  ids: ClipDuplicationIds,
): ClipDesignResult | null {
  const payload = copyShowClip(project, clipId);
  return payload ? pasteShowClip(project, payload, ids) : null;
}
