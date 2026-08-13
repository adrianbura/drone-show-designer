/**
 * Geometry normalization — SVG user units to show-local metres.
 *
 * Explicit, reusable transform pipeline (no coordinate maths in components):
 *
 *   SVG user units (y down)
 *     -> remove viewBox/bounds origin offset
 *     -> centre on the geometry bounding box
 *     -> flip Y (SVG y-down  ->  show +Y up)
 *     -> normalize to unit extents
 *     -> apply user scale (width / height, aspect lock)
 *     -> apply in-plane rotation
 *     -> apply show-plane orientation
 *     -> apply world position (positionX, altitude, depth)
 *
 * See src/lib/show/coordinates.ts for the canonical axis contract.
 */
import type { Vector3Tuple } from "../types";
import type { Bounds2, Point2, SvgFormationParams, SvgPlaneOrientation } from "./types";

/** Plane-space transform: SVG units -> centred, Y-up metres in the logo plane. */
export interface PlaneTransform {
  /** Scale applied to SVG units on each axis (metres per user unit). */
  scaleX: number;
  scaleY: number;
  /** Resulting plane size in metres. */
  width: number;
  height: number;
  rotationRad: number;
  bounds: Bounds2;
}

export function planeTransform(bounds: Bounds2, params: SvgFormationParams): PlaneTransform {
  const srcW = bounds.width > 1e-9 ? bounds.width : 1;
  const srcH = bounds.height > 1e-9 ? bounds.height : 1;
  const width = Math.max(0.1, params.width);
  const height = params.lockAspect ? (width * srcH) / srcW : Math.max(0.1, params.height);
  return {
    scaleX: width / srcW,
    scaleY: height / srcH,
    width,
    height,
    rotationRad: (params.rotation * Math.PI) / 180,
    bounds,
  };
}

/** SVG user-unit point -> plane metres (centred, +Y up, rotation applied). */
export function toPlane(p: Point2, t: PlaneTransform): Point2 {
  const cx = (t.bounds.minX + t.bounds.maxX) / 2;
  const cy = (t.bounds.minY + t.bounds.maxY) / 2;
  const x = (p[0] - cx) * t.scaleX;
  const y = -(p[1] - cy) * t.scaleY; // flip: SVG y grows downwards
  if (t.rotationRad === 0) return [x, y];
  const c = Math.cos(t.rotationRad);
  const s = Math.sin(t.rotationRad);
  return [x * c - y * s, x * s + y * c];
}

/** Plane metres -> show-local world position. */
export function planeToWorld(
  p: Point2,
  params: SvgFormationParams,
  orientation: SvgPlaneOrientation = params.orientation,
): Vector3Tuple {
  switch (orientation) {
    case "horizontal":
      // Logo lies flat: plane X -> X, plane Y -> Z(depth), altitude constant.
      return [params.positionX + p[0], params.altitude, params.depth + p[1]];
    case "front":
    case "custom":
    default:
      // Vertical wall facing the audience: plane X -> X, plane Y -> altitude.
      return [params.positionX + p[0], params.altitude + p[1], params.depth];
  }
}

/** Full pipeline for a list of SVG-space points. */
export function svgPointsToWorld(
  points: readonly Point2[],
  bounds: Bounds2,
  params: SvgFormationParams,
): Vector3Tuple[] {
  const t = planeTransform(bounds, params);
  return points.map((p) => planeToWorld(toPlane(p, t), params));
}

/** Plane-space points (already metres) -> world. */
export function planePointsToWorld(
  points: readonly Point2[],
  params: SvgFormationParams,
): Vector3Tuple[] {
  return points.map((p) => planeToWorld(p, params));
}
