/**
 * Built-in VisualFormationDesign catalogue.
 *
 * Simple geometry (circle, ring, star, heart, spiral, wave, sphere) deliberately
 * stays with the existing procedural generators in src/lib/show/formations.ts and
 * src/lib/ai/geometry.ts — a parametric circle needs no artwork description.
 * Designs live here only when they carry real artistic structure.
 */
import type { VisualFormationDesign } from "../types";
import { BUTTERFLY_DESIGN } from "./butterfly";
import { CAR_DESIGN } from "./car";
import { PIGEON_DESIGN } from "./pigeon";
import { PORTRAIT_DESIGN } from "./portrait";

export { BUTTERFLY_DESIGN, CAR_DESIGN, PIGEON_DESIGN, PORTRAIT_DESIGN };
export * from "./util";

export const BUILT_IN_DESIGNS: readonly VisualFormationDesign[] = [
  PIGEON_DESIGN,
  BUTTERFLY_DESIGN,
  PORTRAIT_DESIGN,
  CAR_DESIGN,
];

export function findBuiltInDesign(id: string): VisualFormationDesign | null {
  return BUILT_IN_DESIGNS.find((d) => d.id === id) ?? null;
}
