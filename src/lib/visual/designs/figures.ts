/**
 * SHAPE & FIGURE LIBRARY — built-in artistic figures.
 *
 * Every figure here is authored from pure parametric geometry in design space
 * (X right, Y up, normalised units), so the same figure compiles identically at
 * any drone count. No copyrighted artwork is stored or traced.
 *
 * Figures are ordinary `VisualFormationDesign`s: the Drone Art Compiler and the
 * formation library treat them exactly like the hand-authored designs. Simple
 * parametric clouds (circle, sphere, helix) stay in src/lib/show/formations.ts.
 */
import {
  VISUAL_DESIGN_SCHEMA_VERSION,
  type DesignPoint,
  type FillBias,
  type SemanticPart,
  type VisualFormationDesign,
  type VisualPrimitive,
  type VisualStyle,
} from "../types";
import { circlePath, ellipsePath, mirrorPath } from "./util";

const TAU = Math.PI * 2;

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function path(points: readonly DesignPoint[]): DesignPoint[] {
  return points.map(([x, y]) => [round(x), round(y)] as DesignPoint);
}

function samplePolar(segments: number, fn: (t: number) => DesignPoint): DesignPoint[] {
  return path(Array.from({ length: segments }, (_, i) => fn(i / segments)));
}

function arcPath(
  center: DesignPoint,
  rx: number,
  ry: number,
  fromDeg: number,
  toDeg: number,
  segments = 16,
): DesignPoint[] {
  return path(
    Array.from({ length: segments + 1 }, (_, i) => {
      const a = ((fromDeg + ((toDeg - fromDeg) * i) / segments) * Math.PI) / 180;
      return [center[0] + Math.cos(a) * rx, center[1] + Math.sin(a) * ry] as DesignPoint;
    }),
  );
}

function extent(paths: readonly (readonly DesignPoint[])[]): { width: number; height: number } {
  const xs = paths.flat().map((p) => p[0]);
  const ys = paths.flat().map((p) => p[1]);
  return {
    width: round(Math.max(...xs) - Math.min(...xs)),
    height: round(Math.max(...ys) - Math.min(...ys)),
  };
}

interface FigureInput {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly notes: string;
  readonly primitives: readonly VisualPrimitive[];
  readonly parts?: readonly SemanticPart[];
  readonly symmetry?: "NONE" | "MIRROR_X" | "MIRROR_Y";
  readonly defaultStyle?: VisualStyle;
  readonly fillBias?: FillBias;
  readonly defaultPointCount?: number;
}

function figure(input: FigureInput): VisualFormationDesign {
  const outlines = input.primitives.map((p) =>
    p.type === "POLYLINE" || p.type === "CLOSED_CONTOUR"
      ? p.path
      : p.type === "REGION"
        ? p.outline
        : p.type === "POINT_FEATURE"
          ? [p.position]
          : [],
  );
  const { width, height } = extent(outlines.filter((list) => list.length > 0));
  return {
    schemaVersion: VISUAL_DESIGN_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    version: 1,
    mode: input.parts && input.parts.length > 0 ? "SEMANTIC_2D" : "CONTOUR_2D",
    coordinateSpace: "DESIGN_XY",
    symmetry: input.symmetry ?? "MIRROR_X",
    bounds: { width: Math.max(0.1, width), height: Math.max(0.1, height), depth: 0 },
    defaultStyle: input.defaultStyle ?? "OUTLINE",
    defaultPointCount: input.defaultPointCount ?? 150,
    fillBias: input.fillBias ?? "CONTOUR_HEAVY",
    spacingTarget: 0.03,
    primitives: input.primitives,
    semanticParts: input.parts ?? [],
    metadata: {
      sourceType: "BUILT_IN",
      tags: ["figure", ...input.tags],
      notes: input.notes,
    },
  };
}

/* ------------------------------------------------------------------ heart */

const HEART_OUTLINE = samplePolar(56, (t) => {
  const a = t * TAU;
  const x = 16 * Math.sin(a) ** 3;
  const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
  return [x / 34, y / 34];
});

