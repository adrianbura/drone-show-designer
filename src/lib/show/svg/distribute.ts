/**
 * Deterministic point distribution primitives.
 *
 * Pure maths only: PRNG, largest-remainder integer allocation, arc-length
 * placement along polylines, point-in-region tests with SVG fill rules,
 * farthest-point selection and constrained relaxation. No React, no DOM, and no
 * trajectory/assignment concepts.
 */
import type { Contour, FillRule, Point2 } from "./types";

/** mulberry32 — small, fast, fully deterministic for a given seed. */
export function makeRng(seed: number): () => number {
  let a = (seed | 0) >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Largest-remainder (Hare quota) allocation. Guarantees
 * `sum(result) === total` exactly, deterministically, and never returns a
 * negative count. `minPer` is applied first, then the remaining budget is
 * distributed proportionally to `weights`.
 */
export function allocateLargestRemainder(
  weights: readonly number[],
  total: number,
  minPer = 0,
): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || total <= 0) return out;

  const base = Math.min(minPer, Math.floor(total / n));
  let remaining = total - base * n;
  for (let i = 0; i < n; i++) out[i] = base;

  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (sum <= 0 || remaining <= 0) {
    // Spread anything left over in a stable round-robin.
    let idx = 0;
    while (remaining > 0) {
      out[idx % n] = (out[idx % n] ?? 0) + 1;
      idx++;
      remaining--;
    }
    return out;
  }

  const ideal = weights.map((w) => (Math.max(0, w) / sum) * remaining);
  const floors = ideal.map((v) => Math.floor(v));
  let assigned = floors.reduce((s, v) => s + v, 0);
  const order = ideal
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || a.i - b.i);
  for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) + (floors[i] ?? 0);
  let k = 0;
  while (assigned < remaining) {
    const target = order[k % n]!.i;
    out[target] = (out[target] ?? 0) + 1;
    assigned++;
    k++;
  }
  return out;
}

export interface ArcTable {
  points: Point2[];
  /** Cumulative length at each vertex; last entry is the total length. */
  cumulative: number[];
  total: number;
  closed: boolean;
}

export function buildArcTable(points: readonly Point2[], closed: boolean): ArcTable {
  const pts = points.map((p) => [p[0], p[1]] as Point2);
  const cumulative: number[] = [0];
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    cumulative.push(cumulative[i]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { points: pts, cumulative, total: cumulative[cumulative.length - 1] ?? 0, closed };
}

/** Position at arc length `s` (clamped for open, wrapped for closed contours). */
export function pointAtArcLength(table: ArcTable, s: number): Point2 {
  const { cumulative, points, total, closed } = table;
  if (points.length === 1 || total <= 1e-12) return points[0]!;
  let d = s;
  if (closed) {
    d = ((s % total) + total) % total;
  } else {
    d = Math.max(0, Math.min(total, s));
  }
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const segLen = cumulative[lo + 1]! - cumulative[lo]!;
  const t = segLen > 1e-12 ? (d - cumulative[lo]!) / segLen : 0;
  const a = points[lo % points.length]!;
  const b = points[(lo + 1) % points.length]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Exactly `count` points spread by equal arc length along one contour. */
export function samplePolylineByArcLength(
  points: readonly Point2[],
  closed: boolean,
  count: number,
  phase = 0,
): Point2[] {
  const table = buildArcTable(points, closed);
  const out: Point2[] = [];
  if (count <= 0) return out;
  if (count === 1) return [pointAtArcLength(table, table.total * 0.5)];
  const step = closed ? table.total / count : table.total / (count - 1);
  for (let i = 0; i < count; i++) out.push(pointAtArcLength(table, phase + i * step));
  return out;
}

/** Winding number / crossing test for one closed polygon. */
function windingContribution(poly: readonly Point2[], x: number, y: number): number {
  let winding = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    if (a[1] <= y) {
      if (b[1] > y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) > 0) winding++;
    } else if (b[1] <= y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) < 0) {
      winding--;
    }
  }
  return winding;
}

function crossingCount(poly: readonly Point2[], x: number, y: number): number {
  let crossings = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    if (a[1] > y !== b[1] > y) {
      const t = (y - a[1]) / (b[1] - a[1]);
      if (x < a[0] + t * (b[0] - a[0])) crossings++;
    }
  }
  return crossings;
}

/**
 * Region membership over a set of closed contours using the given fill rule.
 * Holes (counter-wound subpaths for `nonzero`, overlapping subpaths for
 * `evenodd`) therefore stay empty.
 */
export function isInsideRegion(
  polygons: readonly (readonly Point2[])[],
  x: number,
  y: number,
  rule: FillRule,
): boolean {
  if (rule === "evenodd") {
    let crossings = 0;
    for (const poly of polygons) crossings += crossingCount(poly, x, y);
    return crossings % 2 === 1;
  }
  let winding = 0;
  for (const poly of polygons) winding += windingContribution(poly, x, y);
  return winding !== 0;
}

/**
 * Greedy farthest-point selection (blue-noise-like). Deterministic: the first
 * seed is the candidate closest to the centroid, then each next pick maximises
 * the distance to the already-selected set; ties resolve to the lower index.
 */
