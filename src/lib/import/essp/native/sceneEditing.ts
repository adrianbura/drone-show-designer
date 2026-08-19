/**
 * REFERENCE-ASSISTED SCENE EDITING — pure project transforms.
 *
 *   RESET OBJECT TO EXTRACTED STATE
 *     Restores exactly what the extractor produced for ONE scene object, from
 *     the immutable extracted-state history stored on the imported trajectory
 *     layer. Other objects, the lighting program and every timeline timing stay
 *     untouched. It NEVER reclaims REFERENCE ownership: promotion stays
 *     conservative and irreversible until a separate contract is designed.
 *
 *   DUPLICATE SCENE AS EDITABLE COPY
 *     A planner-owned copy of an ESSP-derived composition under fresh ids, so
 *     the designer can experiment without touching the reference-owned clip.
 *     Because the copy has no binding in the layer, it is planner-owned from
 *     creation by the ordinary ownership rule — no special case is added.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import { collectSceneDependencies } from "../../../library/sceneAsset";
import type { DynamicFormation } from "../../../show/dynamic/types";
import { sceneForClip, upsertScene } from "../../../show/scene/migrate";
import { SCENE_SCHEMA_VERSION, type FormationScene, type SceneFormationInstance } from "../../../show/scene/types";
import type { Formation, ShowProject, TimelineClip } from "../../../show/types";
import type { ReferenceExtractedSceneSnapshot, ReferenceTrajectoryLayer } from "./types";

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function extractedSnapshotFor(
  layer: ReferenceTrajectoryLayer | null | undefined,
  clipId: string,
): ReferenceExtractedSceneSnapshot | null {
  return (layer?.extractedScenes ?? []).find((s) => s.clipId === clipId) ?? null;
}

/** True when the extracted state of this object is recorded and restorable. */
export function canResetSceneObject(
  layer: ReferenceTrajectoryLayer | null | undefined,
  clipId: string,
  objectId: string,
): boolean {
  const snapshot = extractedSnapshotFor(layer, clipId);
  return !!snapshot?.scene.objects.some((o) => o.id === objectId);
}

function upsertFormation(list: readonly Formation[], formation: Formation): Formation[] {
  return list.some((f) => f.id === formation.id)
    ? list.map((f) => (f.id === formation.id ? formation : f))
    : [...list, formation];
}

function upsertDynamic(
  list: readonly DynamicFormation[],
  dynamic: DynamicFormation,
): DynamicFormation[] {
  return list.some((d) => d.id === dynamic.id)
    ? list.map((d) => (d.id === dynamic.id ? dynamic : d))
    : [...list, dynamic];
}

/**
 * ONE object back to its extracted geometry + transform. Returns null when the
 * clip/object has no recorded extracted state, so the caller can keep the
 * control disabled instead of guessing.
 */
export function resetSceneObjectToExtracted(
  project: ShowProject,
  layer: ReferenceTrajectoryLayer | null | undefined,
  clipId: string,
  objectId: string,
): ShowProject | null {
  const clip = project.timeline.find((c) => c.id === clipId);
  const snapshot = extractedSnapshotFor(layer, clipId);
  if (!clip || !snapshot) return null;
  const extractedObject = snapshot.scene.objects.find((o) => o.id === objectId);
  if (!extractedObject) return null;
  const scene = sceneForClip(project, clip);
  const current = scene.objects.find((o) => o.id === objectId);
  if (!current) return null;

  // Restore the extracted GEOMETRY under the extracted ids. Artistic lighting
  // and editor visibility belong to the operator, so they are preserved.
  const restored: SceneFormationInstance = {
    ...deepCopy(extractedObject),
    ...(current.lighting ? { lighting: current.lighting } : {}),
    ...(current.visible === false ? { visible: false } : {}),
  };

  let formations = project.formations;
  let dynamicFormations = project.dynamicFormations ?? [];
  const src = restored.source;
  if (src.kind === "STATIC") {
    const formation = snapshot.formations.find((f) => f.id === src.formationId);
    if (!formation) return null;
    formations = upsertFormation(formations, deepCopy(formation));
  } else {
    const dynamic = snapshot.dynamicFormations.find((d) => d.id === src.dynamicFormationId);
    if (!dynamic) return null;
    dynamicFormations = upsertDynamic(dynamicFormations, deepCopy(dynamic));
    const base = dynamic.sourceFormationId
      ? snapshot.formations.find((f) => f.id === dynamic.sourceFormationId)
      : undefined;
    if (base) formations = upsertFormation(formations, deepCopy(base));
  }

  const next: ShowProject = { ...project, formations, dynamicFormations };
  return upsertScene(next, {
    ...scene,
    objects: scene.objects.map((o) => (o.id === objectId ? restored : o)),
  });
}

