import type { Formation, ShowProject, Vector3Tuple } from "../types";
import { applyInverseInstanceTransform } from "./inverseTransform";
import { findStaticSource, geometricCentre, instancePivot, subsampleIndices } from "./resolve";
import type { FormationScene, SceneFormationInstance } from "./types";

const GEOMETRY_PROPOSAL_DERIVATION = "projection-preserving-geometry-proposal";

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

function derivedIdBase(sceneId: string, objectId: string): string {
  return `${sceneId}-${objectId}-geometry`;
}

function isGeometryProposalFormation(formation: Formation): boolean {
  return formation.params?.derivation === GEOMETRY_PROPOSAL_DERIVATION;
}

/**
 * Resolve durable provenance instead of chaining proposal -> proposal -> proposal
 * on repeated Apply. This metadata never replaces the actual current source used
 * by inverse transforms.
 */
function rootSourceFormationId(project: ShowProject, source: Formation): string {
  const byId = new Map(project.formations.map((formation) => [formation.id, formation] as const));
  const seen = new Set<string>();
  let current = source;
  while (isGeometryProposalFormation(current)) {
    const candidate = current.params?.rootFormationId ?? current.params?.derivedFromFormationId;
    if (typeof candidate !== "string" || !candidate || seen.has(candidate)) break;
    seen.add(candidate);
    const next = byId.get(candidate);
    if (!next) return candidate;
    current = next;
  }
  return current.id;
}

function referencedOutsideObject(
  project: ShowProject,
  formationId: string,
  sceneId: string,
  objectId: string,
): boolean {
  if (project.timeline.some((clip) => clip.formationId === formationId)) return true;
  for (const scene of project.scenes ?? []) {
    for (const object of scene.objects) {
      if (scene.id === sceneId && object.id === objectId) continue;
      if (object.source.kind === "STATIC" && object.source.formationId === formationId) return true;
    }
  }
  return false;
}

/**
 * Repeated Apply on one scene object must not leak an unbounded sequence of
 * project-owned derived formations. Reuse is allowed only when the current
 * proposal formation clearly belongs to this object and nobody else references
 * it. History still preserves the previous Formation object, so undo remains exact.
 */
function reusableDerivedFormationId(
  project: ShowProject,
  source: Formation,
  sceneId: string,
  objectId: string,
): string | null {
  const expectedBase = derivedIdBase(sceneId, objectId);
  const ownedByMetadata =
    source.params?.derivedForSceneId === sceneId && source.params?.derivedForObjectId === objectId;
  const ownedByLegacyId =
    isGeometryProposalFormation(source) &&
    (source.id === expectedBase || source.id.startsWith(`${expectedBase}-`));
  if (!ownedByMetadata && !ownedByLegacyId) return null;
  if (referencedOutsideObject(project, source.id, sceneId, objectId)) return null;
  return source.id;
}

function nextDerivedFormationId(
  used: Set<string>,
  sceneId: string,
  objectId: string,
): string {
  const base = derivedIdBase(sceneId, objectId);
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
 * each object's used points become project-owned custom geometry.
 *
 * Re-applying a proposal to an object that already owns an unshared proposal
 * formation REPLACES that formation at a stable id instead of appending another
 * derivation layer. Provenance stays rooted at the original reusable asset. If
 * that current derived formation is referenced elsewhere, a fresh id is used so
 * no other clip/scene can be altered accidentally.
 *
 * A sub-sampled object intentionally derives only the points that participate in
 * this scene. Explicit object and scene pivots are frozen from the ORIGINAL
 * resolved base points so rebinding cannot move the composition through implicit
 * centre changes.
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
  const replaceIds = new Set<string>();
  const reboundByObjectId = new Map<string, SceneFormationInstance>();

  for (const entry of prepared.objects) {
    const slice = proposedWorldPoints.slice(entry.offset, entry.offset + entry.base.length);
    const derivedPoints = slice.map((world) => {
      const objectWorld = applyInverseInstanceTransform(world, sceneTransform, scenePivot);
      return applyInverseInstanceTransform(objectWorld, entry.object.transform, entry.pivot);
    });
    const reusableId = reusableDerivedFormationId(project, entry.source, scene.id, entry.object.id);
    const derivedFormationId = reusableId ?? nextDerivedFormationId(usedIds, scene.id, entry.object.id);
    if (reusableId) replaceIds.add(reusableId);
    const rootFormationId = rootSourceFormationId(project, entry.source);
    derivedFormations.push({
      id: derivedFormationId,
      name: `${entry.source.name.replace(/ — geometry proposal$/, "")} — geometry proposal`,
      kind: "custom",
      points: derivedPoints.map((point) => [point[0], point[1], point[2]] as Vector3Tuple),
      params: {
        derivedFromFormationId: rootFormationId,
        rootFormationId,
        derivedForSceneId: scene.id,
        derivedForObjectId: entry.object.id,
        derivation: GEOMETRY_PROPOSAL_DERIVATION,
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
      formations: [
        ...project.formations.filter((formation) => !replaceIds.has(formation.id)),
        ...derivedFormations,
      ],
      scenes: (project.scenes ?? []).map((candidate) =>
        candidate.id === scene.id ? materializedScene : candidate,
      ),
    },
    derivedFormationId: derivedFormationIds.length === 1 ? derivedFormationIds[0]! : null,
    derivedFormationIds,
    blocker: null,
    note:
      "Preview materialisation only. Each static scene object is rebound to derived project-owned geometry; original reusable assets are preserved, repeated proposals reuse unshared scene-owned derived ids, and resolved world-space proposal points round-trip through the existing scene transform hierarchy.",
  };
}
