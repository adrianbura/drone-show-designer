/**
 * DETERMINISTIC TEXT GEOMETRY GENERATOR.
 *
 * PIPELINE (fully deterministic, no canvas, no fonts, no RNG):
 *   1. NORMALISE      uppercase the operator text, reject unsupported glyphs
 *   2. LAYOUT         advance widths + letter spacing in em units
 *   3. STYLE          italic shear in em space
 *   4. BANDS          primary (outline) band + perpendicular fill bands
 *   5. FIT            uniform scale of the whole band bbox into width x height
 *   6. ALLOCATE       points per stroke by arc length (largest remainder)
 *   7. SAMPLE         mid-interval arc-length sampling (endpoints never emitted)
 *   8. VERIFY         exact participation, unique ids, no duplicate positions
 *
 * Mid-interval sampling is the reason two strokes that share an endpoint cannot
 * emit the same position, so uniqueness is a property of the construction and
 * the final check is a loud assertion, not a repair step.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { Vec3 } from "../types";
import { CAP_HEIGHT, GLYPH_PACK, GLYPH_PACK_ID, GLYPH_PACK_VERSION, isSupportedGlyph, type GlyphStroke } from "./glyphPack";
import {
  TEXT_GEOMETRY_ALGORITHM_VERSION,
  TEXT_RECIPE_SCHEMA_VERSION,
  TextGeometryError,
  type TextGeometryRecipe,
  type TextGeometryResult,
} from "./types";

type P2 = readonly [number, number];

interface Polyline {
  readonly band: number;
  readonly glyphIndex: number;
  readonly strokeIndex: number;
  readonly vertices: readonly P2[];
  readonly cumulative: readonly number[];
  readonly length: number;
}

const ITALIC_SHEAR = 0.18;

const BAND_COUNT: Record<TextGeometryRecipe["weight"], number> = {
  LIGHT: 1,
  REGULAR: 2,
  BOLD: 3,
};

/** Canonical recipe with the bundled pack identity and versions enforced. */
export function makeTextRecipe(
  input: Omit<
    TextGeometryRecipe,
    "schemaVersion" | "algorithmVersion" | "glyphPackId" | "glyphPackVersion"
  >,
): TextGeometryRecipe {
  return {
    schemaVersion: TEXT_RECIPE_SCHEMA_VERSION,
    algorithmVersion: TEXT_GEOMETRY_ALGORITHM_VERSION,
    glyphPackId: GLYPH_PACK_ID,
    glyphPackVersion: GLYPH_PACK_VERSION,
    ...input,
  };
}

function canonical(recipe: TextGeometryRecipe): string {
  return JSON.stringify([
    recipe.schemaVersion,
    recipe.algorithmVersion,
    recipe.glyphPackId,
    recipe.glyphPackVersion,
    recipe.text,
    recipe.weight,
    recipe.style,
    recipe.widthMeters,
    recipe.heightMeters,
    recipe.letterSpacingEm,
    recipe.alignment,
    recipe.participation,
    recipe.outlineRatio,
    recipe.bandOffsetEm,
    recipe.seed,
  ]);
}

/** FNV-1a — stable across runtimes, used as geometry identity only. */
export function textRecipeHash(recipe: TextGeometryRecipe): string {
  const source = canonical(recipe);
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `txt-${hash.toString(16).padStart(8, "0")}`;
}

export function normalizeText(text: string): string {
  return text.toUpperCase().replace(/\s+/g, " ").trim();
}

function assertRecipe(recipe: TextGeometryRecipe): string {
  if (recipe.glyphPackId !== GLYPH_PACK_ID || recipe.glyphPackVersion !== GLYPH_PACK_VERSION) {
    throw new TextGeometryError("GLYPH_PACK_MISMATCH", "The recipe references an unknown glyph pack.", {
      glyphPackId: recipe.glyphPackId,
      glyphPackVersion: recipe.glyphPackVersion,
    });
  }
  const text = normalizeText(recipe.text);
  if (!text) throw new TextGeometryError("EMPTY_TEXT", "The replacement text is empty.");
  const unsupported = [...text].filter((c) => !isSupportedGlyph(c));
  if (unsupported.length > 0) {
    throw new TextGeometryError("UNSUPPORTED_GLYPH", "The glyph pack does not contain every character.", {
      unsupported: [...new Set(unsupported)],
    });
  }
  if (!Number.isInteger(recipe.participation) || recipe.participation < 1) {
    throw new TextGeometryError("INVALID_PARTICIPATION", "Participation must be a positive integer.", {
      participation: recipe.participation,
    });
  }
  if (
    !(recipe.widthMeters > 0) ||
    !(recipe.heightMeters > 0) ||
    !Number.isFinite(recipe.widthMeters) ||
    !Number.isFinite(recipe.heightMeters)
  ) {
    throw new TextGeometryError("INVALID_BOUNDS", "Width and height must be positive metres.", {
      widthMeters: recipe.widthMeters,
      heightMeters: recipe.heightMeters,
    });
  }
  if (!(recipe.outlineRatio > 0) || recipe.outlineRatio > 1) {
    throw new TextGeometryError("INVALID_DISTRIBUTION", "outlineRatio must satisfy 0 < r <= 1.", {
      outlineRatio: recipe.outlineRatio,
    });
  }
  if (!(recipe.bandOffsetEm >= 0) || !Number.isFinite(recipe.bandOffsetEm)) {
    throw new TextGeometryError("INVALID_DISTRIBUTION", "bandOffsetEm must be a finite, non-negative number.", {
      bandOffsetEm: recipe.bandOffsetEm,
    });
  }
  return text;
}