export function farthestPointSelection(
  candidates: readonly Point2[],
  count: number,
): Point2[] {
  const n = candidates.length;
  if (count >= n) return candidates.map((p) => [p[0], p[1]] as Point2);
  const out: Point2[] = [];
  const cx = candidates.reduce((s, p) => s + p[0], 0) / n;
  const cy = candidates.reduce((s, p) => s + p[1], 0) / n;
  let first = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = (candidates[i]![0] - cx) ** 2 + (candidates[i]![1] - cy) ** 2;
    if (d < bestD - 1e-12) {
      bestD = d;
      first = i;
    }
  }
  const minDist = new Float64Array(n).fill(Infinity);
  const taken = new Uint8Array(n);
  let current = first;
  for (let k = 0; k < count; k++) {
    taken[current] = 1;
    const p = candidates[current]!;
    out.push([p[0], p[1]]);
    let next = -1;
    let far = -1;
    for (let i = 0; i < n; i++) {
      if (taken[i]) continue;
      const d = (candidates[i]![0] - p[0]) ** 2 + (candidates[i]![1] - p[1]) ** 2;
      if (d < minDist[i]!) minDist[i] = d;
      if (minDist[i]! > far + 1e-12) {
        far = minDist[i]!;
        next = i;
      }
    }
    if (next < 0) break;
    current = next;
  }
  return out;
}

/**
 * Relaxation for OUTLINE points: 1D Lloyd along each contour's arc length, so
 * points can never leave the contour. Deterministic and monotone.
 */
export function relaxAlongContour(
  contourPoints: readonly Point2[],
  closed: boolean,
  count: number,
  iterations: number,
  phase = 0,
): Point2[] {
  const table = buildArcTable(contourPoints, closed);
  if (count <= 0) return [];
  if (table.total <= 1e-9 || count === 1) return samplePolylineByArcLength(contourPoints, closed, count, phase);
  let s = Array.from({ length: count }, (_, i) =>
    closed ? phase + (i * table.total) / count : (i * table.total) / (count - 1),
  );
  for (let it = 0; it < iterations; it++) {
    const next = s.slice();
    for (let i = 0; i < count; i++) {
      if (closed) {
        const prev = s[(i - 1 + count) % count]! - (i === 0 ? table.total : 0);
        const nxt = s[(i + 1) % count]! + (i === count - 1 ? table.total : 0);
        next[i] = (prev + nxt) / 2;
      } else if (i > 0 && i < count - 1) {
        next[i] = (s[i - 1]! + s[i + 1]!) / 2;
      }
    }
    s = next;
  }
  return s.map((v) => pointAtArcLength(table, v));
}

/**
 * Relaxation for FILL points: repulsion from the nearest neighbours, with every
 * step rejected when it would leave the valid region, so points stay inside.
 */
export function relaxInsideRegion(
  pointsIn: readonly Point2[],
  polygons: readonly (readonly Point2[])[],
  rule: FillRule,
  iterations: number,
  stepScale: number,
): Point2[] {
  const pts = pointsIn.map((p) => [p[0], p[1]] as Point2);
  const n = pts.length;
  if (n < 2 || iterations <= 0) return pts;
  for (let it = 0; it < iterations; it++) {
    const moves: Point2[] = [];
    for (let i = 0; i < n; i++) {
      let fx = 0;
      let fy = 0;
      // Nearest few neighbours dominate spacing; full O(n^2) is fine at n<=1000.
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = pts[i]![0] - pts[j]![0];
        const dy = pts[i]![1] - pts[j]![1];
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-12 || d2 > stepScale * stepScale * 9) continue;
        const d = Math.sqrt(d2);
        const w = (stepScale * 3 - d) / (stepScale * 3);
        fx += (dx / d) * w;
        fy += (dy / d) * w;
      }
      const len = Math.hypot(fx, fy);
      if (len < 1e-9) moves.push([0, 0]);
      else moves.push([(fx / len) * stepScale * 0.25, (fy / len) * stepScale * 0.25]);
    }
    for (let i = 0; i < n; i++) {
      const nx = pts[i]![0] + moves[i]![0];
      const ny = pts[i]![1] + moves[i]![1];
      if (isInsideRegion(polygons, nx, ny, rule)) pts[i] = [nx, ny];
    }
  }
  return pts;
}

/** Nearest-neighbour spacing statistics for a static 2D/3D point set. */
export function spacingStats(points: readonly (readonly number[])[]): {
  min: number;
  average: number;
  duplicates: number;
} {
  const n = points.length;
  if (n < 2) return { min: 0, average: 0, duplicates: 0 };
  let min = Infinity;
  let sum = 0;
  let duplicates = 0;
  for (let i = 0; i < n; i++) {
    let nearest = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let d2 = 0;
      const a = points[i]!;
      const b = points[j]!;
      for (let k = 0; k < a.length; k++) d2 += (a[k]! - b[k]!) ** 2;
      if (d2 < nearest) nearest = d2;
    }
    const d = Math.sqrt(nearest);
    if (d < min) min = d;
    sum += d;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d2 = 0;
      const a = points[i]!;
      const b = points[j]!;
      for (let k = 0; k < a.length; k++) d2 += (a[k]! - b[k]!) ** 2;
      if (d2 <= 0.05 * 0.05) duplicates++;
    }
  }
  return { min: Number.isFinite(min) ? min : 0, average: sum / n, duplicates };
}

/** Total contour length of a contour list. */
export function totalLength(contours: readonly Contour[]): number {
  return contours.reduce((s, c) => s + c.length, 0);
}
