/**
 * DRONE ART COMPILER — deterministic sampling primitives.
 *
 * Pure index maths: no PRNG state that survives a call, no rejection loops that
 * can spin, no network. Every function returns EXACTLY the requested number of
 * design-space points for valid input.
 */
import type { DesignPoint } from "./types";

/** Deterministic low-discrepancy sequence — no seeds, no state. */
export function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index + 1;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

export function polylineLength(path: readonly DesignPoint[], closed: boolean): number {
  let total = 0;
  const n = path.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = path[i]!;
    const b = path[(i + 1) % n]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

/** Cumulative arc-length table for a path. */
function arcTable(path: readonly DesignPoint[], closed: boolean): number[] {
  const table = [0];
  const n = path.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = path[i]!;
    const b = path[(i + 1) % n]!;
    table.push(table[table.length - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return table;
}

function pointAtLength(
  path: readonly DesignPoint[],
  table: readonly number[],
  closed: boolean,
  s: number,
): DesignPoint {
  const total = table[table.length - 1]!;
  if (total <= 0) return path[0]!;
  const target = Math.min(Math.max(s, 0), total);
  let lo = 0;
  let hi = table.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid]! <= target) lo = mid;
    else hi = mid;
  }
  const segStart = table[lo]!;
  const segLen = table[lo + 1]! - segStart || 1;
  const t = (target - segStart) / segLen;
  const a = path[lo]!;
  const b = path[(lo + 1) % path.length]!;
  void closed;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Indices of high-curvature vertices (corners) in path order. Corners such as a
 * heart tip, a beak or a wing tip must be represented even at low point counts.
 */
export function cornerIndices(
  path: readonly DesignPoint[],
  closed: boolean,
  thresholdDeg = 40,
): number[] {
  const n = path.length;
  const out: number[] = [];
  const from = closed ? 0 : 1;
  const to = closed ? n : n - 1;
  for (let i = from; i < to; i++) {
    const prev = path[(i - 1 + n) % n]!;
    const cur = path[i]!;
    const next = path[(i + 1) % n]!;
    const a = [cur[0] - prev[0], cur[1] - prev[1]] as const;
    const b = [next[0] - cur[0], next[1] - cur[1]] as const;
    const la = Math.hypot(a[0], a[1]);
    const lb = Math.hypot(b[0], b[1]);
    if (la === 0 || lb === 0) continue;
    const cos = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)));
    const turn = (Math.acos(cos) * 180) / Math.PI;
    if (turn >= thresholdDeg) out.push(i);
  }
  return out;
}

/**
 * Arc-length uniform sampling with deterministic corner snapping. Source vertex
 * density never biases the result; corners are preserved by moving the nearest
 * sample onto the corner vertex (each corner claims at most one sample).
 */
export function sampleCurve(
  path: readonly DesignPoint[],
  count: number,
  closed: boolean,
): DesignPoint[] {
  if (count <= 0 || path.length === 0) return [];
  if (path.length === 1 || count === 1) return [path[0]!];
  const table = arcTable(path, closed);
  const total = table[table.length - 1]!;
  const out: DesignPoint[] = [];
  const positions: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = closed ? i / count : count === 1 ? 0 : i / (count - 1);
    positions.push(u * total);
  }
  for (const s of positions) out.push(pointAtLength(path, table, closed, s));

  // Corner preservation: snap the closest unclaimed sample to each corner.
  const corners = cornerIndices(path, closed);
  if (corners.length > 0 && count >= corners.length) {
    const claimed = new Set<number>();
    for (const ci of corners) {
      const target = table[ci] ?? 0;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < positions.length; i++) {
        if (claimed.has(i)) continue;
        const d = Math.abs(positions[i]! - target);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        claimed.add(best);
        out[best] = path[ci]!;
      }
    }
  }
  return out;
}

/** Even-odd point-in-polygon test. */
export function insidePolygon(point: DesignPoint, polygon: readonly DesignPoint[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from a point to a polygon boundary. */
export function distanceToBoundary(point: DesignPoint, polygon: readonly DesignPoint[]): number {
  let best = Infinity;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1e-12;
    let t = ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / len2;
    t = Math.min(1, Math.max(0, t));
    best = Math.min(best, Math.hypot(point[0] - (a[0] + vx * t), point[1] - (a[1] + vy * t)));
  }
  return best;
}

export function polygonArea(polygon: readonly DesignPoint[]): number {
  let sum = 0;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    sum += polygon[j]![0] * polygon[i]![1] - polygon[i]![0] * polygon[j]![1];
  }
  return Math.abs(sum) / 2;
}