function shear(vertex: P2, italic: boolean): P2 {
  return italic ? [vertex[0] + (vertex[1] / CAP_HEIGHT) * ITALIC_SHEAR * CAP_HEIGHT * 0.5, vertex[1]] : vertex;
}

/** Per-vertex unit normal from the averaged adjacent segment directions. */
function normals(vertices: readonly P2[]): P2[] {
  const dirs: P2[] = [];
  for (let i = 0; i < vertices.length - 1; i += 1) {
    const a = vertices[i]!;
    const b = vertices[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dirs.push([dx / len, dy / len]);
  }
  return vertices.map((_, i) => {
    const before = dirs[i - 1];
    const after = dirs[i] ?? dirs[dirs.length - 1];
    const dx = (before?.[0] ?? after?.[0] ?? 1) + (after?.[0] ?? 0);
    const dy = (before?.[1] ?? after?.[1] ?? 0) + (after?.[1] ?? 0);
    const len = Math.hypot(dx, dy) || 1;
    // Left-hand perpendicular of the averaged tangent.
    return [-dy / len, dx / len] as P2;
  });
}

function polyline(
  band: number,
  glyphIndex: number,
  strokeIndex: number,
  vertices: readonly P2[],
): Polyline | null {
  const cumulative = [0];
  for (let i = 1; i < vertices.length; i += 1) {
    const a = vertices[i - 1]!;
    const b = vertices[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cumulative[cumulative.length - 1] ?? 0;
  if (!(length > 0)) return null;
  return { band, glyphIndex, strokeIndex, vertices, cumulative, length };
}

/** Band offsets in em units: 0, +d, -d, +2d, -2d, ... (deterministic order). */
function bandOffsets(count: number, offset: number): number[] {
  const out = [0];
  for (let i = 1; i < count; i += 1) {
    const step = Math.ceil(i / 2) * offset;
    out.push(i % 2 === 1 ? step : -step);
  }
  return out;
}

function buildPolylines(recipe: TextGeometryRecipe, text: string): Polyline[] {
  const italic = recipe.style === "ITALIC";
  const bands = bandOffsets(BAND_COUNT[recipe.weight], recipe.bandOffsetEm);
  const laid: { glyphIndex: number; strokeIndex: number; vertices: P2[] }[] = [];
  let cursor = 0;
  [...text].forEach((character, glyphIndex) => {
    const glyph = GLYPH_PACK[character]!;
    glyph.strokes.forEach((stroke: GlyphStroke, strokeIndex) => {
      laid.push({
        glyphIndex,
        strokeIndex,
        vertices: stroke.map((v) => shear([v[0] + cursor, v[1]], italic)),
      });
    });
    cursor += glyph.advance + recipe.letterSpacingEm;
  });

  const out: Polyline[] = [];
  bands.forEach((offset, band) => {
    for (const stroke of laid) {
      const vertices =
        offset === 0
          ? stroke.vertices
          : normals(stroke.vertices).map(
              (n, i) =>
                [stroke.vertices[i]![0] + n[0] * offset, stroke.vertices[i]![1] + n[1] * offset] as P2,
            );
      const line = polyline(band, stroke.glyphIndex, stroke.strokeIndex, vertices);
      if (line) out.push(line);
    }
  });
  return out;
}

/**
 * Largest-remainder allocation of `count` points over weighted slots. The seed
 * rotates the remainder ordering only, so it never changes the total and never
 * introduces randomness.
 */
function allocate(weights: readonly number[], count: number, seed: number): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0) || count <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / total) * count);
  const base = exact.map((v) => Math.floor(v));
  let remaining = count - base.reduce((sum, v) => sum + v, 0);
  const order = exact
    .map((v, index) => ({ index, remainder: v - Math.floor(v) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const rotation = order.length > 0 ? ((seed % order.length) + order.length) % order.length : 0;
  for (let i = 0; remaining > 0 && i < order.length * 2; i += 1) {
    const slot = order[(i + rotation) % order.length]!;
    base[slot.index] = base[slot.index]! + 1;
    remaining -= 1;
  }
  // Any residue (count > slots) is spread deterministically slot by slot.
  let slot = 0;
  while (remaining > 0) {
    base[slot % base.length] = base[slot % base.length]! + 1;
    slot += 1;
    remaining -= 1;
  }
  return base;
}

const fract = (value: number): number => value - Math.floor(value);

function sampleAt(line: Polyline, distance: number): P2 {
  const { vertices, cumulative } = line;
  for (let i = 1; i < cumulative.length; i += 1) {
    if (distance <= cumulative[i]! || i === cumulative.length - 1) {
      const span = cumulative[i]! - cumulative[i - 1]!;
      const t = span > 0 ? (distance - cumulative[i - 1]!) / span : 0;
      const a = vertices[i - 1]!;
      const b = vertices[i]!;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return vertices[0]!;
}

/**
 * THE deterministic generator. Every layer (browser, tests, Save/Open, export)
 * must obtain text flight geometry from here and nowhere else.
 */
export function generateTextGeometry(recipe: TextGeometryRecipe): TextGeometryResult {
  const text = assertRecipe(recipe);
  const lines = buildPolylines(recipe, text);
  if (lines.length === 0) {
    throw new TextGeometryError("NO_GEOMETRY", "The text produced no stroke geometry.", { text });
  }

  const primary = lines.filter((l) => l.band === 0);
  const fill = lines.filter((l) => l.band !== 0);
  const outlineCount =
    fill.length === 0
      ? recipe.participation
      : Math.min(
          recipe.participation,
          Math.max(1, Math.round(recipe.participation * recipe.outlineRatio)),
        );
  const fillCount = recipe.participation - outlineCount;

  const perLine = new Map<Polyline, number>();
  allocate(primary.map((l) => l.length), outlineCount, recipe.seed).forEach((n, i) =>
    perLine.set(primary[i]!, n),
  );
  allocate(fill.map((l) => l.length), fillCount, recipe.seed + 1).forEach((n, i) =>
    perLine.set(fill[i]!, n),
  );

  // Em-space samples first, so the fit uses the REAL emitted extent.
  const samples: { line: Polyline; index: number; point: P2 }[] = [];
  for (const line of lines) {
    const n = perLine.get(line) ?? 0;
    // Deterministic sub-interval phase. Without it, two strokes that CROSS
    // (e.g. the two diagonals of "X") can both land their mid-interval sample
    // exactly on the intersection. The phase stays inside the interval, so no
    // endpoint is ever emitted.
    const phase = 0.5 + (fract(line.strokeIndex * 0.191 + line.band * 0.083 + line.glyphIndex * 0.037) - 0.5) * 0.5;
    for (let k = 0; k < n; k += 1) {
      samples.push({ line, index: k, point: sampleAt(line, ((k + phase) / n) * line.length) });
    }
  }
  if (samples.length !== recipe.participation) {
    throw new TextGeometryError("POINT_COUNT_MISMATCH", "Allocation did not fill participation exactly.", {
      expected: recipe.participation,
      actual: samples.length,
    });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { point } of samples) {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  // Uniform scale preserves glyph proportions and keeps every point inside the
  // requested box; alignment then places the block horizontally.
  const scale = Math.min(recipe.widthMeters / spanX, recipe.heightMeters / spanY);
  const usedWidth = spanX * scale;
  const usedHeight = spanY * scale;
  const alignShift =
    recipe.alignment === "LEFT"
      ? -(recipe.widthMeters - usedWidth) / 2
      : recipe.alignment === "RIGHT"
        ? (recipe.widthMeters - usedWidth) / 2
        : 0;

  const points: Vec3[] = [];
  const pointIds: string[] = [];
  const hash = textRecipeHash(recipe);
  const seen = new Set<string>();
  for (const { line, index, point } of samples) {
    const x = (point[0] - (minX + maxX) / 2) * scale + alignShift;
    const y = (point[1] - (minY + maxY) / 2) * scale;
    const key = `${x.toFixed(6)}|${y.toFixed(6)}`;
    if (seen.has(key)) {
      throw new TextGeometryError("DUPLICATE_POSITION", "Two text points resolved to the same position.", {
        key,
        glyphIndex: line.glyphIndex,
        strokeIndex: line.strokeIndex,
      });
    }
    seen.add(key);
    points.push([x, y, 0]);
    pointIds.push(`${hash}-b${line.band}-g${line.glyphIndex}-s${line.strokeIndex}-p${index}`);
  }
  if (new Set(pointIds).size !== pointIds.length) {
    throw new TextGeometryError("DUPLICATE_POSITION", "Text point ids are not unique.", {});
  }

  return {
    recipe,
    points,
    pointIds,
    recipeHash: hash,
    bounds: { widthMeters: usedWidth, heightMeters: usedHeight },
  };
}
