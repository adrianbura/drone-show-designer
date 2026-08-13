/**
 * Adaptive curve flattening and 2D affine transform helpers.
 *
 * Cubics are subdivided recursively until they are flat within `tolerance`
 * (measured in the target space, after the CTM is applied), so curvature-heavy
 * regions get more resolution without exploding the intermediate point count.
 */
import type { Segment, SubPath } from "./paths";
import type { Bounds2, Matrix2D, Point2 } from "./types";

export const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix2D, n: Matrix2D): Matrix2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMatrix(m: Matrix2D, x: number, y: number): Point2 {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Mean linear scale factor of a matrix — used to keep tolerance meaningful. */
export function matrixScale(m: Matrix2D): number {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  const s = (sx + sy) / 2;
  return s > 1e-9 ? s : 1;
}

const MAX_DEPTH = 18;

function flatEnough(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  tol: number,
): boolean {
  const dx = x3 - x0;
  const dy = y3 - y0;
  const d1 = Math.abs((x1 - x3) * dy - (y1 - y3) * dx);
  const d2 = Math.abs((x2 - x3) * dy - (y2 - y3) * dx);
  const dd = (d1 + d2) ** 2;
  return dd <= tol * tol * (dx * dx + dy * dy) || (Math.hypot(dx, dy) < tol && d1 + d2 < tol);
}

function subdivideCubic(
  out: Point2[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  tol: number,
  depth: number,
): void {
  if (depth >= MAX_DEPTH || flatEnough(x0, y0, x1, y1, x2, y2, x3, y3, tol)) {
    out.push([x3, y3]);
    return;
  }
  const x01 = (x0 + x1) / 2;
  const y01 = (y0 + y1) / 2;
  const x12 = (x1 + x2) / 2;
  const y12 = (y1 + y2) / 2;
  const x23 = (x2 + x3) / 2;
  const y23 = (y2 + y3) / 2;
  const x012 = (x01 + x12) / 2;
  const y012 = (y01 + y12) / 2;
  const x123 = (x12 + x23) / 2;
  const y123 = (y12 + y23) / 2;
  const xm = (x012 + x123) / 2;
  const ym = (y012 + y123) / 2;
  subdivideCubic(out, x0, y0, x01, y01, x012, y012, xm, ym, tol, depth + 1);
  subdivideCubic(out, xm, ym, x123, y123, x23, y23, x3, y3, tol, depth + 1);
}

/**
 * Flattens one subpath into a polyline expressed in the matrix target space.
 * Consecutive duplicate points are collapsed.
 */
export function flattenSubPath(sub: SubPath, ctm: Matrix2D, tolerance: number): Point2[] {
  const tol = Math.max(1e-4, tolerance);
  const points: Point2[] = [];
  let [cx, cy] = applyMatrix(ctm, sub.start[0], sub.start[1]);
  points.push([cx, cy]);
  for (const seg of sub.segments as Segment[]) {
    if (seg.t === "L") {
      const p = applyMatrix(ctm, seg.x, seg.y);
      points.push(p);
      cx = p[0];
      cy = p[1];
    } else {
      const c1 = applyMatrix(ctm, seg.x1, seg.y1);
      const c2 = applyMatrix(ctm, seg.x2, seg.y2);
      const e = applyMatrix(ctm, seg.x, seg.y);
      subdivideCubic(points, cx, cy, c1[0], c1[1], c2[0], c2[1], e[0], e[1], tol, 0);
      cx = e[0];
      cy = e[1];
    }
  }
  const cleaned: Point2[] = [];
  for (const p of points) {
    const last = cleaned[cleaned.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > tol * 0.05) cleaned.push(p);
  }
  if (sub.closed && cleaned.length > 2) {
    const first = cleaned[0]!;
    const last = cleaned[cleaned.length - 1]!;
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= tol * 0.05) cleaned.pop();
  }
  return cleaned;
}

export function polylineLength(points: readonly Point2[], closed: boolean): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  if (closed && points.length > 2) {
    const a = points[points.length - 1]!;
    const b = points[0]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

export function boundsOf(points: readonly Point2[]): Bounds2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
