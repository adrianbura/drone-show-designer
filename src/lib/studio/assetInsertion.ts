/**
 * LIBRARY ASSET INSERTION (pure).
 *
 * "Use in show" is ONE authoring action for every asset kind. These helpers map
 * (project, asset) -> next project so the store can commit it with exactly one
 * history snapshot and one project update: copied formations, copied dynamic
 * formations, the new scene, the new clip and the LANDING shift all land
 * together, and one Ctrl+Z removes the whole instance.
 *
 * The library asset itself is never modified — insertion only ever copies.
 */
import {
  dynamicFormationFromAsset,
  formationFromAsset,
  instantiateSceneAsset,
  sceneAssetDuration,
  type FormationAsset,
} from "../library";
import { upsertScene } from "../show/scene";
import type { DynamicFormation } from "../show/dynamic";
import type { Formation, ShowProject, TimelineClip } from "../show/types";
import { insertClipBeforeLanding } from "./clipInsertion";
import { defaultPhaseForNewClip } from "./timelineEdit";

export interface AssetInsertionIds {
  readonly clipId: string;
  /** Fresh project-owned formation id (index provided for scene dependencies). */
  readonly formationId: (index: number) => string;
  readonly dynamicFormationId: (index: number) => string;
}

export interface AssetInsertionTiming {
  readonly transition?: number;
  readonly hold?: number;
}

export interface AssetInsertionResult {
  readonly project: ShowProject;
  readonly clipId: string;
  /** Scene object ids of the inserted clip, in author order (SCENE assets). */
  readonly sceneObjectIds: readonly string[];
  /** Dynamic formation bound to the clip, when the asset is dynamic. */
  readonly dynamicFormationId: string | null;
}

function baseClip(
  project: ShowProject,
  id: string,
  formationId: string,
  timing: AssetInsertionTiming,
  defaults: { transition: number; hold: number },
): TimelineClip {
  return {
    id,
    formationId,
    start: 0, // canonical start is assigned by insertClipBeforeLanding
    transition: Math.max(0.5, timing.transition ?? defaults.transition),
    hold: Math.max(0, timing.hold ?? defaults.hold),
    easing: "minJerk",
    color: [140, 210, 255],
    effect: "solid",
    phase: defaultPhaseForNewClip(project.timeline),
  };
}

/** STATIC asset: one copied formation + one clip. */
export function insertStaticAsset(
  project: ShowProject,
  asset: FormationAsset,
  ids: AssetInsertionIds,
  timing: AssetInsertionTiming = {},
): AssetInsertionResult {
  const formation: Formation = formationFromAsset(asset, ids.formationId(0));
  const clip = baseClip(project, ids.clipId, formation.id, timing, { transition: 8, hold: 6 });
  return {
    project: {
      ...project,
      formations: [...project.formations, formation],
      timeline: insertClipBeforeLanding(project.timeline, clip),
    },
    clipId: clip.id,
    sceneObjectIds: [],
    dynamicFormationId: null,
  };
}

/** DYNAMIC asset: one copied dynamic formation + one clip bound to it. */
export function insertDynamicAsset(
  project: ShowProject,
  asset: FormationAsset,
  ids: AssetInsertionIds,
  timing: AssetInsertionTiming = {},
): AssetInsertionResult {
  const dynamic: DynamicFormation = dynamicFormationFromAsset(asset, ids.dynamicFormationId(0));
  const sourceId =
    dynamic.sourceFormationId && project.formations.some((f) => f.id === dynamic.sourceFormationId)
      ? dynamic.sourceFormationId
      : (project.formations[0]?.id ?? "");
  const clip: TimelineClip = {
    ...baseClip(project, ids.clipId, sourceId, timing, { transition: 10, hold: 0 }),
    // A dynamic clip holds for at least one full animation cycle.
    hold: Math.max(timing.hold ?? 0, dynamic.duration, 4),
    dynamicFormationId: dynamic.id,
    playbackRate: 1,
    dynamicStartOffset: 0,
  };
  return {
    project: {
      ...project,
      dynamicFormations: [...(project.dynamicFormations ?? []), dynamic],
      timeline: insertClipBeforeLanding(project.timeline, clip),
    },
    clipId: clip.id,
    sceneObjectIds: [],
    dynamicFormationId: dynamic.id,
  };
}

/**
 * SCENE asset: copied dependencies + a project-owned scene bound to the new clip
 * (`scene.id === clip.id`). Always planner-owned, even for an ESSP-derived asset.
 */
export function insertSceneAsset(
  project: ShowProject,
  asset: FormationAsset,
  ids: AssetInsertionIds,
  timing: AssetInsertionTiming = {},
): AssetInsertionResult {
  const clipId = ids.clipId;
  const instance = instantiateSceneAsset(asset, {
    sceneId: clipId,
    formationId: ids.formationId,
    dynamicFormationId: ids.dynamicFormationId,
  });
  const cycle = sceneAssetDuration(asset);
  const anchorFormationId =
    instance.formations[0]?.id ??
    instance.dynamicFormations[0]?.sourceFormationId ??
    project.formations[0]?.id ??
    "";
  const clip: TimelineClip = {
    ...baseClip(project, clipId, anchorFormationId, timing, { transition: 8, hold: 6 }),
    hold: Math.max(timing.hold ?? 6, cycle),
  };
  const withContent: ShowProject = {
    ...project,
    formations: [...project.formations, ...instance.formations],
    dynamicFormations: [...(project.dynamicFormations ?? []), ...instance.dynamicFormations],
    timeline: insertClipBeforeLanding(project.timeline, clip),
  };
  return {
    project: upsertScene(withContent, instance.scene),
    clipId,
    sceneObjectIds: instance.scene.objects.map((o) => o.id),
    dynamicFormationId: null,
  };
}

/** Single entry point used by the Library "Use in show" command. */
export function insertLibraryAsset(
  project: ShowProject,
  asset: FormationAsset,
  ids: AssetInsertionIds,
  timing: AssetInsertionTiming = {},
): AssetInsertionResult {
  switch (asset.formationData.kind) {
    case "SCENE":
      return insertSceneAsset(project, asset, ids, timing);
    case "DYNAMIC":
      return insertDynamicAsset(project, asset, ids, timing);
    default:
      return insertStaticAsset(project, asset, ids, timing);
  }
}