export const HEART_FIGURE = figure({
  id: "figure-heart",
  name: "Heart",
  tags: ["heart", "symbol", "love"],
  notes: "Classic parametric heart curve, filled interior available at high counts.",
  fillBias: "BALANCED",
  primitives: [
    {
      id: "heart-outline",
      type: "CLOSED_CONTOUR",
      priority: 1,
      essential: true,
      minPoints: 24,
      color: [255, 60, 90],
      path: HEART_OUTLINE,
    },
    {
      id: "heart-fill",
      type: "REGION",
      priority: 0.45,
      color: [220, 40, 80],
      outline: HEART_OUTLINE,
    },
  ],
});

/* ------------------------------------------------------------------- star */

function starPath(points: number, outer: number, inner: number, rotationDeg = -90): DesignPoint[] {
  const out: DesignPoint[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (rotationDeg * Math.PI) / 180 + (i / (points * 2)) * TAU;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return path(out);
}

const STAR_OUTLINE = starPath(5, 0.5, 0.21);

export const STAR_FIGURE = figure({
  id: "figure-star",
  name: "Star (five points)",
  tags: ["star", "symbol"],
  notes: "Five-pointed star with an optional filled core.",
  fillBias: "BALANCED",
  primitives: [
    {
      id: "star-outline",
      type: "CLOSED_CONTOUR",
      priority: 1,
      essential: true,
      minPoints: 20,
      color: [255, 210, 90],
      path: STAR_OUTLINE,
    },
    {
      id: "star-fill",
      type: "REGION",
      priority: 0.4,
      color: [255, 175, 40],
      outline: STAR_OUTLINE,
    },
  ],
});

/* ----------------------------------------------------------------- smiley */

export const SMILEY_FIGURE = figure({
  id: "figure-smiley",
  name: "Smiley face",
  tags: ["smiley", "face", "symbol"],
  notes: "Round face, two eyes and a smiling mouth. Not based on any real person.",
  parts: [
    { id: "FACE", priority: 1, color: [255, 215, 80] },
    { id: "LEFT_EYE", priority: 1, mirrorOf: "RIGHT_EYE", color: [40, 40, 60] },
    { id: "RIGHT_EYE", priority: 1, mirrorOf: "LEFT_EYE", color: [40, 40, 60] },
    { id: "MOUTH", priority: 1, color: [40, 40, 60] },
  ],
  primitives: [
    {
      id: "face-outline",
      type: "CLOSED_CONTOUR",
      part: "FACE",
      priority: 1,
      essential: true,
      minPoints: 24,
      path: circlePath([0, 0], 0.5, 40),
    },
    {
      id: "eye-left",
      type: "POINT_FEATURE",
      part: "LEFT_EYE",
      priority: 0.95,
      essential: true,
      minPoints: 2,
      maxPoints: 8,
      position: [-0.18, 0.16],
      spread: 0.05,
      mirrorOf: "eye-right",
    },
    {
      id: "eye-right",
      type: "POINT_FEATURE",
      part: "RIGHT_EYE",
      priority: 0.95,
      essential: true,
      minPoints: 2,
      maxPoints: 8,
      position: [0.18, 0.16],
      spread: 0.05,
      mirrorOf: "eye-left",
    },
    {
      id: "mouth",
      type: "POLYLINE",
      part: "MOUTH",
      priority: 0.95,
      essential: true,
      minPoints: 8,
      path: arcPath([0, -0.02], 0.28, 0.24, 200, 340, 20),
    },
  ],
});

/* ------------------------------------------------------------------ tree */

const TREE_HALF: DesignPoint[] = [
  [0.0, 0.52],
  [0.13, 0.24],
  [0.07, 0.24],
  [0.22, 0.02],
  [0.12, 0.02],
  [0.3, -0.24],
  [0.08, -0.24],
  [0.08, -0.42],
];

const TREE_OUTLINE = path([...TREE_HALF, ...mirrorPath(TREE_HALF)]);

export const TREE_FIGURE = figure({
  id: "figure-tree",
  name: "Christmas tree",
  tags: ["tree", "winter", "holiday"],
  notes: "Stylised conifer with a trunk and a top star.",
  parts: [
    { id: "TREE", priority: 1, color: [60, 180, 110] },
    { id: "STAR", priority: 0.9, color: [255, 220, 110] },
  ],
  primitives: [
    {
      id: "tree-outline",
      type: "CLOSED_CONTOUR",
      part: "TREE",
      priority: 1,
      essential: true,
      minPoints: 24,
      path: TREE_OUTLINE,
    },
    {
      id: "tree-fill",
      type: "REGION",
      part: "TREE",
      priority: 0.35,
      color: [40, 150, 95],
      outline: TREE_OUTLINE,
    },
    {
      id: "tree-star",
      type: "POINT_FEATURE",
      part: "STAR",
      priority: 0.9,
      essential: true,
      minPoints: 3,
      maxPoints: 10,
      position: [0, 0.6],
      spread: 0.05,
    },
  ],
});

/* ---------------------------------------------------------------- rocket */

const ROCKET_BODY: DesignPoint[] = [
  [0.0, 0.55],
  [0.1, 0.3],
  [0.12, -0.1],
  [0.09, -0.3],
  [-0.09, -0.3],
  [-0.12, -0.1],
  [-0.1, 0.3],
];

const ROCKET_FIN_LEFT: DesignPoint[] = [
  [-0.12, -0.05],
  [-0.28, -0.26],
  [-0.26, -0.34],
  [-0.11, -0.29],
];

export const ROCKET_FIGURE = figure({
  id: "figure-rocket",
  name: "Rocket",
  tags: ["rocket", "object", "space"],
  notes: "Stylised rocket with mirrored fins, a window and an exhaust flame.",
  parts: [
    { id: "BODY", priority: 1, color: [225, 230, 240] },
    { id: "LEFT_FIN", priority: 0.8, mirrorOf: "RIGHT_FIN", color: [220, 80, 70] },
    { id: "RIGHT_FIN", priority: 0.8, mirrorOf: "LEFT_FIN", color: [220, 80, 70] },
    { id: "WINDOW", priority: 0.85, color: [90, 170, 240] },
    { id: "FLAME", priority: 0.6, color: [255, 150, 50] },
  ],
  primitives: [
    {
      id: "rocket-body",
      type: "CLOSED_CONTOUR",
      part: "BODY",
      priority: 1,
      essential: true,
      minPoints: 20,
      path: path(ROCKET_BODY),
    },
    {
      id: "fin-left",
      type: "CLOSED_CONTOUR",
      part: "LEFT_FIN",
      priority: 0.8,
      minPoints: 6,
      path: path(ROCKET_FIN_LEFT),
      mirrorOf: "fin-right",
    },
    {
      id: "fin-right",
      type: "CLOSED_CONTOUR",
      part: "RIGHT_FIN",
      priority: 0.8,
      minPoints: 6,
      path: mirrorPath(path(ROCKET_FIN_LEFT)),
      mirrorOf: "fin-left",
    },
    {
      id: "rocket-window",
      type: "CLOSED_CONTOUR",
      part: "WINDOW",
      priority: 0.85,
      minPoints: 6,
      maxPoints: 18,
      path: circlePath([0, 0.16], 0.06, 16),
    },
    {
      id: "rocket-flame",
      type: "CLOSED_CONTOUR",
      part: "FLAME",
      priority: 0.6,
      minPoints: 6,
      path: path([
        [-0.07, -0.31],
        [-0.04, -0.44],
        [0.0, -0.55],
        [0.04, -0.44],
        [0.07, -0.31],
      ]),
    },
  ],
});

/* ---------------------------------------------------------------- flower */

function petals(count: number): VisualPrimitive[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * TAU;
    const cx = Math.cos(a) * 0.28;
    const cy = Math.sin(a) * 0.28;
    const ellipse = ellipsePath([0, 0], 0.2, 0.1, 18).map(([x, y]) => {
      const rx = x * Math.cos(a) - y * Math.sin(a);
      const ry = x * Math.sin(a) + y * Math.cos(a);
      return [rx + cx, ry + cy] as DesignPoint;
    });
    return {
      id: `petal-${i + 1}`,
      type: "CLOSED_CONTOUR",
      part: "PETALS",
      priority: 0.9,
      minPoints: 8,
      path: path(ellipse),
    } satisfies VisualPrimitive;
  });
}

