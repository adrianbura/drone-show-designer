/**
 * SHAPE & FIGURE LIBRARY — catalogue integrity and compiler behaviour.
 */
import { describe, expect, it } from "vitest";

import {
  BUILT_IN_DESIGNS,
  FIGURE_CATEGORIES,
  FIGURE_DESIGNS,
  categoryOfDesign,
  compileVisualFormation,
  findBuiltInDesign,
  groupDesignsByCategory,
  matchesDesignSearch,
  validateDesign,
} from "@/lib/visual";

describe("figure library", () => {
  it("ships a browsable set of valid figures with unique ids", () => {
    expect(FIGURE_DESIGNS.length).toBeGreaterThanOrEqual(10);
    const ids = new Set(BUILT_IN_DESIGNS.map((d) => d.id));
    expect(ids.size).toBe(BUILT_IN_DESIGNS.length);
    for (const design of FIGURE_DESIGNS) {
      expect(validateDesign(design)).toEqual([]);
      expect(findBuiltInDesign(design.id)).toBe(design);
      expect(FIGURE_CATEGORIES).toContain(categoryOfDesign(design));
    }
  });

  it("compiles every figure to exactly the requested drone count", () => {
    for (const design of FIGURE_DESIGNS) {
      for (const count of [12, 60, 150, 400]) {
        const compiled = compileVisualFormation(design, count, { width: 100, altitude: 60 });
        expect(compiled.points.length).toBe(count);
        expect(compiled.colors.length).toBe(count);
      }
    }
  });

  it("is deterministic for identical inputs", () => {
    const design = FIGURE_DESIGNS[0]!;
    const a = compileVisualFormation(design, 90, { width: 100, altitude: 60 });
    const b = compileVisualFormation(design, 90, { width: 100, altitude: 60 });
    expect(b.points).toEqual(a.points);
  });

  it("searches by name and by tag, case-insensitively", () => {
    const heart = findBuiltInDesign("figure-heart")!;
    expect(matchesDesignSearch(heart, "HEART")).toBe(true);
    expect(matchesDesignSearch(heart, "love")).toBe(true);
    expect(matchesDesignSearch(heart, "")).toBe(true);
    expect(matchesDesignSearch(heart, "rocket")).toBe(false);
  });

  it("groups designs by category without losing or duplicating any", () => {
    const groups = groupDesignsByCategory(BUILT_IN_DESIGNS);
    const flat = groups.flatMap((g) => g.designs);
    expect(flat.length).toBe(BUILT_IN_DESIGNS.length);
    expect(new Set(flat.map((d) => d.id)).size).toBe(BUILT_IN_DESIGNS.length);
    expect(groupDesignsByCategory([])).toEqual([]);
  });
});
