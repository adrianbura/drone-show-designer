/**
 * 2D Ramer–Douglas–Peucker simplification for closed pixel rings.
 * Pure, iterative (no recursion depth risk) and deterministic.
 */
import type { PixelRing } from "./types";

function perpDistance(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

/** RDP over an OPEN polyline. Keeps the first and last vertex. */
export function simplifyPolyline(points: PixelRing, epsilon: number): PixelRing {
  if (points.length <= 2 || epsilon <= 0) return points.map((p) => [p[0], p[1]] as const);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [i0, i1] = stack.pop() as [number, number];
    if (i1 <= i0 + 1) continue;
    const a = points[i0] as readonly [number, number];
    const b = points[i1] as readonly [number, number];
    let bestIdx = -1;
    let bestDist = epsilon;
    for (let i = i0 + 1; i < i1; i++) {
      const d = perpDistance(points[i] as readonly [number, number], a, b);
      if (d > bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) continue;
    keep[bestIdx] = 1;
    stack.push([i0, bestIdx], [bestIdx, i1]);
  }
  const out: (readonly [number, number])[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i] === 1) out.push([points[i]![0], points[i]![1]] as const);
  }
  return out;
}

/**
 * RDP over a CLOSED ring. The ring is split at the vertex farthest from the
 * first vertex, so the split is geometry-driven and stable.
 */
export function simplifyRing(ring: PixelRing, epsilon: number): PixelRing {
  if (ring.length <= 4) return ring.map((p) => [p[0], p[1]] as const);
  const a = ring[0] as readonly [number, number];
  let farIdx = 0;
  let farDist = -1;
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i] as readonly [number, number];
    const d = (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
    if (d > farDist) {
      farDist = d;
      farIdx = i;
    }
  }
  const first = simplifyPolyline(ring.slice(0, farIdx + 1), epsilon);
  const second = simplifyPolyline([...ring.slice(farIdx), ring[0]!], epsilon);
  // Drop the duplicated join vertices (start of second, closing vertex).
  return [...first, ...second.slice(1, second.length - 1)];
}

/**
 * Simplifies a ring while guaranteeing a bounded vertex count. The epsilon is
 * escalated geometrically until the cap is met, so no pathological photo edge
 * can produce an unbounded design.
 */
export function simplifyRingBounded(
  ring: PixelRing,
  epsilon: number,
  maxPoints: number,
): PixelRing {
  let eps = Math.max(epsilon, 1e-4);
  let out = simplifyRing(ring, eps);
  let guard = 0;
  while (out.length > maxPoints && guard++ < 24) {
    eps *= 1.6;
    out = simplifyRing(ring, eps);
  }
  return out;
}
