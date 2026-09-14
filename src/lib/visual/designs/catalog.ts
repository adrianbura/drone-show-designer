/**
 * SHAPE & FIGURE CATALOGUE — pure browsing projection over the built-in designs.
 *
 * Categories are presentation grouping only: they carry no geometry and never
 * change what the compiler produces. Search matches the design name, id and its
 * metadata tags, all case-insensitively.
 */
import type { VisualFormationDesign } from "../types";

export type FigureCategoryId = "SYMBOL" | "NATURE" | "PEOPLE" | "OBJECT" | "ABSTRACT";

export const FIGURE_CATEGORIES: readonly FigureCategoryId[] = [
  "SYMBOL",
  "NATURE",
  "PEOPLE",
  "OBJECT",
  "ABSTRACT",
];

const CATEGORY_BY_DESIGN: Readonly<Record<string, FigureCategoryId>> = {
  "builtin-pigeon": "NATURE",
  "builtin-butterfly": "NATURE",
  "builtin-portrait": "PEOPLE",
  "builtin-car": "OBJECT",
  "figure-heart": "SYMBOL",
  "figure-star": "SYMBOL",
  "figure-smiley": "PEOPLE",
  "figure-tree": "NATURE",
  "figure-rocket": "OBJECT",
  "figure-flower": "NATURE",
  "figure-moon": "SYMBOL",
  "figure-arrow": "SYMBOL",
  "figure-spiral": "ABSTRACT",
  "figure-ring": "ABSTRACT",
  "figure-mermaid": "PEOPLE",
};

export function categoryOfDesign(design: VisualFormationDesign): FigureCategoryId {
  return CATEGORY_BY_DESIGN[design.id] ?? "ABSTRACT";
}

export function matchesDesignSearch(design: VisualFormationDesign, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  const haystack = [design.name, design.id, ...(design.metadata.tags ?? [])]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

export interface FigureCategoryGroup {
  readonly category: FigureCategoryId;
  readonly designs: readonly VisualFormationDesign[];
}

/** Groups designs by category, preserving catalogue order and dropping empties. */
export function groupDesignsByCategory(
  designs: readonly VisualFormationDesign[],
): readonly FigureCategoryGroup[] {
  return FIGURE_CATEGORIES.map((category) => ({
    category,
    designs: designs.filter((d) => categoryOfDesign(d) === category),
  })).filter((group) => group.designs.length > 0);
}
