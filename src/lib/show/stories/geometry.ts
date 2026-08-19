/**
 * STORY GEOMETRY — deterministic custom point clouds for narrative scenes.
 *
 * Pure functions, no randomness, no DOM: every generator returns EXACTLY
 * `count` points in show-local metres (+Y up, ground at y = 0), so a story show
 * is reproducible for any fleet size.
 *
 * SPACING CONTRACT
 * A single outline cannot hold 200 drones at flight-safe spacing (a 250 m
 * perimeter fits ~80 drones at 3 m). Every shape is therefore authored as a set
 * of polylines and sampled through `samplePolylines`, which thickens each
 * stroke into as many normal-offset LAYERS as the fleet size requires. The
 * silhouette stays readable and neighbouring drones keep at least `gap` metres.
 */
import type { Vec3 } from "../types";

/** Planar authoring point (X right, Y up); depth is added at sample time. */
type P2 = readonly [number, number];

interface Poly {
  readonly pts: readonly P2[];
  readonly closed?: boolean;
  /** Relative share of the drone budget; defaults to arc length. */
  readonly weight?: number;
  /** Constant Z offset in metres, for shapes that use depth. */
  readonly z?: number;
  /**
   * How extra LAYERS are placed when one stroke cannot hold its drone budget:
   * - "scale": nested copies scaled about the centroid (closed shapes)
   * - "normal": parallel copies offset along the path normal (straight strokes)
   * - "y": copies stacked vertically (ridges, wave lines)
   */
  readonly offsetMode?: "scale" | "normal" | "y";
}

/** Default flight-safe spacing target for story geometry (metres). */
export const STORY_GAP = 4;

/** Splits `count` across parts by weight; leftovers go to the heaviest parts. */
export function splitCount(count: number, weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out = weights.map((w) => Math.floor((count * w) / total));
  const order = weights
    .map((w, i) => [w, i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .map(([, i]) => i);
  let used = out.reduce((a, b) => a + b, 0);
  let k = 0;
  while (used < count) {
    const idx = order[k % order.length]!;
    out[idx] = (out[idx] ?? 0) + 1;
    used++;
    k++;
  }
  while (used > count) {
    const idx = order[k % order.length]!;
    if ((out[idx] ?? 0) > 0) {
      out[idx] = out[idx]! - 1;
      used--;
    }
    k++;
  }
  return out;
}

function polyLength(poly: Poly): number {
  const pts = poly.pts;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  }
  if (poly.closed && pts.length > 2) {
    const a = pts[pts.length - 1]!;
    const b = pts[0]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

/** Equal arc-length samples of one polyline, offset by `off` along its normal. */
function centroid(pts: readonly P2[]): P2 {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  const n = Math.max(1, pts.length);
  return [x / n, y / n];
}

function offsetPoly(poly: Poly, off: number): Poly {
  if (off === 0) return poly;
  const mode = poly.offsetMode ?? (poly.closed ? "scale" : "normal");
  if (mode === "y") return { ...poly, pts: poly.pts.map((p) => [p[0], p[1] + off] as P2) };
  if (mode === "scale") {
    const c = centroid(poly.pts);
    let meanR = 0;
    for (const p of poly.pts) meanR += Math.hypot(p[0] - c[0], p[1] - c[1]);
    meanR = Math.max(1e-3, meanR / Math.max(1, poly.pts.length));
    const f = Math.max(0.15, 1 + off / meanR);
    return { ...poly, pts: poly.pts.map((p) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f] as P2) };
  }
  return poly;
}

function sampleOne(input: Poly, count: number, rawOff: number): Vec3[] {
  const mode = input.offsetMode ?? (input.closed ? "scale" : "normal");
  const poly = mode === "normal" ? input : offsetPoly(input, rawOff);
  const off = mode === "normal" ? rawOff : 0;
  const pts = poly.closed ? [...poly.pts, poly.pts[0]!] : [...poly.pts];
  if (count <= 0) return [];
  if (pts.length < 2) {
    const p = pts[0] ?? [0, 0];
    return Array.from({ length: count }, () => [p[0], p[1], poly.z ?? 0] as Vec3);
  }
  const segLen: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    segLen.push(l);
    total += l;
  }
  const out: Vec3[] = [];
  const divisor = poly.closed ? count : Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    const target = (i / divisor) * total * (poly.closed ? 1 : 1);
    let acc = 0;
    let seg = 0;
    while (seg < segLen.length - 1 && acc + segLen[seg]! < target) {
      acc += segLen[seg]!;
      seg++;
    }
    const l = segLen[seg]! || 1;
    const t = Math.min(1, (target - acc) / l);
    const a = pts[seg]!;
    const b = pts[seg + 1]!;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const tx = (b[0] - a[0]) / l;
    const ty = (b[1] - a[1]) / l;
    out.push([x - ty * off, y + tx * off, poly.z ?? 0]);
  }
  return out;
}

/**
 * Samples a shape (list of polylines) into exactly `count` points, thickening
 * strokes into normal-offset layers so no two drones come closer than ~`gap`.
 */
