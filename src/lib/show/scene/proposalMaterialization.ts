import type { Formation, ShowProject, Vector3Tuple } from "../types";
import {
  applyInverseInstanceTransform,
  findStaticSource,
  geometricCentre,
  instancePivot,
} from "./resolve";
import type { FormationScene } from "./types";

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
  readonly derivedFormationId: string | null;
  readonly blocker: SceneProposalMaterializationBlocker | null;
  readonly note: string;
}

function nextDerivedFormationId(project: ShowProject, sceneId: string, objectId: string): string {
  const base = `${sceneId}-${objectId}-geometry`;
  const used = new Set(project.formations.map((formation) => formation.id));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function blocked(
  project: ShowProject,
  blocker: SceneProposalMaterializationBlocker,
  note: string,
): SceneProposalMaterializationResult {
  return { ok: false, project, derivedFormationId: null, blocker, note };
}

/**
 * Materialises a world-space geometry proposal for the narrow scene case that is
 * currently lossless and unambiguous: one STATIC scene object using every point
 * of its source formation.
 *
 * The source formation is NEVER mutated. A project-owned derived custom formation
 * is created and only this scene instance is rebound to it. Explicit pivots are
 * frozen to the original resolved pivots so changing the asset-local points cannot
 * silently move the scene through implicit-centre recomputation.
 *
 * Multi-object, dynamic and sub-sampled scenes intentionally return a blocker.
 * They need point-id-aware materialisation rather than a guessed mapping.
 */
export function materializeStaticSceneGeometryProposal(
  project: ShowProject,
  sceneId: string,
  proposedWorldPoints: readonly Vector3Tuple[],
): SceneProposalMaterializationResult {
  const scene = project.scenes?.find((candidate) => candidate.id === sceneId);
  if (!scene) return blocked(project, "SCENE_NOT_FOUND", `Scene not found: ${sceneId}`);
  if (scene.objects.length !== 1) {
    return blocked(
      project,
      "MULTI_OBJECT_SCENE",
      "Scene proposal materialisation currently requires exactly one scene object.",
    );
  }

  const object = scene.objects[0]!;
  if (object.source.kind !== "STATIC") {
    return blocked(
      project,
      "DYNAMIC_OBJECT_UNSUPPORTED",
      "Dynamic scene geometry needs a time-aware point-id materialiser and is not guessed here.",
    );
  }

  const source = findStaticSource(project, object.source.formationId);
  if (!source) {
    return blocked(project, "SOURCE_FORMATION_MISSING", `Formation not found: ${object.source.formationId}`);
  }
  if (
    object.requestedDroneCount != null &&
    Math.max(1, Math.round(object.requestedDroneCount)) < source.points.length
  ) {
    return blocked(
      project,
      "SUBSAMPLED_OBJECT_UNSUPPORTED",
      "A sub-sampled scene object does not provide a one-to-one proposal point mapping.",
    );
  }
  if (proposedWorldPoints.length !== source.points.length) {
    return blocked(
      project,
      "POINT_COUNT_MISMATCH",
      `Proposal point-count mismatch: ${proposedWorldPoints.length} != ${source.points.length}.`,
    );
  }

  const objectPivot = instancePivot(object.transform, source.points);
  const sceneTransform = scene.transform;
  const scenePivot = sceneTransform.pivot ?? geometricCentre([geometricCentre(source.points)]);

  const derivedPoints = proposedWorldPoints.map((world) => {
    const objectWorld = applyInverseInstanceTransform(world, sceneTransform, scenePivot);
    return applyInverseInstanceTransform(objectWorld, object.transform, objectPivot);
  });

  const derivedFormationId = nextDerivedFormationId(project, scene.id, object.id);
  const derivedFormation: Formation = {
    id: derivedFormationId,
    name: `${source.name} — geometry proposal`,
    kind: "custom",
    points: derivedPoints.map((p) => [p[0], p[1], p[2]] as Vector3Tuple),
    params: {
      derivedFromFormationId: source.id,
      derivation: "projection-preserving-geometry-proposal",
    },
  };

  const materializedScene: FormationScene = {
    ...scene,
    transform: { ...sceneTransform, pivot: scenePivot },
    objects: [
      {
        ...object,
        source: { kind: "STATIC", formationId: derivedFormationId },
        transform: { ...object.transform, pivot: objectPivot },
      },
    ],
  };

  return {
    ok: true,
    project: {
      ...project,
      formations: [...project.formations, derivedFormation],
      scenes: (project.scenes ?? []).map((candidate) =>
        candidate.id === scene.id ? materializedScene : candidate,
      ),
    },
    derivedFormationId,
    blocker: null,
    note:
      "Preview materialisation only. The original formation asset is preserved; this scene is rebound to a derived custom formation with frozen original pivots.",
  };
}