export const FLOWER_FIGURE = figure({
  id: "figure-flower",
  name: "Flower",
  tags: ["flower", "nature"],
  notes: "Six radial petals around a core, evenly distributed by construction.",
  symmetry: "NONE",
  parts: [
    { id: "PETALS", priority: 0.9, color: [255, 130, 190] },
    { id: "CORE", priority: 1, color: [255, 220, 100] },
  ],
  primitives: [
    ...petals(6),
    {
      id: "flower-core",
      type: "POINT_FEATURE",
      part: "CORE",
      priority: 1,
      essential: true,
      minPoints: 4,
      maxPoints: 20,
      position: [0, 0],
      spread: 0.09,
    },
  ],
});

/* ----------------------------------------------------------------- moon */

const MOON_OUTER = arcPath([0, 0], 0.5, 0.5, -80, 80, 26);
const MOON_INNER = arcPath([-0.16, 0], 0.46, 0.46, 80, -80, 22);

export const MOON_FIGURE = figure({
  id: "figure-moon",
  name: "Crescent moon",
  tags: ["moon", "night", "symbol"],
  notes: "Crescent formed by two offset arcs; keeps its shape at low counts.",
  symmetry: "MIRROR_Y",
  primitives: [
    {
      id: "moon-crescent",
      type: "CLOSED_CONTOUR",
      priority: 1,
      essential: true,
      minPoints: 24,
      color: [240, 240, 200],
      path: path([...MOON_OUTER, ...MOON_INNER]),
    },
  ],
});