export function samplePolylines(
  shape: readonly Poly[],
  count: number,
  gap = STORY_GAP,
): Vec3[] {
  /** Nothing may sink below this altitude, whatever the layering produces. */
  const floorY = 8;
  const lengths = shape.map((p) => Math.max(1e-3, polyLength(p)));
  const weights = shape.map((p, i) => p.weight ?? lengths[i]!);
  const budgets = splitCount(count, weights);
  const out: Vec3[] = [];
  shape.forEach((poly, i) => {
    let n = budgets[i]!;
    if (n <= 0) return;
    const perLayer = Math.max(2, Math.floor(lengths[i]! / gap) + 1);
    const layers = Math.max(1, Math.ceil(n / perLayer));
    const share = splitCount(n, Array.from({ length: layers }, () => 1));
    for (let l = 0; l < layers; l++) {
      const off = (l - (layers - 1) / 2) * gap;
      out.push(...sampleOne(poly, share[l]!, off));
    }
    n = 0;
  });
  return out.map((p) => [p[0], Math.max(floorY, p[1]), p[2]] as Vec3);
}

function circle(cx: number, cy: number, r: number, segments = 96, z = 0): Poly {
  const pts: P2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return { pts, closed: true, offsetMode: "scale", z };
}

function line(a: P2, b: P2, z = 0): Poly {
  return { pts: [a, b], z };
}

function heartPath(cx: number, cy: number, scale: number, segments = 120): Poly {
  const pts: P2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([cx + (x / 16) * scale, cy + (y / 16) * scale]);
  }
  return { pts, closed: true, offsetMode: "scale" };
}

/** Two separate souls: two circles side by side. */
export function twoSoulsPoints(count: number, size = 100, altitude = 40): Vec3[] {
  const r = size * 0.17;
  const gap = size * 0.28;
  return samplePolylines(
    [circle(-gap, altitude, r), circle(gap, altitude, r)],
    count,
  );
}

/** Friendship: two circles joined by a bridge of drones. */
export function friendshipPoints(count: number, size = 110, altitude = 42): Vec3[] {
  const r = size * 0.17;
  const gap = size * 0.3;
  return samplePolylines(
    [
      circle(-gap, altitude, r),
      circle(gap, altitude, r),
      { ...line([-gap + r * 1.5, altitude], [gap - r * 1.5, altitude]), offsetMode: "y", weight: 40 },
    ],
    count,
  );
}

/** Adventure: mountain ridge silhouette with a climbing trail. */
export function mountainsPoints(count: number, size = 120, altitude = 16): Vec3[] {
  const half = size / 2;
  const ridge: P2[] = [
    [-half, altitude],
    [-half * 0.62, altitude + size * 0.16],
    [-half * 0.42, altitude + size * 0.42],
    [-half * 0.18, altitude + size * 0.12],
    [0, altitude + size * 0.24],
    [half * 0.26, altitude + size * 0.05],
    [half * 0.5, altitude + size * 0.3],
    [half, altitude],
  ];
  return samplePolylines(
    [
      { pts: ridge, offsetMode: "y" },
      { ...line([-half * 0.9, altitude + 3], [-half * 0.42, altitude + size * 0.4]), weight: 22 },
    ],
    count,
  );
}

/** The sea at night: rolling wave lines plus a moon. */
export function seaAndMoonPoints(count: number, size = 130, altitude = 20): Vec3[] {
  const half = size / 2;
  const wave = (y: number, amp: number, freq: number, z: number): Poly => {
    const pts: P2[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      pts.push([-half + t * size, y + Math.sin(t * Math.PI * freq) * amp]);
    }
    return { pts, offsetMode: "y", z };
  };
  return samplePolylines(
    [
      wave(altitude, size * 0.05, 4, 0),
      wave(altitude + size * 0.1, size * 0.04, 3, -size * 0.14),
      circle(half * 0.5, altitude + size * 0.34, size * 0.1),
    ],
    count,
  );
}

/** The proposal: an engagement ring with a diamond. */
export function engagementRingPoints(count: number, size = 96, altitude = 46): Vec3[] {
  const r = size * 0.28;
  const cy = altitude - r * 0.3;
  const top = cy + r;
  const w = r * 0.55;
  const h = r * 0.6;
  const apex: P2 = [0, top + h * 1.35];
  const left: P2 = [-w, top + h * 0.45];
  const right: P2 = [w, top + h * 0.45];
  return samplePolylines(
    [
      circle(0, cy, r),
      { pts: [left, apex, right], closed: true, weight: 55 },
    ],
    count,
  );
}

/** The wedding: two interlocked rings in crossing planes. */
export function weddingRingsPoints(count: number, size = 110, altitude = 46): Vec3[] {
  const r = size * 0.24;
  const dx = r * 0.85;
  const tilt = (deg: number, pts: Vec3[], cx: number): Vec3[] => {
    const rad = (deg * Math.PI) / 180;
    return pts.map(([x, y, z]) => {
      const lx = x - cx;
      return [cx + lx * Math.cos(rad), y, z + lx * Math.sin(rad)] as Vec3;
    });
  };
  const [a, b] = splitCount(count, [1, 1]) as [number, number];
  return [
    ...tilt(30, samplePolylines([circle(-dx, altitude, r)], a), -dx),
    ...tilt(-30, samplePolylines([circle(dx, altitude, r)], b), dx),
  ];
}

