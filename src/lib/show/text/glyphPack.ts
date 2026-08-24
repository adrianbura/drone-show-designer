/**
 * BUNDLED DETERMINISTIC GLYPH PACK — flight geometry source of truth for text.
 *
 * WHY A BUNDLED STROKE PACK
 *   Browser canvas rasterisation, CSS fonts and system fonts are NOT
 *   deterministic across machines, browsers, headless test runners or export
 *   hosts (hinting, subpixel rules, font fallback). Flight geometry must be
 *   reproducible byte-for-byte, so text geometry is generated from this
 *   bundled, versioned stroke pack only. `formations.textPoints()` (canvas) is
 *   PREVIEW-ONLY legacy and is never used by this pipeline.
 *
 * COORDINATE SPACE
 *   Glyph-local em units: x to the right, y up, baseline at y = 0, cap height
 *   at y = CAP_HEIGHT. Each glyph declares its own advance width. Strokes are
 *   open polylines; their endpoints are never emitted as points (see
 *   generate.ts), which is what guarantees that adjacent strokes cannot produce
 *   duplicate positions.
 *
 * Pure module: no React, no Three.js, no I/O, no fonts, no canvas.
 */

/** Bumped whenever a glyph outline changes (geometry-breaking). */
export const GLYPH_PACK_ID = "studio-stroke-caps-v1";
export const GLYPH_PACK_VERSION = 1;

export const CAP_HEIGHT = 7;

export type GlyphPoint = readonly [number, number];
export type GlyphStroke = readonly GlyphPoint[];

export interface Glyph {
  readonly advance: number;
  readonly strokes: readonly GlyphStroke[];
}

const O: GlyphStroke = [
  [1.4, 7],
  [2.6, 7],
  [4, 5.4],
  [4, 1.6],
  [2.6, 0],
  [1.4, 0],
  [0, 1.6],
  [0, 5.4],
  [1.4, 7],
];

const DOT: GlyphStroke = [
  [1.8, 0],
  [2.2, 0.45],
];

const P_BOWL: GlyphStroke = [
  [0, 0],
  [0, 7],
  [2.8, 7],
  [4, 5.8],
  [2.8, 3.8],
  [0, 3.8],
];

const C_ARC: GlyphStroke = [
  [4, 5.6],
  [2.8, 7],
  [1.2, 7],
  [0, 5.6],
  [0, 1.4],
  [1.2, 0],
  [2.8, 0],
  [4, 1.4],
];

const glyph = (advance: number, ...strokes: GlyphStroke[]): Glyph => ({ advance, strokes });

