/**
 * TEXT RECIPE -> PLANNER-OWNED FORMATION ASSET.
 *
 * The formation carries the recipe, its hash and the stable point ids, so the
 * geometry is reproducible from persisted data alone (no canvas, no fonts).
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { Formation } from "../types";
import { generateTextGeometry } from "./generate";
import type { TextFormationSource, TextGeometryRecipe, TextGeometryResult } from "./types";

export interface TextFormationInput {
  readonly id: string;
  readonly name: string;
  readonly recipe: TextGeometryRecipe;
  readonly authoredForClipId?: string;
  readonly authoredForObjectId?: string;
}

export function makeTextFormation(input: TextFormationInput): {
  readonly formation: Formation;
  readonly geometry: TextGeometryResult;
} {
  const geometry = generateTextGeometry(input.recipe);
  const source: TextFormationSource = {
    recipe: input.recipe,
    recipeHash: geometry.recipeHash,
    pointIds: geometry.pointIds,
    ...(input.authoredForClipId ? { authoredForClipId: input.authoredForClipId } : {}),
    ...(input.authoredForObjectId ? { authoredForObjectId: input.authoredForObjectId } : {}),
  };
  return {
    geometry,
    formation: {
      id: input.id,
      name: input.name,
      kind: "text",
      points: geometry.points.map((p) => [p[0], p[1], p[2]] as [number, number, number]),
      params: {
        text: input.recipe.text,
        recipeHash: geometry.recipeHash,
        participation: input.recipe.participation,
        seed: input.recipe.seed,
        glyphPackId: input.recipe.glyphPackId,
      },
      text: source,
    },
  };
}

/** Regenerates the points of a persisted text formation and reports drift. */
export function verifyTextFormation(formation: Formation): {
  readonly reproducible: boolean;
  readonly reason?: string;
} {
  if (!formation.text) return { reproducible: false, reason: "NO_RECIPE" };
  const geometry = generateTextGeometry(formation.text.recipe);
  if (geometry.recipeHash !== formation.text.recipeHash) {
    return { reproducible: false, reason: "RECIPE_HASH_DRIFT" };
  }
  if (geometry.points.length !== formation.points.length) {
    return { reproducible: false, reason: "POINT_COUNT_DRIFT" };
  }
  for (let i = 0; i < geometry.points.length; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (Math.abs(geometry.points[i]![axis]! - formation.points[i]![axis]!) > 1e-9) {
        return { reproducible: false, reason: "GEOMETRY_DRIFT" };
      }
    }
  }
  return { reproducible: true };
}