/** Two hearts beating as one: a large heart holding a smaller inner heart. */
export function doubleHeartPoints(count: number, size = 110, altitude = 46): Vec3[] {
  return samplePolylines(
    [heartPath(0, altitude, size * 0.44), heartPath(0, altitude, size * 0.2)],
    count,
  );
}

/** Fireworks: radial starburst spokes at staggered radii and depths. */
export function fireworksBurstPoints(count: number, size = 120, altitude = 52): Vec3[] {
  const spokes = 16;
  const rOuter = size * 0.38;
  const polys: Poly[] = [];
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * Math.PI * 2;
    const inner = rOuter * 0.34;
    polys.push({
      pts: [
        [Math.cos(a) * inner, altitude + Math.sin(a) * inner],
        [Math.cos(a) * rOuter, altitude + Math.sin(a) * rOuter],
      ],
      offsetMode: "normal",
      z: Math.sin(s * 2.399) * size * 0.1,
    });
  }
  return samplePolylines(polys, count);
}

/** Equal-length samples along an open 3D polyline (no layering). */
export function samplePath3D(pts: readonly Vec3[], count: number): Vec3[] {
  if (count <= 0) return [];
  if (pts.length < 2) return Array.from({ length: count }, () => (pts[0] ?? [0, 1, 0]) as Vec3);
  const segLen: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    segLen.push(l);
    total += l;
  }
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const target = (count === 1 ? 0.5 : i / (count - 1)) * total;
    let acc = 0;
    let seg = 0;
    while (seg < segLen.length - 1 && acc + segLen[seg]! < target) {
      acc += segLen[seg]!;
      seg++;
    }
    const l = segLen[seg]! || 1;
    const t = Math.min(1, (target - acc) / l);
    const a = pts[seg]!;
    const b = pts[seg + 1]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/** Falling in love: two intertwined helices climbing into one. */
export function loveSpiralPoints(count: number, radius = 24, base = 18, height = 56): Vec3[] {
  const [a, b] = splitCount(count, [1, 1]) as [number, number];
  const strand = (phase: number): Vec3[] => {
    const pts: Vec3[] = [];
    const steps = 240;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = phase + t * Math.PI * 2 * 3;
      const r = radius * (1 - t * 0.55);
      pts.push([Math.cos(ang) * r, base + t * height, Math.sin(ang) * r]);
    }
    return pts;
  };
  return [...samplePath3D(strand(0), a), ...samplePath3D(strand(Math.PI), b)];
}

/** A single big heart outline, layered for flight-safe spacing. */
export function heartPoints(count: number, size = 112, altitude = 44): Vec3[] {
  return samplePolylines([heartPath(0, altitude, size * 0.46)], count);
}

/**
 * Finale sphere: a Fibonacci shell whose radius grows with the fleet size so
 * neighbouring drones keep at least ~STORY_GAP metres.
 */
export function sphereShellPoints(count: number, altitude = 52, gap = STORY_GAP): Vec3[] {
  const r = Math.max(18, gap * Math.sqrt(Math.max(1, count) / (4 * Math.PI)) * 1.25);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * golden;
    out.push([Math.cos(a) * rr * r, altitude + y * r, Math.sin(a) * rr * r]);
  }
  return out;
}

/**
 * Final safety relaxation: deterministic pairwise repulsion that separates any
 * drones closer than `minGap` while keeping the authored silhouette. Runs after
 * geometry generation so no story formation can violate the separation profile.
 */
export function enforceSpacing(
  points: readonly Vec3[],
  minGap = 3,
  iterations = 600,
  minAltitude = 6,
): Vec3[] {
  const pts = points.map((p) => [p[0], p[1], p[2]] as [number, number, number]);
  const n = pts.length;
  for (let it = 0; it < iterations; it++) {
    let violated = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let dz = b[2] - a[2];
        let d = Math.hypot(dx, dy, dz);
        if (d >= minGap) continue;
        violated = true;
        if (d < 1e-6) {
          // Deterministic tie-break for coincident points.
          dx = Math.cos(i * 1.7) * 1e-3;
          dy = Math.sin(j * 2.3) * 1e-3;
          dz = Math.cos(j * 0.9) * 1e-3;
          d = Math.hypot(dx, dy, dz);
        }
        const push = ((minGap - d) / d) * 0.5;
        const ox = dx * push;
        const oy = dy * push;
        const oz = dz * push;
        a[0] -= ox;
        a[1] -= oy;
        a[2] -= oz;
        b[0] += ox;
        b[1] += oy;
        b[2] += oz;
        if (a[1] < minAltitude) a[1] = minAltitude;
        if (b[1] < minAltitude) b[1] = minAltitude;
      }
    }
    if (!violated) break;
  }
  return pts.map((p) => [p[0], p[1], p[2]] as Vec3);
}
