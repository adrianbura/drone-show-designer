/**
 * Built-in VisualFormationDesign catalogue.
 *
 * Simple point clouds (grid, circle, sphere, helix) deliberately stay with the
 * procedural generators in src/lib/show/formations.ts and src/lib/ai/geometry.ts
 * — a parametric circle needs no artwork description. Designs live here when
 * they carry real artistic structure: hand-authored figures and the parametric
 * shape & figure library.
 */
import type { VisualFormationDesign } from "../types";
import { BUTTERFLY_DESIGN } from "./butterfly";
import { CAR_DESIGN } from "./car";
import { FIGURE_DESIGNS } from "./figures";
import { PIGEON_DESIGN } from "./pigeon";
import { PORTRAIT_DESIGN } from "./portrait";

export { BUTTERFLY_DESIGN, CAR_DESIGN, PIGEON_DESIGN, PORTRAIT_DESIGN };
export * from "./util";
export * from "./figures";
export * from "./catalog";

export const BUILT_IN_DESIGNS: readonly VisualFormationDesign[] = [
  PIGEON_DESIGN,
  BUTTERFLY_DESIGN,
  PORTRAIT_DESIGN,
  CAR_DESIGN,
  ...FIGURE_DESIGNS,
];

export function findBuiltInDesign(id: string): VisualFormationDesign | null {
  return BUILT_IN_DESIGNS.find((d) => d.id === id) ?? null;
}
