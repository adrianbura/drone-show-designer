import type { Formation, ShowProject, Vector3Tuple } from "../types";
import { applyInverseInstanceTransform } from "./inverseTransform";
import { findStaticSource, geometricCentre, instancePivot, subsampleIndices } from "./resolve";
import type { FormationScene, SceneFormationInstance } from "./types";

export type SceneProposalMaterializationBlocker =
  | "SCENE_NOT_FOUND"
  | "MULTI_OBJECT_SCENE"
  | "DYNAMIC_OBJECT_UNSUPPORTED"
  | "SOURCE_FORMATION_MISSING"
  | "SUBSAMPLED_OBJECT_UNSUPPORTED"
  | "POINT_COUNT_MISMATCH";

export interface SceneProposalMaterializationResult {
  readonly ok: boolean;
  readonly project: ShowProject;
  /** Backward-compatible convenience for a one-object scene. */
  readonly derivedFormationId: string | null;
  /** One derived project-owned formation per materialized STATIC scene object. */
  readonly derivedFormationIds: readonly string[];
  readonly blocker: SceneProposalMaterializationBlocker | null;
  readonly note: string;
}

function blocked(
  project: ShowProject,
  blocker: SceneProposalMaterializationBlocker,
  note: string,
): SceneProposalMaterializationResult {
  return {
    ok: false,
    project,
    derivedFormationId: null,
    derivedFormationIds: [],
    blocker,
    note,
  };
}

interface PreparedStaticObject {
  readonly object: SceneFormationInstance;
  readonly source: Formation;
  readonly indices: readonly number[];
  readonly base: readonly Vector3Tuple[];
  readonly pivot: Vector3Tuple;
  readonly offset: number;
}

function prepareStaticObjects(
  project: ShowProject,
  scene: FormationScene,
): { readonly objects: readonly PreparedStaticObject[]; readonly pointCount: number } | SceneProposalMaterializationResult {
  const objects: PreparedStaticObject[] = [];
  let offset = 0;
  for (const object of scene.objects) {
    if (object.source.kind !== "STATIC") {
      return blocked(
        project,
        "DYNAMIC_OBJECT_UNSUPPORTED",
        "Dynamic scene geometry needs a time-aware point-id materialiser and is not guessed here.",
      );
    }
    const source = findStaticSource(project, object.source.formationId);
    if (!source) {
      return blocked(
        project,
        "SOURCE_FORMATION_MISSING",
        `Formation not found: ${object.source.formationId}`,
      );
    }
    const requested = object.requestedDroneCount ?? source.points.length;
    const indices = subsampleIndices(source.points.length, Math.max(1, Math.round(requested)));
    const base = indices.map((index) => source.points[index]!);
    objects.push({
      object,
      source,
      indices,
      base,
      pivot: instancePivot(object.transform, base),
      offset,
    });
    offset += base.length;
  }
  return { objects, pointCount: offset };
}

function nextDerivedFormationId(
  used: Set<string>,
  sceneId: string,
  objectId: string,
): string {
  const base = `${sceneId}-${objectId}-geometry`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  used.add(id);
  return id;
}

/**
 * Materialises a world-space proposal for STATIC scene geometry without mutating
 * reusable source assets.
 *
 * Resolution order is deterministic: scene object order, then each object's
 * deterministic `subsampleIndices` order — exactly the same order used by
 * `resolveSceneAt`. The proposed combined world-space point cloud is split by
 * those stable group offsets, inverted through SCENE -> OBJECT transforms, and
 * each object's used points become a new project-owned custom formation.
 *
 * This means multi-object and sub-sampled STATIC scenes are lossless: a
 * sub-sampled object intentionally derives only the points that participate in
 * this scene. Original source assets remain untouched. Explicit object and scene
 * pivots are frozen from the ORIGINAL resolved base points so rebinding to the
 * derived assets cannot move the composition through implicit-centre changes.
 *
 * DYNAMIC objects remain blocked because a single current-frame point cloud is
 * insufficient to reconstruct their time-varying local geometry honestly.
 */
export function materializeStaticSceneGeometryProposal(
  project: ShowProject,
  sceneId: string,
  proposedWorldPoints: readonly Vector3Tuple[],
): SceneProposalMaterializationResult {
  const scene = project.scenes?.find((candidate) => candidate.id === sceneId);
  if (!scene) return blocked(project, "SCENE_NOT_FOUND", `Scene not found: ${sceneId}`);

  const prepared = prepareStaticObjects(project, scene);
  if ("ok" in prepared) return prepared;
  if (proposedWorldPoints.length !== prepared.pointCount) {
    return blocked(
      project,
      "POINT_COUNT_MISMATCH",
      `Proposal point-count mismatch: ${proposedWorldPoints.length} != ${prepared.pointCount}.`,
    );
  }

  const sceneTransform = scene.transform;
  const scenePivot =
    sceneTransform.pivot ?? geometricCentre(prepared.objects.map((entry) => geometricCentre(entry.base)));
  const usedIds = new Set(project.formations.map((formation) => formation.id));
  const derivedFormations: Formation[] = [];
  const reboundByObjectId = new Map<string, SceneFormationInstance>();

  for (const entry of prepared.objects) {
    const slice = proposedWorldPoints.slice(entry.offset, entry.offset + entry.base.length);
    const derivedPoints = slice.map((world) => {
      const objectWorld = applyInverseInstanceTransform(world, sceneTransform, scenePivot);
      return applyInverseInstanceTransform(objectWorld, entry.object.transform, entry.pivot);
    });
    const derivedFormationId = nextDerivedFormationId(usedIds, scene.id, entry.object.id);
    derivedFormations.push({
      id: derivedFormationId,
      name: `${entry.source.name} — geometry proposal`,
      kind: "custom",
      points: derivedPoints.map((point) => [point[0], point[1], point[2]] as Vector3Tuple),
      params: {
        derivedFromFormationId: entry.source.id,
        derivation: "projection-preserving-geometry-proposal",
        sourcePointIndices: entry.indices.join(","),
      },
    });
    reboundByObjectId.set(entry.object.id, {
      ...entry.object,
      source: { kind: "STATIC", formationId: derivedFormationId },
      requestedDroneCount: derivedPoints.length,
      transform: { ...entry.object.transform, pivot: entry.pivot },
    });
  }

  const materializedScene: FormationScene = {
    ...scene,
    transform: { ...sceneTransform, pivot: scenePivot },
    objects: scene.objects.map((object) => reboundByObjectId.get(object.id) ?? object),
  };
  const derivedFormationIds = derivedFormations.map((formation) => formation.id);

  return {
    ok: true,
    project: {
      ...project,
      formations: [...project.formations, ...derivedFormations],
      scenes: (project.scenes ?? []).map((candidate) =>
        candidate.id === scene.id ? materializedScene : candidate,
      ),
    },
    derivedFormationId: derivedFormationIds.length === 1 ? derivedFormationIds[0]! : null,
    derivedFormationIds,
    blocker: null,
    note:
      "Preview materialisation only. Each static scene object is rebound to a derived project-owned formation; original assets are preserved and resolved world-space proposal points round-trip through the existing scene transform hierarchy.",
  };
}
