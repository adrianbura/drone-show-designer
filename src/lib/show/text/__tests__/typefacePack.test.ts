import { describe, expect, it } from "vitest";
import { ARCHIVO_WIDE_V1_PACK } from "../typefaceArchivo.generated";
import {
  DEFAULT_GLYPH_PACK_ID,
  GLYPH_PACKS,
  generateTextGeometry,
  glyphPackById,
  makeTextRecipe,
  STROKE_PACK,
  TextGeometryError,
} from "../index";

const recipe = (glyphPackId?: string) =>
  makeTextRecipe({
    text: "SHOW 2026",
    weight: "REGULAR",
    style: "UPRIGHT",
    widthMeters: 90,
    heightMeters: 24,
    centerAltitudeMeters: 60,
    letterSpacingEm: 0.8,
    alignment: "CENTER",
    participation: 120,
    outlineRatio: 0.7,
    bandOffsetEm: 0.35,
    seed: 3,
    ...(glyphPackId ? { glyphPackId } : {}),
  });

describe("typeface glyph packs", () => {
  it("keeps the stroke pack as the default so existing recipes are untouched", () => {
    expect(DEFAULT_GLYPH_PACK_ID).toBe(STROKE_PACK.id);
    expect(recipe().glyphPackId).toBe(STROKE_PACK.id);
    expect(GLYPH_PACKS.map((p) => p.id)).toContain(ARCHIVO_WIDE_V1_PACK.id);
  });

  it("exposes real-typeface outlines as closed contours, baseline up", () => {
    const pack = glyphPackById(ARCHIVO_WIDE_V1_PACK.id)!;
    expect(pack.closedContours).toBe(true);
    const a = pack.glyphs["A"]!;
    expect(a.strokes.length).toBeGreaterThan(1);
    const ys = a.strokes.flat().map((v) => v[1]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.2);
    expect(Math.max(...ys)).toBeGreaterThan(pack.capHeight * 0.9);
    // 'O' is a filled ring: an outer and an inner contour.
    expect(pack.glyphs["O"]!.strokes.length).toBe(2);
  });

  it("generates exact participation, unique positions and fits the box", () => {
    const result = generateTextGeometry(recipe(ARCHIVO_WIDE_V1_PACK.id));
    expect(result.points).toHaveLength(120);
    expect(new Set(result.points.map((p) => `${p[0]}|${p[1]}`)).size).toBe(120);
    expect(result.bounds.widthMeters).toBeLessThanOrEqual(90 + 1e-6);
    expect(result.bounds.heightMeters).toBeLessThanOrEqual(24 + 1e-6);
  });

  it("is deterministic and distinct from the stroke pack", () => {
    const a = generateTextGeometry(recipe(ARCHIVO_WIDE_V1_PACK.id));
    const b = generateTextGeometry(recipe(ARCHIVO_WIDE_V1_PACK.id));
    expect(b.points).toEqual(a.points);
    expect(b.recipeHash).toBe(a.recipeHash);
    const strokes = generateTextGeometry(recipe());
    expect(strokes.recipeHash).not.toBe(a.recipeHash);
    expect(strokes.points).not.toEqual(a.points);
  });

  it("refuses an unknown pack instead of silently falling back", () => {
    expect(() => makeTextRecipe({ ...recipe(), glyphPackId: "no-such-pack" })).toThrow(
      TextGeometryError,
    );
    expect(() =>
      generateTextGeometry({ ...recipe(ARCHIVO_WIDE_V1_PACK.id), glyphPackVersion: 99 }),
    ).toThrow(/unknown glyph pack/i);
  });
});
