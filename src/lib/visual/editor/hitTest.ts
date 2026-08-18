/**
 * STRUCTURE EDITOR — selection hit-testing, in DESIGN space.
 *
 * Deterministic: nearest structure wins, ties broken by higher priority then id.
 * A REGION is one logical primitive — clicking anywhere inside it (holes
 * excluded) selects the whole region. Disabled primitives stay selectable so
 * they can be re-enabled.
 */
import type { DesignPoint, VisualFormationDesign, VisualPrimitive } from "../types";

function distanceToSegment(p: DesignPoint, a: DesignPoint, b: DesignPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distanceToPath(
  p: DesignPoint,
  path: readonly DesignPoint[],
  closed: boolean,
): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return Math.hypot(p[0] - path[0]![0], p[1] - path[0]![1]);
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    best = Math.min(best, distanceToSegment(p, path[i]!, path[i + 1]!));
  }
  if (closed) best = Math.min(best, distanceToSegment(p, path[path.length - 1]!, path[0]!));
  return best;
}

export function pointInPolygon(p: DesignPoint, ring: readonly DesignPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const intersects = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Distance of a click to a primitive's strokes, or 0 when inside a region. */
function primitiveDistance(primitive: VisualPrimitive, p: DesignPoint): number {
  switch (primitive.type) {
    case "POLYLINE":
      return distanceToPath(p, primitive.path, false);
    case "CLOSED_CONTOUR":
      return distanceToPath(p, primitive.path, true);
    case "REGION": {
      const edge = distanceToPath(p, primitive.outline, true);
      const inHole = (primitive.holes ?? []).some((hole) => pointInPolygon(p, hole));
      if (!inHole && pointInPolygon(p, primitive.outline)) return 0;
      return edge;
    }
    case "POINT_FEATURE":
      return Math.hypot(p[0] - primitive.position[0], p[1] - primitive.position[1]);
    default:
      return Infinity;
  }
}

/** Returns the selected primitive id, or null when the click hits empty space. */
export function hitTestDesign(
  design: VisualFormationDesign,
  point: DesignPoint,
  tolerance: number,
): string | null {
  let bestId: string | null = null;
  let bestDistance = Infinity;
  let bestPriority = -Infinity;
  for (const primitive of design.primitives) {
    const distance = primitiveDistance(primitive, point);
    if (distance > tolerance) continue;
    const priority = Number.isFinite(primitive.priority) ? primitive.priority : 0;
    const better =
      distance < bestDistance - 1e-9 ||
      (Math.abs(distance - bestDistance) <= 1e-9 &&
        (priority > bestPriority ||
          (priority === bestPriority && bestId !== null && primitive.id < bestId)));
    if (better) {
      bestId = primitive.id;
      bestDistance = distance;
      bestPriority = priority;
    }
  }
  return bestId;
}
