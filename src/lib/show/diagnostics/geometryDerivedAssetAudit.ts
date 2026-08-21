import type { Formation, ShowProject } from "../types";

const DERIVATION = "projection-preserving-geometry-proposal";

export interface GeometryDerivedAssetUsage {
  readonly formationId: string;
  readonly rootFormationId: string | null;
  readonly derivedForSceneId: string | null;
  readonly derivedForObjectId: string | null;
  readonly timelineClipIds: readonly string[];
  readonly sceneObjectRefs: readonly { readonly sceneId: string; readonly objectId: string }[];
  readonly referenceCount: number;
  readonly orphaned: boolean;
  readonly shared: boolean;
  readonly ownershipMismatch: boolean;
}

export interface GeometryDerivedAssetAuditReport {
  readonly derivedAssetCount: number;
  readonly orphanedFormationIds: readonly string[];
  readonly sharedFormationIds: readonly string[];
  readonly ownershipMismatchFormationIds: readonly string[];
  readonly assets: readonly GeometryDerivedAssetUsage[];
  readonly note: string;
}

function stringParam(formation: Formation, key: string): string | null {
  const value = formation.params[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isGeometryDerived(formation: Formation): boolean {
  return stringParam(formation, "derivation") === DERIVATION;
}

/**
 * READ-ONLY lifecycle audit for formations created by Geometry Proposal.
 *
 * It deliberately performs no cleanup. A derived formation may still be needed
 * by undo/redo snapshots, save/reopen compatibility, or another scene. This
 * report only identifies project-level references so a later cleanup authority
 * can make an explicit decision rather than deleting assets opportunistically.
 */
export function auditGeometryDerivedAssets(project: ShowProject): GeometryDerivedAssetAuditReport {
  const timelineRefs = new Map<string, string[]>();
  for (const clip of project.timeline) {
    const refs = timelineRefs.get(clip.formationId) ?? [];
    refs.push(clip.id);
    timelineRefs.set(clip.formationId, refs);
  }

  const sceneRefs = new Map<string, { sceneId: string; objectId: string }[]>();
  for (const scene of project.scenes ?? []) {
    for (const object of scene.objects) {
      if (object.source.kind !== "STATIC") continue;
      const refs = sceneRefs.get(object.source.formationId) ?? [];
      refs.push({ sceneId: scene.id, objectId: object.id });
      sceneRefs.set(object.source.formationId, refs);
    }
  }

  const assets = project.formations
    .filter(isGeometryDerived)
    .map((formation): GeometryDerivedAssetUsage => {
      const timelineClipIds = [...(timelineRefs.get(formation.id) ?? [])].sort();
      const objectRefs = [...(sceneRefs.get(formation.id) ?? [])].sort(
        (a, b) => a.sceneId.localeCompare(b.sceneId) || a.objectId.localeCompare(b.objectId),
      );
      const referenceCount = timelineClipIds.length + objectRefs.length;
      const derivedForSceneId = stringParam(formation, "derivedForSceneId");
      const derivedForObjectId = stringParam(formation, "derivedForObjectId");
      const ownershipMismatch =
        objectRefs.length > 0 &&
        (!!derivedForSceneId || !!derivedForObjectId) &&
        objectRefs.some(
          (ref) =>
            (derivedForSceneId !== null && ref.sceneId !== derivedForSceneId) ||
            (derivedForObjectId !== null && ref.objectId !== derivedForObjectId),
        );

      return {
        formationId: formation.id,
        rootFormationId:
          stringParam(formation, "rootFormationId") ?? stringParam(formation, "derivedFromFormationId"),
        derivedForSceneId,
        derivedForObjectId,
        timelineClipIds,
        sceneObjectRefs: objectRefs,
        referenceCount,
        orphaned: referenceCount === 0,
        shared: referenceCount > 1,
        ownershipMismatch,
      };
    })
    .sort((a, b) => a.formationId.localeCompare(b.formationId));

  return {
    derivedAssetCount: assets.length,
    orphanedFormationIds: assets.filter((asset) => asset.orphaned).map((asset) => asset.formationId),
    sharedFormationIds: assets.filter((asset) => asset.shared).map((asset) => asset.formationId),
    ownershipMismatchFormationIds: assets
      .filter((asset) => asset.ownershipMismatch)
      .map((asset) => asset.formationId),
    assets,
    note:
      "READ-ONLY PROJECT HYGIENE AUDIT. Orphan/shared findings are not safety findings and do not change export eligibility. Cleanup must account for undo/redo and persisted project history before removing derived assets.",
  };
}