export interface SceneDuplicationIds {
  readonly clipId: string;
  readonly formationId: (index: number) => string;
  readonly dynamicFormationId: (index: number) => string;
}

/**
 * PLANNER-OWNED editable copy of a whole composition. Every dependency travels
 * with it under a fresh id, the source clip is left byte-identical, and the new
 * clip is inserted with the ordinary timeline semantics (LANDING stays last).
 */
export function duplicateSceneAsEditableCopy(
  project: ShowProject,
  clipId: string,
  ids: SceneDuplicationIds,
): { readonly project: ShowProject; readonly clipId: string } | null {
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip) return null;
  const scene = sceneForClip(project, clip);
  if (scene.objects.length === 0) return null;
  let dependencies;
  try {
    dependencies = collectSceneDependencies(scene, project);
  } catch {
    return null;
  }

  const formationIdMap = new Map<string, string>();
  const dynamicIdMap = new Map<string, string>();
  const formations = dependencies.formations.map((formation, index) => {
    const id = ids.formationId(index);
    formationIdMap.set(formation.id, id);
    return { ...deepCopy(formation), id };
  });
  const dynamicFormations = dependencies.dynamicFormations.map((dynamic, index) => {
    const id = ids.dynamicFormationId(index);
    dynamicIdMap.set(dynamic.id, id);
    const copy = deepCopy(dynamic);
    const sourceFormationId = copy.sourceFormationId
      ? formationIdMap.get(copy.sourceFormationId)
      : undefined;
    return sourceFormationId ? { ...copy, id, sourceFormationId } : { ...copy, id };
  });

  const objects: SceneFormationInstance[] = scene.objects.map((object, index) => {
    const copy = deepCopy(object);
    const id = `${ids.clipId}-obj-${index + 1}`;
    if (copy.source.kind === "STATIC") {
      const formationId = formationIdMap.get(copy.source.formationId);
      if (!formationId) return { ...copy, id };
      return { ...copy, id, source: { kind: "STATIC", formationId } };
    }
    const dynamicFormationId = dynamicIdMap.get(copy.source.dynamicFormationId);
    if (!dynamicFormationId) return { ...copy, id };
    return { ...copy, id, source: { kind: "DYNAMIC", dynamicFormationId } };
  });

  const copyScene: FormationScene = {
    ...deepCopy(scene),
    id: ids.clipId,
    name: `${scene.name} (editable copy)`,
    schemaVersion: SCENE_SCHEMA_VERSION,
    objects,
  };

  const landing = project.timeline.filter((c) => c.phase === "LANDING");
  const body = project.timeline.filter((c) => c.phase !== "LANDING");
  const end = body.reduce((m, c) => Math.max(m, c.start + c.transition + c.hold), 0);
  const anchorFormationId =
    (objects[0]?.source.kind === "STATIC" ? objects[0].source.formationId : undefined) ??
    dynamicFormations[0]?.sourceFormationId ??
    formations[0]?.id ??
    clip.formationId;
  const copyClip: TimelineClip = {
    ...deepCopy(clip),
    id: ids.clipId,
    formationId: anchorFormationId,
    start: end,
    transition: Math.max(0.5, clip.transition),
    hold: Math.max(0.5, clip.hold),
    phase: "SHOW",
  };
  // A composed copy is driven by its scene objects, never by a clip-level
  // dynamic reference, so the legacy single-formation fields are dropped.
  delete (copyClip as { dynamicFormationId?: string }).dynamicFormationId;
  const shift = copyClip.transition + copyClip.hold;

  const next: ShowProject = {
    ...project,
    formations: [...project.formations, ...formations],
    dynamicFormations: [...(project.dynamicFormations ?? []), ...dynamicFormations],
    timeline: [...body, copyClip, ...landing.map((c) => ({ ...c, start: c.start + shift }))],
  };
  return { project: upsertScene(next, copyScene), clipId: ids.clipId };
}
