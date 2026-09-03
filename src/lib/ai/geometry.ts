/**
 * Deterministic concept geometry for the choreography assistant.
 *
 * Everything here is pure index maths: the same request always produces the
 * exact same point cloud, and the requested fleet size is honoured EXACTLY
 * (largest-remainder part allocation, no rejection sampling, no drift).
 */
import type { Vec3 } from "../show/types";
import type { ChoreographyPart } from "./types";

/** Deterministic low-discrepancy sequence — no PRNG state, no seeds needed. */
function halton(index: number, base: number): number {
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

/**
 * Splits `total` into per-part counts matching `weights` exactly using the
 * largest-remainder method, so the sum is always `total`.
 */
export function allocateParts<K extends string>(
  total: number,
  weights: readonly (readonly [K, number])[],
): Record<K, number> {
  const sumWeights = weights.reduce((s, [, w]) => s + w, 0) || 1;
  const raw = weights.map(([key, w]) => {
    const exact = (total * w) / sumWeights;
    const floor = Math.floor(exact);
    return { key, floor, rest: exact - floor };
  });
  let assigned = raw.reduce((s, r) => s + r.floor, 0);
  const order = [...raw].sort((a, b) => b.rest - a.rest || a.key.localeCompare(b.key));
  let cursor = 0;
  while (assigned < total && order.length > 0) {
    order[cursor % order.length]!.floor += 1;
    assigned += 1;
    cursor += 1;
  }
  // Over-allocation can only happen for a zero-weight part list; trim from the end.
  for (let i = order.length - 1; assigned > total && i >= 0; i--) {
    const take = Math.min(order[i]!.floor, assigned - total);
    order[i]!.floor -= take;
    assigned -= take;
  }
  const out = {} as Record<K, number>;
  for (const r of raw) out[r.key] = r.floor;
  return out;
}

export interface PartGeometry {
  readonly part: ChoreographyPart;
  /** Indices into the returned point array. */
  readonly indices: readonly number[];
  /** Local rotation pivot of the part (wing root for wings). */
  readonly pivot: Vec3;
}

export interface ConceptGeometry {
  readonly points: Vec3[];
  readonly parts: readonly PartGeometry[];
}

export interface WingedOptions {
  readonly count: number;
  /** Wingspan in metres (X extent). */
  readonly span: number;
  /** Body length in metres (Z extent). */
  readonly bodyLength: number;
  /** Centre altitude in metres. */
  readonly altitude: number;
  /** Butterfly wings are broader and rounder than a bird's. */
  readonly broadWings?: boolean;
  readonly includeHeadTail?: boolean;
}

export interface WomanProfileOptions {
  readonly count: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly altitude: number;
}

type ProfileVertex = readonly [number, number, number];
type ProfilePart = "FACE" | "HAIR" | "NECK";

function samplePolyline(vertices: readonly ProfileVertex[], count: number): Vec3[] {
  if (count <= 0 || vertices.length === 0) return [];
  if (vertices.length === 1) return Array.from({ length: count }, () => [...vertices[0]!] as Vec3);
  const segments = vertices.slice(0, -1).map((from, index) => {
    const to = vertices[index + 1]!;
    return { from, to, length: Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  return Array.from({ length: count }, (_, index) => {
    let distance = ((index + 0.5) / count) * total;
    let segment = segments.at(-1)!;
    for (const candidate of segments) {
      if (distance <= candidate.length) {
        segment = candidate;
        break;
      }
      distance -= candidate.length;
    }
    const t = segment.length > 0 ? Math.min(1, distance / segment.length) : 0;
    return [
      segment.from[0] + (segment.to[0] - segment.from[0]) * t,
      segment.from[1] + (segment.to[1] - segment.from[1]) * t,
      segment.from[2] + (segment.to[2] - segment.from[2]) * t,
    ];
  });
}

function sampleLayeredPolyline(
  vertices: readonly ProfileVertex[],
  count: number,
  depthOffsets: readonly number[],
): Vec3[] {
  const layerCounts = allocateParts(
    count,
    depthOffsets.map((_, index) => [String(index), 1] as const),
  );
  return depthOffsets.flatMap((offset, index) =>
    samplePolyline(vertices, layerCounts[String(index)] ?? 0).map(
      ([x, y, z]) => [x, y, z + offset] as Vec3,
    ),
  );
}

/**
 * Audience-facing 2.5D female profile. The recognisable face contour stays on
 * the front depth layer, while hair and shoulders occupy separate shallow Z
 * layers. This preserves silhouette readability from the front without
 * pretending to be a dense mesh or bypassing later trajectory validation.
 */
export function buildWomanProfileGeometry(options: WomanProfileOptions): ConceptGeometry {
  const { count, width, height, depth, altitude } = options;
  const counts = allocateParts(count, [
    ["FACE" as const, 0.41],
    ["HAIR" as const, 0.44],
    ["NECK" as const, 0.15],
  ]);
  const point = (x: number, y: number, z: number): ProfileVertex => [
    x * width,
    altitude + y * height,
    z * depth,
  ];
  const facePoint = (x: number, y: number, z = 0): ProfileVertex => point(x, y, 0.32 + z);
  const hairPoint = (x: number, y: number, z = 0): ProfileVertex => point(x, y, -0.32 + z);
  const neckPoint = (x: number, y: number, z = 0): ProfileVertex => point(x, y, z);
  const definitions: readonly {
    part: ProfilePart;
    pivot: Vec3;
    vertices: readonly ProfileVertex[];
    depthOffsets: readonly number[];
  }[] = [
    {
      part: "FACE",
      pivot: facePoint(-0.02, 0.05),
      depthOffsets: [-2.8, 0, 2.8],
      vertices: [
        facePoint(-0.08, 0.43),
        facePoint(0.08, 0.34),
        facePoint(0.14, 0.22),
        facePoint(0.27, 0.12),
        facePoint(0.16, 0.07),
        facePoint(0.21, 0.01),
        facePoint(0.15, -0.04),
        facePoint(0.2, -0.1),
        facePoint(0.12, -0.19),
        facePoint(0.02, -0.27),
        facePoint(-0.08, -0.29),
      ],
    },
    {
      part: "HAIR",
      pivot: hairPoint(-0.12, 0.34),
      depthOffsets: [-2.8, 0, 2.8],
      vertices: [
        hairPoint(-0.08, 0.43),
        hairPoint(-0.24, 0.46),
        hairPoint(-0.38, 0.35),
        hairPoint(-0.45, 0.18),
        hairPoint(-0.43, -0.04),
        hairPoint(-0.4, -0.3),
        hairPoint(-0.34, -0.48),
        hairPoint(-0.23, -0.32),
        hairPoint(-0.17, -0.48),
        hairPoint(-0.1, -0.28),
        hairPoint(-0.08, -0.05),
        hairPoint(-0.04, 0.18),
        hairPoint(-0.08, 0.43),
      ],
    },
    {
      part: "NECK",
      pivot: neckPoint(0, -0.35, 0.9),
      depthOffsets: [-1.4, 1.4],
      vertices: [
        neckPoint(-0.08, -0.29, 0.9),
        neckPoint(-0.06, -0.43, 0.9),
        neckPoint(0.08, -0.5, 0.9),
        neckPoint(0.38, -0.51, 0.9),
        neckPoint(0.15, -0.4, 0.9),
        neckPoint(0.12, -0.19, 0.9),
      ],
    },
  ];
  const points: Vec3[] = [];
  const parts: PartGeometry[] = [];
  for (const definition of definitions) {
    const start = points.length;
    const generated = sampleLayeredPolyline(
      definition.vertices,
      counts[definition.part] ?? 0,
      definition.depthOffsets,
    );
    points.push(...generated);
    parts.push({
      part: definition.part,
      indices: generated.map((_, index) => start + index),
      pivot: definition.pivot,
    });
  }
  return { points, parts };
}

/**
 * Front-facing winged creature: wings span X, the body runs along Z (depth) and
 * flapping rotates each wing about Z around its root, which is why wing tips
 * travel vertically for the audience.
 */
export function buildWingedGeometry(options: WingedOptions): ConceptGeometry {
  const { count, span, bodyLength: L, altitude } = options;
  const broad = options.broadWings === true;
  const withHeadTail = options.includeHeadTail !== false;
  const rootX = 0.08 * span;

  const weights: (readonly [ChoreographyPart, number])[] = withHeadTail
    ? [
        ["BODY", broad ? 0.2 : 0.3],
        ["LEFT_WING", broad ? 0.36 : 0.29],
        ["RIGHT_WING", broad ? 0.36 : 0.29],
        ["HEAD", 0.05],
        ["TAIL", 0.07],
      ]
    : [
        ["BODY", 0.24],
        ["LEFT_WING", 0.38],
        ["RIGHT_WING", 0.38],
      ];
  const counts = allocateParts(count, weights);

  const points: Vec3[] = [];
  const parts: PartGeometry[] = [];

  const push = (
    part: ChoreographyPart,
    n: number,
    pivot: Vec3,
    make: (i: number, n: number) => Vec3,
  ) => {
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      indices.push(points.length);
      points.push(make(i, n));
    }
    parts.push({ part, indices, pivot });
  };

  // BODY — slim vertical spindle along Z, centred on the pivot.
  push("BODY", counts.BODY ?? 0, [0, altitude, 0], (i, n) => {
    const u = n === 1 ? 0.5 : (i + 0.5) / n;
    const z = -0.45 * L + u * L;
    const taper = 1 - Math.abs(2 * u - 1) * 0.55;
    const r = 0.05 * span * taper;
    const theta = i * 2.399963229728653;
    return [Math.cos(theta) * r * 0.7, altitude + Math.sin(theta) * r, z];
  });

  // WINGS — swept planform, sampled stratified spanwise x low-discrepancy chordwise.
  for (const [part, sign] of [
    ["LEFT_WING", -1],
    ["RIGHT_WING", 1],
  ] as const) {
    push(part, counts[part] ?? 0, [sign * rootX, altitude, 0], (i, n) => {
      const u = n === 1 ? 0.5 : (i + 0.5) / n;
      const v = halton(i, 2);
      const x = sign * (rootX + u * (0.5 * span - rootX));
      const chord = broad ? L * (0.95 - 0.25 * u) : L * (0.6 - 0.35 * u);
      const lead = broad ? 0.45 * L - 0.1 * L * u : 0.2 * L - 0.3 * L * u;
      const z = lead - v * chord;
      const dihedral = (broad ? 0.02 : 0.05) * span * u;
      return [x, altitude + dihedral, z];
    });
  }

  if (withHeadTail) {
    push("HEAD", counts.HEAD ?? 0, [0, altitude, 0.6 * L], (i, n) => {
      const r = 0.055 * span;
      const theta = i * 2.399963229728653;
      const y = n === 1 ? 0 : ((i + 0.5) / n) * 2 - 1;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      return [
        Math.cos(theta) * r * ring,
        altitude + 0.03 * span + y * r,
        0.6 * L + Math.sin(theta) * r * ring,
      ];
    });
    push("TAIL", counts.TAIL ?? 0, [0, altitude, -0.45 * L], (i, n) => {
      const u = n === 1 ? 0.5 : (i + 0.5) / n;
      const v = halton(i, 3);
      const spread = 0.16 * span * (u - 0.5) * 2;
      return [spread, altitude - 0.01 * span * v, -0.45 * L - v * 0.3 * L];
    });
  }

  return { points, parts };
}

/** Five-pointed star outline, evenly distributed along the perimeter. */
export function starPoints(count: number, size: number, altitude: number, arms = 5): Vec3[] {
  const outer = size / 2;
  const inner = outer * 0.42;
  const verts: [number, number][] = [];
  for (let i = 0; i < arms * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / arms;
    verts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const edges = verts.map((v, i) => {
    const w = verts[(i + 1) % verts.length]!;
    return { from: v, to: w, len: Math.hypot(w[0] - v[0], w[1] - v[1]) };
  });
  const perimeter = edges.reduce((s, e) => s + e.len, 0);
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    let target = ((i + 0.5) / count) * perimeter;
    let edge = edges[0]!;
    for (const e of edges) {
      if (target <= e.len) {
        edge = e;
        break;
      }
      target -= e.len;
    }
    const f = edge.len > 0 ? target / edge.len : 0;
    const x = edge.from[0] + (edge.to[0] - edge.from[0]) * f;
    const y = edge.from[1] + (edge.to[1] - edge.from[1]) * f;
    out.push([x, altitude + y, 0]);
  }
  return out;
}

/** Vertical spiral (helical ribbon) rising through the show volume. */
export function spiralPoints(count: number, size: number, altitude: number, turns = 3): Vec3[] {
  const out: Vec3[] = [];
  const radius = size / 2;
  const rise = Math.max(6, size * 0.5);
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0.5 : i / (count - 1);
    const a = u * turns * Math.PI * 2;
    const r = radius * (0.25 + 0.75 * u);
    out.push([Math.cos(a) * r, altitude - rise / 2 + u * rise, Math.sin(a) * r]);
  }
  return out;
}

/** Single-line ring (hollow circle) in the XZ plane. */
export function ringPoints(count: number, size: number, altitude: number): Vec3[] {
  const r = size / 2;
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push([Math.cos(a) * r, altitude, Math.sin(a) * r]);
  }
  return out;
}

/** Yaw about the vertical axis through the cloud's own vertical axis at origin. */
export function rotateYaw(points: readonly Vec3[], degrees: number): Vec3[] {
  if (!degrees) return points.map((p) => [p[0], p[1], p[2]] as Vec3);
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return points.map(([x, y, z]) => [x * c + z * s, y, -x * s + z * c] as Vec3);
}
