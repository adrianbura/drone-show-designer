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
import { projectScene, sceneForClip, synthesizeScene, upsertScene } from "../show/scene";
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
export function convertClipToScene(
  project: ShowProject,
  clipId: string,
): ClipDesignResult | null {
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

/**
 * Duplicates a SHOW clip for design work. TAKEOFF / LANDING clips are refused:
 * their semantics are owned by the pre-show and landing engines.
 */
export function duplicateShowClip(
  project: ShowProject,
  clipId: string,
  ids: ClipDuplicationIds,
): ClipDesignResult | null {
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip || clipPhase(clip) !== "SHOW") return null;
  const hasAuthoredScene = !!projectScene(project, clipId);
  const source = sceneForClip(project, clip);

  const copyClip: TimelineClip = { ...clip, id: ids.clipId, phase: "SHOW" };
  const timeline = insertClipBeforeLanding(project.timeline, copyClip);

  const objects = source.objects.map((object, index) => ({
    ...object,
    id: `${ids.clipId}-obj-${index + 1}`,
  }));
  const copyScene: FormationScene = {
    ...source,
    id: ids.clipId,
    name: `${source.name} copy`,
    schemaVersion: SCENE_SCHEMA_VERSION,
    objects,
  };

  // Lighting travels with the design copy so the duplicate LOOKS identical.
  const sourceEffects = project.lighting?.effects ?? [];
  const copiedEffects: LightingEffectInstance[] = sourceEffects
    .filter((e) => e.target.kind === "SCENE" && e.target.clipId === clipId)
    .map((effect, index) => ({
      ...effect,
      id: ids.lightingEffectId(index),
      target: { kind: "SCENE", clipId: ids.clipId },
    }));

  let next: ShowProject = { ...project, timeline };
  if (copiedEffects.length > 0) {
    next = {
      ...next,
      lighting: {
        schemaVersion: project.lighting?.schemaVersion ?? 1,
        effects: [...sourceEffects, ...copiedEffects],
      },
    };
  }
  // The duplicate always gets an AUTHORED scene when the source had one; a plain
  // legacy clip stays legacy (its implicit scene is identical anyway).
  const withScene = hasAuthoredScene ? upsertScene(next, copyScene) : next;
  return {
    project: withScene,
    clipId: ids.clipId,
    sceneObjectIds: hasAuthoredScene ? objects.map((o) => o.id) : [],
  };
}
