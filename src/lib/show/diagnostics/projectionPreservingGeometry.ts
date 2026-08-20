/**
 * PROJECTION-PRESERVING GEOMETRY PROPOSALS — PURE / READ-ONLY.
 *
 * These helpers do not mutate formations, do not alter planner output and are
 * never consulted by safety or export. They answer a narrower design question:
 * "If a point is moved to a different depth along the audience ray, where must
 * it be placed so its apparent audience-plane coordinate remains unchanged?"
 *
 * This is a mathematical proposal primitive only. Whether such a move is useful,
 * flyable, safe or desirable must be decided elsewhere after normal validation.
 */
import type { Vector3Tuple } from "../types";
import {
  audienceViewBasis,
  projectPointForAudience,
  type AudienceView,
} from "./audienceProjection";

const EPS = 1e-9;

type Vec3 = readonly [number, number, number];

const add = (a: Vec3, b: Vec3): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): [number, number, number] => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

export interface ProjectionPreservingMove {
  readonly index: number;
  readonly original: Vector3Tuple;
  readonly proposed: Vector3Tuple;
  /** Signed change in distance from the viewer along the view axis, metres. */
  readonly depthDelta: number;
  readonly displacement3D: number;
  /** Perspective-plane error after reconstruction; numerical noise only. */
  readonly apparentError: number;
}

export interface ProjectionPreservingProposal {
  readonly moves: readonly ProjectionPreservingMove[];
  readonly maxDisplacement: number;
  readonly rmsDisplacement: number;
  readonly maxApparentError: number;
  readonly note: string;
}

export class ProjectionPreservingGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionPreservingGeometryError";
  }
}

/**
 * Reconstructs the unique world point at `distanceAlongView` whose perspective
 * image coordinate equals `imageCoordinate` on the audience target plane.
 */
export function worldPointForAudienceImage(
  imageCoordinate: readonly [number, number],
  distanceAlongView: number,
  view: AudienceView,
): Vector3Tuple {
  if (!Number.isFinite(imageCoordinate[0]) || !Number.isFinite(imageCoordinate[1])) {
    throw new ProjectionPreservingGeometryError("image coordinate must be finite");
  }
  if (!Number.isFinite(distanceAlongView) || distanceAlongView <= EPS) {
    throw new ProjectionPreservingGeometryError("distanceAlongView must be finite and greater than zero");
  }

  const basis = audienceViewBasis(view);
  const targetPlanePoint = add(
    view.target,
    add(scale(basis.right, imageCoordinate[0]), scale(basis.up, imageCoordinate[1])),
  );
  const rayAtTargetPlane = sub(targetPlanePoint, view.viewer);
  return add(view.viewer, scale(rayAtTargetPlane, distanceAlongView / basis.targetDistance));
}

/**
 * Moves one point to a requested audience-axis depth while preserving the exact
 * perspective image coordinate it had before the move.
 */
export function movePointPreservingAudienceProjection(
  point: Vector3Tuple,
  newDistanceAlongView: number,
  view: AudienceView,
  index = 0,
): ProjectionPreservingMove {
  const projected = projectPointForAudience(point, view);
  if (!projected) {
    throw new ProjectionPreservingGeometryError("point is invalid or lies at/behind the viewer");
  }
  const proposed = worldPointForAudienceImage(projected.perspective, newDistanceAlongView, view);
  const verify = projectPointForAudience(proposed, view);
  if (!verify) throw new ProjectionPreservingGeometryError("proposed point cannot be projected");
  const apparentError = Math.hypot(
    verify.perspective[0] - projected.perspective[0],
    verify.perspective[1] - projected.perspective[1],
  );
  return {
    index,
    original: [...point] as Vector3Tuple,
    proposed,
    depthDelta: newDistanceAlongView - projected.distanceAlongView,
    displacement3D: length(sub(proposed, point)),
    apparentError,
  };
}

/**
 * Applies explicit per-point audience-axis depth deltas to a point cloud.
 *
 * Deltas are supplied by the caller deliberately; this function does NOT invent
 * staggering, choose thresholds, optimise safety, or decide which points move.
 */
export function proposeProjectionPreservingDepthDeltas(
  points: readonly Vector3Tuple[],
  depthDeltas: readonly number[],
  view: AudienceView,
): ProjectionPreservingProposal {
  if (points.length !== depthDeltas.length) {
    throw new ProjectionPreservingGeometryError(
      `point/delta count mismatch (${points.length} points, ${depthDeltas.length} deltas)`,
    );
  }

  const moves = points.map((point, index) => {
    const projected = projectPointForAudience(point, view);
    if (!projected) {
      throw new ProjectionPreservingGeometryError(`point ${index} is invalid or lies at/behind the viewer`);
    }
    const delta = depthDeltas[index]!;
    if (!Number.isFinite(delta)) {
      throw new ProjectionPreservingGeometryError(`depth delta ${index} is not finite`);
    }
    return movePointPreservingAudienceProjection(
      point,
      projected.distanceAlongView + delta,
      view,
      index,
    );
  });

  let maxDisplacement = 0;
  let sum2 = 0;
  let maxApparentError = 0;
  for (const move of moves) {
    maxDisplacement = Math.max(maxDisplacement, move.displacement3D);
    sum2 += move.displacement3D * move.displacement3D;
    maxApparentError = Math.max(maxApparentError, move.apparentError);
  }

  return {
    moves,
    maxDisplacement,
    rmsDisplacement: moves.length ? Math.sqrt(sum2 / moves.length) : 0,
    maxApparentError,
    note:
      "PROPOSAL ONLY. Perspective silhouette is preserved for the supplied audience view, but flight safety, altitude, show-area and trajectory consequences are not evaluated here.",
  };
}