/* ---------------------------------------------------------------- arrow */

const ARROW_OUTLINE = path([
  [0.0, 0.5],
  [0.26, 0.16],
  [0.11, 0.16],
  [0.11, -0.5],
  [-0.11, -0.5],
  [-0.11, 0.16],
  [-0.26, 0.16],
]);

export const ARROW_FIGURE = figure({
  id: "figure-arrow",
  name: "Arrow (up)",
  tags: ["arrow", "symbol", "sign"],
  notes: "Upward arrow; rotate it in the show to point any direction.",
  primitives: [
    {
      id: "arrow-outline",
      type: "CLOSED_CONTOUR",
      priority: 1,
      essential: true,
      minPoints: 16,
      color: [120, 200, 255],
      path: ARROW_OUTLINE,
    },
    {
      id: "arrow-fill",
      type: "REGION",
      priority: 0.4,
      color: [80, 160, 230],
      outline: ARROW_OUTLINE,
    },
  ],
});

/* --------------------------------------------------------------- spiral */

export const SPIRAL_FIGURE = figure({
  id: "figure-spiral",
  name: "Spiral",
  tags: ["spiral", "abstract"],
  notes: "Archimedean spiral of three turns, drawn as one continuous line.",
  symmetry: "NONE",
  primitives: [
    {
      id: "spiral-line",
      type: "POLYLINE",
      priority: 1,
      essential: true,
      minPoints: 20,
      color: [160, 210, 255],
      path: path(
        Array.from({ length: 120 }, (_, i) => {
          const t = i / 119;
          const a = t * TAU * 3;
          const r = 0.06 + t * 0.44;
          return [Math.cos(a) * r, Math.sin(a) * r] as DesignPoint;
        }),
      ),
    },
  ],
});

/* ----------------------------------------------------------------- ring */

const RING_OUTER = circlePath([0, 0], 0.5, 48);

export const RING_FIGURE = figure({
  id: "figure-ring",
  name: "Ring",
  tags: ["ring", "circle", "abstract"],
  notes: "Concentric double ring — a clean opener or closer figure.",
  symmetry: "NONE",
  primitives: [
    {
      id: "ring-outer",
      type: "CLOSED_CONTOUR",
      priority: 1,
      essential: true,
      minPoints: 24,
      color: [255, 255, 255],
      path: RING_OUTER,
    },
    {
      id: "ring-inner",
      type: "CLOSED_CONTOUR",
      priority: 0.7,
      minPoints: 12,
      color: [150, 200, 255],
      path: circlePath([0, 0], 0.28, 32),
    },
  ],
});

