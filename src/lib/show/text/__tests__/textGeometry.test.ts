import { describe, expect, it } from "vitest";
import {
  GLYPH_PACK_ID,
  GLYPH_PACK_VERSION,
  SUPPORTED_GLYPHS,
  generateTextGeometry,
  makeTextFormation,
  makeTextRecipe,
  verifyTextFormation,
  type TextGeometryRecipe,
} from "..";
import { TextGeometryError } from "../types";

function recipe(overrides: Partial<Omit<TextGeometryRecipe, "schemaVersion" | "algorithmVersion" | "glyphPackId" | "glyphPackVersion">> = {}) {
  return makeTextRecipe({
    text: "SUPER RALLY",
    weight: "REGULAR",
    style: "UPRIGHT",
    widthMeters: 120,
    heightMeters: 30,
    centerAltitudeMeters: 45,
    letterSpacingEm: 0.8,
    alignment: "CENTER",
    participation: 150,
    outlineRatio: 0.7,
    bandOffsetEm: 0.35,
    seed: 7,
    ...overrides,
  });
}

describe("deterministic text geometry", () => {
  it("emits exactly the requested participation for the factual 150-drone case", () => {
    const result = generateTextGeometry(recipe());
    expect(result.points).toHaveLength(150);
    expect(new Set(result.pointIds).size).toBe(150);
  });

  it("is byte-identical across repeated runs", () => {
    const a = generateTextGeometry(recipe());
    const b = generateTextGeometry(recipe());
    expect(JSON.stringify(b.points)).toBe(JSON.stringify(a.points));
    expect(b.pointIds).toEqual(a.pointIds);
    expect(b.recipeHash).toBe(a.recipeHash);
  });

  it("changes geometry identity when any recipe field changes", () => {
    const base = generateTextGeometry(recipe());
    for (const change of [
      { text: "SUPER RALLY!" },
      { weight: "BOLD" as const },
      { style: "ITALIC" as const },
      { letterSpacingEm: 1.2 },
      { outlineRatio: 0.5 },
      { bandOffsetEm: 0.5 },
      { seed: 8 },
    ]) {
      const next = generateTextGeometry(recipe(change));
      expect(next.recipeHash, JSON.stringify(change)).not.toBe(base.recipeHash);
      expect(JSON.stringify(next.points), JSON.stringify(change)).not.toBe(JSON.stringify(base.points));
    }
  });

  it("shifts the block horizontally when alignment changes in a height-bound box", () => {
    const box = { widthMeters: 400, heightMeters: 30 } as const;
    const left = generateTextGeometry(recipe({ ...box, alignment: "LEFT" }));
    const right = generateTextGeometry(recipe({ ...box, alignment: "RIGHT" }));
    const centre = (points: readonly (readonly [number, number, number])[]) =>
      points.reduce((sum, p) => sum + p[0], 0) / points.length;
    expect(centre(left.points)).toBeLessThan(centre(right.points));
    expect(left.recipeHash).not.toBe(right.recipeHash);
  });

  it("keeps every point inside the requested bounding box", () => {
    const r = recipe();
    const result = generateTextGeometry(r);
    for (const [x, y, z] of result.points) {
      expect(Math.abs(x)).toBeLessThanOrEqual(r.widthMeters / 2 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(r.heightMeters / 2 + 1e-9);
      expect(z).toBe(0);
    }
  });

  it("produces no duplicate positions across supported glyphs and weights", () => {
    const text = SUPPORTED_GLYPHS.join("").trim();
    for (const weight of ["LIGHT", "REGULAR", "BOLD"] as const) {
      const result = generateTextGeometry(
        recipe({ text, weight, participation: 300, widthMeters: 400, heightMeters: 40 }),
      );
      const keys = result.points.map(([x, y]) => `${x.toFixed(6)}|${y.toFixed(6)}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("scales participation from 1 to 400 without losing exactness", () => {
    for (const participation of [1, 2, 7, 37, 150, 400]) {
      expect(generateTextGeometry(recipe({ participation })).points).toHaveLength(participation);
    }
  });

  it("fails loudly on unsupported input instead of silently degrading", () => {
    expect(() => generateTextGeometry(recipe({ text: "   " }))).toThrow(TextGeometryError);
    expect(() => generateTextGeometry(recipe({ text: "RALLY@" }))).toThrow(/glyph pack/i);
    expect(() => generateTextGeometry(recipe({ participation: 0 }))).toThrow(TextGeometryError);
    expect(() => generateTextGeometry(recipe({ widthMeters: 0 }))).toThrow(TextGeometryError);
    expect(() => generateTextGeometry(recipe({ outlineRatio: 0 }))).toThrow(TextGeometryError);
    expect(() =>
      generateTextGeometry({ ...recipe(), glyphPackId: "system-font" }),
    ).toThrow(/unknown glyph pack/i);
  });

  it("carries a reproducible recipe on the formation asset", () => {
    const { formation } = makeTextFormation({ id: "f-text-1", name: "Text", recipe: recipe() });
    expect(formation.kind).toBe("text");
    expect(formation.text?.recipe.glyphPackId).toBe(GLYPH_PACK_ID);
    expect(formation.text?.recipe.glyphPackVersion).toBe(GLYPH_PACK_VERSION);
    expect(formation.points).toHaveLength(150);
    expect(verifyTextFormation(formation)).toEqual({ reproducible: true });
  });

  it("detects drift when persisted points no longer match the recipe", () => {
    const { formation } = makeTextFormation({ id: "f-text-2", name: "Text", recipe: recipe() });
    const tampered = {
      ...formation,
      points: formation.points.map((p, i) => (i === 3 ? ([p[0] + 1, p[1], p[2]] as [number, number, number]) : p)),
    };
    expect(verifyTextFormation(tampered).reproducible).toBe(false);
  });
});
