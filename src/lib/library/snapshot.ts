/**
 * Snapshot primitives shared by every asset kind.
 *
 * Kept in its own module so the scene-asset code and the formation-asset code
 * can both use them without a circular import.
 */
import type { Vec3 } from "../show/types";
import type { AssetThumbnail } from "./types";

/** JSON round-trip clone — keeps assets plain, serialisable and detached. */
export function structuredClonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Normalised top-down thumbnail (X right, Z up in screen space). */
export function thumbnailFromPoints(points: readonly Vec3[], maxPoints = 400): AssetThumbnail {
  if (points.length === 0) return { points: [] };
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const picked: Vec3[] = [];
  for (let i = 0; i < points.length; i += step) picked.push(points[i]!);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of picked) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const span = Math.max(spanX, spanY);
  return {
    points: picked.map(
      (p) =>
        [
          Number((((p[0] - minX) / span + (1 - spanX / span) / 2)).toFixed(4)),
          Number((((p[1] - minY) / span + (1 - spanY / span) / 2)).toFixed(4)),
        ] as const,
    ),
  };
}