/* -------------------------------------------------------------- mermaid */

const MERMAID_TORSO = path([
  [-0.2, 0.44],
  [-0.27, 0.28],
  [-0.25, 0.1],
  [-0.14, -0.03],
  [0.03, -0.07],
  [0.11, 0.06],
  [0.09, 0.23],
  [0.02, 0.39],
  [-0.07, 0.45],
]);

const MERMAID_ARM = path([
  [-0.24, 0.32],
  [-0.4, 0.17],
  [-0.53, 0.03],
  [-0.44, -0.05],
]);

const MERMAID_TAIL_UPPER = path([
  [0.03, -0.01],
  [0.18, -0.1],
  [0.34, -0.22],
  [0.46, -0.38],
  [0.56, -0.52],
]);

const MERMAID_TAIL_LOWER = path([
  [0.0, -0.11],
  [0.14, -0.22],
  [0.28, -0.34],
  [0.4, -0.48],
  [0.5, -0.62],
]);

const MERMAID_FIN = path([
  [0.56, -0.52],
  [0.74, -0.36],
  [0.66, -0.56],
  [0.8, -0.66],
  [0.58, -0.66],
  [0.5, -0.62],
]);

/**
 * Free-hand mermaid silhouette authored from scratch in design space: head,
 * torso, one resting arm and a long tail whose fin sits at the far end. The
 * TAIL part is declared animatable with SWAY_Z, so the dynamic bridge turns it
 * into a tail-wag motion group while the body stays still.
 */
export const MERMAID_FIGURE = figure({
  id: "figure-mermaid",
  name: "Mermaid",
  tags: ["mermaid", "sea", "figure", "tail", "fantasy"],
  notes: "Original mermaid silhouette. The tail is a motion group (tail wag).",
  symmetry: "NONE",
  defaultPointCount: 180,
  parts: [
    { id: "HEAD", priority: 1, color: [190, 220, 255] },
    { id: "BODY", priority: 1, color: [225, 235, 255] },
    { id: "ARM", priority: 0.85, color: [210, 225, 255] },
    {
      id: "TAIL",
      priority: 0.95,
      color: [120, 180, 255],
      animatable: true,
      motion: "SWAY_Z",
    },
  ],
  primitives: [
    {
      id: "mermaid-head",
      type: "CLOSED_CONTOUR",
      part: "HEAD",
      priority: 1,
      essential: true,
      minPoints: 10,
      path: circlePath([-0.08, 0.58], 0.13, 24),
    },
    {
      id: "mermaid-torso",
      type: "CLOSED_CONTOUR",
      part: "BODY",
      priority: 1,
      essential: true,
      minPoints: 18,
      path: MERMAID_TORSO,
    },
    {
      id: "mermaid-arm",
      type: "POLYLINE",
      part: "ARM",
      priority: 0.85,
      essential: true,
      minPoints: 8,
      path: MERMAID_ARM,
    },
    {
      id: "mermaid-tail-upper",
      type: "POLYLINE",
      part: "TAIL",
      priority: 0.95,
      essential: true,
      minPoints: 10,
      path: MERMAID_TAIL_UPPER,
    },
    {
      id: "mermaid-tail-lower",
      type: "POLYLINE",
      part: "TAIL",
      priority: 0.9,
      essential: true,
      minPoints: 10,
      path: MERMAID_TAIL_LOWER,
    },
    {
      id: "mermaid-fin",
      type: "CLOSED_CONTOUR",
      part: "TAIL",
      priority: 0.9,
      essential: true,
      minPoints: 10,
      path: MERMAID_FIN,
    },
  ],
});

export const FIGURE_DESIGNS: readonly VisualFormationDesign[] = [
  HEART_FIGURE,
  STAR_FIGURE,
  SMILEY_FIGURE,
  TREE_FIGURE,
  ROCKET_FIGURE,
  FLOWER_FIGURE,
  MOON_FIGURE,
  ARROW_FIGURE,
  SPIRAL_FIGURE,
  RING_FIGURE,
  MERMAID_FIGURE,
];
