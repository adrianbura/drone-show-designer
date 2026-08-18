/**
 * SPATIAL FIELDS of the lighting engine (pure maths).
 *
 * Every reveal/sweep effect is ONE generic engine driven by a normalised
 * spatial field `u ∈ [0,1]` per target point. Presets (Left -> Right,
 * Center -> Outside, ...) are configurations of these engines — there is no
 * separate implementation per direction.
 *
 * DIRECTIONAL FIELD
 *   projection = dot(point - origin, normalize(direction))
 *   u          = (projection - minProjection) / (maxProjection - minProjection)
 *
 * RADIAL FIELD
 *   distance = |point - origin|   (PLANAR ignores Z, SPATIAL is full 3D)
 *   u        = distance / maxDistance
 *
 * SOFTNESS
 *   front  f = progress * (1 + w),  w = max(1e-4, softness)
 *   lit(u)   = clamp((f - u) / w, 0, 1)
 *   softness 0 -> hard boundary, softness 1 -> fully gradual band.
 */
import type { Vector3Tuple } from "../types";
import { clamp01, type LightingDistanceMode, type LightingEffectParameters } from "./types";

const EPS = 1e-6;

export function normalizeVector(v: Vector3Tuple): Vector3Tuple {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(length) || length < EPS) return [1, 0, 0];
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Effect direction. `direction` wins when present; otherwise `angleDeg` is read
 * as degrees CCW from +X in the visual X/Y plane (+Y up). Default is +X.
 */
export function resolveDirection(params: LightingEffectParameters): Vector3Tuple {
  if (params.direction) return normalizeVector(params.direction);
  if (typeof params.angleDeg === "number" && Number.isFinite(params.angleDeg)) {
    const rad = (params.angleDeg * Math.PI) / 180;
    return normalizeVector([Math.cos(rad), Math.sin(rad), 0]);
  }
  return [1, 0, 0];
}

export function centreOf(points: readonly Vector3Tuple[]): Vector3Tuple {
  if (points.length === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  return [x / points.length, y / points.length, z / points.length];
}

export interface SpatialField {
  /** Normalised 0..1 field value of a target point. */
  readonly valueAt: (point: Vector3Tuple) => number;
  readonly origin: Vector3Tuple;
}

export function directionalField(
  points: readonly Vector3Tuple[],
  direction: Vector3Tuple,
  origin?: Vector3Tuple | null,
): SpatialField {
  const dir = normalizeVector(direction);
  const base = origin ?? centreOf(points);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const proj = (p[0] - base[0]) * dir[0] + (p[1] - base[1]) * dir[1] + (p[2] - base[2]) * dir[2];
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }
  const span = max - min;
  return {
    origin: base,
    valueAt: (point) => {
      if (!Number.isFinite(span) || span < EPS) return 0;
      const proj =
        (point[0] - base[0]) * dir[0] +
        (point[1] - base[1]) * dir[1] +
        (point[2] - base[2]) * dir[2];
      return clamp01((proj - min) / span);
    },
  };
}

function distance(a: Vector3Tuple, b: Vector3Tuple, mode: LightingDistanceMode): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return mode === "PLANAR" ? Math.hypot(dx, dy) : Math.hypot(dx, dy, dz);
}

export function radialField(
  points: readonly Vector3Tuple[],
  mode: LightingDistanceMode,
  origin?: Vector3Tuple | null,
): SpatialField {
  const base = origin ?? centreOf(points);
  let max = 0;
  for (const p of points) {
    const d = distance(p, base, mode);
    if (d > max) max = d;
  }
  return {
    origin: base,
    valueAt: (point) => (max < EPS ? 0 : clamp01(distance(point, base, mode) / max)),
  };
}

/**
 * Reveal ramp: how lit a point at field value `u` is when the front has
 * travelled `progress`. Continuous and bounded for every softness.
 */
export function revealRamp(progress: number, u: number, softness = 0): number {
  const w = Math.max(1e-4, clamp01(softness));
  const front = clamp01(progress) * (1 + w);
  return clamp01((front - clamp01(u)) / w);
}