/** A-Z, 0-9, space and `. - ! ?`. Anything else fails loudly. */
export const GLYPH_PACK: Readonly<Record<string, Glyph>> = {
  " ": glyph(2.2),
  A: glyph(4, [[0, 0], [2, 7], [4, 0]], [[0.8, 2.8], [3.2, 2.8]]),
  B: glyph(
    4,
    [[0, 7], [2.8, 7], [3.8, 5.9], [2.8, 3.8], [0, 3.8]],
    [[0, 3.8], [3.2, 3.8], [4, 1.9], [3, 0], [0, 0]],
    [[0, 0], [0, 7]],
  ),
  C: glyph(4, C_ARC),
  D: glyph(4, [[0, 0], [0, 7]], [[0, 7], [2.6, 7], [4, 5], [4, 2], [2.6, 0], [0, 0]]),
  E: glyph(4, [[4, 7], [0, 7], [0, 0], [3.8, 0]], [[0, 3.5], [3.2, 3.5]]),
  F: glyph(4, [[4, 7], [0, 7], [0, 0]], [[0, 3.5], [3, 3.5]]),
  G: glyph(4, [...C_ARC, [4, 3], [2.2, 3]]),
  H: glyph(4, [[0, 0], [0, 7]], [[4, 0], [4, 7]], [[0, 3.5], [4, 3.5]]),
  I: glyph(4, [[2, 0], [2, 7]], [[0.6, 7], [3.4, 7]], [[0.6, 0], [3.4, 0]]),
  J: glyph(4, [[3.2, 7], [3.2, 1.6], [1.8, 0], [0.4, 0.9]]),
  K: glyph(4, [[0, 0], [0, 7]], [[4, 7], [0, 3.2]], [[1.4, 4.4], [4, 0]]),
  L: glyph(4, [[0, 7], [0, 0], [3.8, 0]]),
  M: glyph(4, [[0, 0], [0, 7], [2, 3.2], [4, 7], [4, 0]]),
  N: glyph(4, [[0, 0], [0, 7], [4, 0], [4, 7]]),
  O: glyph(4, O),
  P: glyph(4, P_BOWL),
  Q: glyph(4, O, [[2.4, 1.8], [4.3, -0.5]]),
  R: glyph(4, P_BOWL, [[1.6, 3.8], [4, 0]]),
  S: glyph(4, [
    [4, 6],
    [2.6, 7],
    [1.2, 7],
    [0, 5.9],
    [0, 4.6],
    [1.2, 3.7],
    [2.8, 3.4],
    [4, 2.4],
    [4, 1.1],
    [2.8, 0],
    [1.2, 0],
    [0, 1],
  ]),
  T: glyph(4, [[0, 7], [4, 7]], [[2, 7], [2, 0]]),
  U: glyph(4, [[0, 7], [0, 1.6], [1.4, 0], [2.6, 0], [4, 1.6], [4, 7]]),
  V: glyph(4, [[0, 7], [2, 0], [4, 7]]),
  W: glyph(4, [[0, 7], [1, 0], [2, 4.4], [3, 0], [4, 7]]),
  X: glyph(4, [[0, 7], [4, 0]], [[0, 0], [4, 7]]),
  Y: glyph(4, [[0, 7], [2, 3.4], [4, 7]], [[2, 3.4], [2, 0]]),
  Z: glyph(4, [[0, 7], [4, 7], [0, 0], [4, 0]]),
  "0": glyph(4, O, [[0.7, 1.5], [3.3, 5.5]]),
  "1": glyph(4, [[0.8, 5.6], [2, 7], [2, 0]], [[0.6, 0], [3.4, 0]]),
  "2": glyph(4, [[0, 5.8], [1.2, 7], [2.8, 7], [4, 5.8], [4, 4.6], [0, 0], [4, 0]]),
  "3": glyph(
    4,
    [[0, 6.4], [1.4, 7], [3, 7], [4, 5.9], [2.6, 3.7], [4, 1.6], [3, 0], [1.2, 0], [0, 0.8]],
    [[2.6, 3.7], [1.4, 3.7]],
  ),
  "4": glyph(4, [[3, 0], [3, 7], [0, 2.4], [4, 2.4]]),
  "5": glyph(4, [[4, 7], [0, 7], [0, 4], [2.8, 4], [4, 2.8], [4, 1.2], [2.8, 0], [1, 0], [0, 0.8]]),
  "6": glyph(4, [
    [3.6, 6.4],
    [2.4, 7],
    [1, 7],
    [0, 5.4],
    [0, 1.4],
    [1.2, 0],
    [2.8, 0],
    [4, 1.4],
    [4, 2.4],
    [2.8, 3.6],
    [1.2, 3.6],
    [0, 2.6],
  ]),
  "7": glyph(4, [[0, 7], [4, 7], [1.4, 0]]),
  "8": glyph(
    4,
    [[1.4, 3.5], [0, 4.8], [0, 6], [1.4, 7], [2.6, 7], [4, 6], [4, 4.8], [2.6, 3.5]],
    [[2.6, 3.5], [4, 2.2], [4, 1.1], [2.6, 0], [1.4, 0], [0, 1.1], [0, 2.2], [1.4, 3.5]],
  ),
  "9": glyph(4, [
    [0.4, 0.6],
    [1.6, 0],
    [3, 0],
    [4, 1.6],
    [4, 5.6],
    [2.8, 7],
    [1.2, 7],
    [0, 5.6],
    [0, 4.6],
    [1.2, 3.4],
    [2.8, 3.4],
    [4, 4.4],
  ]),
  ".": glyph(2.4, DOT),
  "-": glyph(4, [[0.6, 3.5], [3.4, 3.5]]),
  "!": glyph(2.4, [[2, 7], [2, 1.8]], DOT),
  "?": glyph(4, [[0, 5.8], [1.2, 7], [2.8, 7], [4, 5.8], [4, 4.8], [2, 3.4], [2, 2.2]], DOT),
};

export const SUPPORTED_GLYPHS: readonly string[] = Object.keys(GLYPH_PACK).sort();

export function isSupportedGlyph(character: string): boolean {
  return Object.prototype.hasOwnProperty.call(GLYPH_PACK, character);
}