export function polygonBounds(polygon: readonly DesignPoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Deterministic region fill. A fixed-length Halton scan is filtered by the
 * region test, then a bounded relaxation pass spreads the retained candidates —
 * blue-noise-like, but with a hard iteration bound (never an unstable loop).
 * If the scan cannot find enough interior candidates the remaining points fall
 * back to arc-length samples of the outline, so the count stays EXACT.
 */
export function sampleRegion(
  outline: readonly DesignPoint[],
  holes: readonly (readonly DesignPoint[])[],
  count: number,
  seed: number,
): DesignPoint[] {
  if (count <= 0 || outline.length < 3) return [];
  const { minX, minY, maxX, maxY } = polygonBounds(outline);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const area = polygonArea(outline);
  // Boundary inset scales with the expected spacing so points stay inside.
  const spacing = Math.sqrt(Math.max(area, 1e-9) / Math.max(count, 1));
  const inset = spacing * 0.25;
  const offset = Math.abs(Math.trunc(seed)) % 997;
  const candidates: DesignPoint[] = [];
  const scan = Math.max(64, count * 40);
  for (let i = 0; i < scan && candidates.length < count; i++) {
    const idx = i + offset;
    const p: DesignPoint = [minX + halton(idx, 2) * spanX, minY + halton(idx, 3) * spanY];
    if (!insidePolygon(p, outline)) continue;
    if (distanceToBoundary(p, outline) < inset) continue;
    let inHole = false;
    for (const hole of holes) {
      if (insidePolygon(p, hole)) {
        inHole = true;
        break;
      }
    }
    if (inHole) continue;
    candidates.push(p);
  }
  // Relaxation: nudge points apart from their nearest neighbour, bounded.
  const pts = candidates.map((p) => [p[0], p[1]] as [number, number]);
  const target = spacing * 0.9;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < pts.length; i++) {
      let nx = 0;
      let ny = 0;
      let hits = 0;
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue;
        const dx = pts[i]![0] - pts[j]![0];
        const dy = pts[i]![1] - pts[j]![1];
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < target) {
          nx += (dx / d) * (target - d) * 0.3;
          ny += (dy / d) * (target - d) * 0.3;
          hits++;
        }
      }
      if (hits === 0) continue;
      const moved: DesignPoint = [pts[i]![0] + nx, pts[i]![1] + ny];
      if (insidePolygon(moved, outline) && distanceToBoundary(moved, outline) >= inset * 0.5) {
        pts[i] = [moved[0], moved[1]];
      }
    }
  }
  const out: DesignPoint[] = pts.map((p) => [p[0], p[1]] as DesignPoint);
  if (out.length < count) {
    const fill = sampleCurve(outline, count - out.length, true);
    out.push(...fill);
  }
  return out.slice(0, count);
}

/** Localised feature: 1 point at the position, more on tight concentric rings. */
export function samplePointFeature(
  position: DesignPoint,
  count: number,
  spread: number,
): DesignPoint[] {
  if (count <= 0) return [];
  const out: DesignPoint[] = [position];
  const remaining = count - 1;
  for (let i = 0; i < remaining; i++) {
    const ring = Math.floor(i / 6) + 1;
    const slot = i % 6;
    const angle = (slot / 6) * Math.PI * 2 + ring * 0.4;
    const r = spread * (ring / Math.max(1, Math.ceil(remaining / 6)));
    out.push([position[0] + Math.cos(angle) * r, position[1] + Math.sin(angle) * r]);
  }
  return out.slice(0, count);
}

/** Deterministic 3D-prepared parametric samplers (Earth / orbit future cases). */
export function sampleParametricCurve(
  kind: "CIRCLE" | "ELLIPSE" | "HELIX",
  params: Readonly<Record<string, number>>,
  center: DesignPoint,
  count: number,
): { xy: DesignPoint; z: number }[] {
  const out: { xy: DesignPoint; z: number }[] = [];
  const rx = params["rx"] ?? params["r"] ?? 0.5;
  const ry = kind === "CIRCLE" ? rx : (params["ry"] ?? rx);
  const turns = params["turns"] ?? 1;
  const height = params["height"] ?? 0;
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0 : i / count;
    const angle = u * Math.PI * 2 * (kind === "HELIX" ? turns : 1);
    out.push({
      xy: [center[0] + Math.cos(angle) * rx, center[1] + Math.sin(angle) * ry],
      z: kind === "HELIX" ? (u - 0.5) * height : 0,
    });
  }
  return out;
}

export function sampleParametricSurface(
  kind: "SPHERE" | "ELLIPSOID" | "PLANE_PATCH",
  params: Readonly<Record<string, number>>,
  center: DesignPoint,
  count: number,
): { xy: DesignPoint; z: number }[] {
  const out: { xy: DesignPoint; z: number }[] = [];
  const rx = params["rx"] ?? params["r"] ?? 0.5;
  const ry = params["ry"] ?? rx;
  const rz = params["rz"] ?? rx;
  if (kind === "PLANE_PATCH") {
    for (let i = 0; i < count; i++) {
      out.push({
        xy: [center[0] + (halton(i, 2) - 0.5) * 2 * rx, center[1] + (halton(i, 3) - 0.5) * 2 * ry],
        z: 0,
      });
    }
    return out;
  }
  // Fibonacci sphere — deterministic, near-uniform.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push({
      xy: [center[0] + Math.cos(theta) * radius * rx, center[1] + y * ry],
      z: Math.sin(theta) * radius * rz,
    });
  }
  return out;
}
