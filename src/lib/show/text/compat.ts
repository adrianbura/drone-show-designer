/**
 * PERSISTED TEXT RECIPE COMPATIBILITY POLICY.
 *
 * THE RULE: a persisted recipe is only regenerated when its schema AND
 * algorithm version match the current generator exactly. Anything else is
 * LEGACY and is never silently re-interpreted, because:
 *
 *   - schema 1 recipes carried NO altitude intent (the glyph plane was centred
 *     on Y = 0). Reading such a recipe as schema 2 would invent an altitude the
 *     operator never authored and move the whole formation.
 *   - an algorithm bump means an identical recipe can resolve to different
 *     points, so the persisted geometry and a fresh generation may disagree.
 *
 * WHAT THE APP DOES WITH A LEGACY RECIPE
 *   1. the persisted POINTS stay authoritative — an opened show keeps flying
 *      exactly what was saved (no geometry is rewritten on Open);
 *   2. the text EDITOR refuses to rebuild it until the operator upgrades it
 *      explicitly, supplying the altitude decision;
 *   3. the upgrade produces a NEW recipe stamped with the current versions, and
 *      that upgraded recipe must go through the normal preview -> canonical
 *      readiness -> Apply path like any other edit.
 *
 * Pure module: no React, no I/O.
 */
import { makeTextRecipe } from "./generate";
import {
  TEXT_GEOMETRY_ALGORITHM_VERSION,
  TEXT_RECIPE_SCHEMA_VERSION,
  type TextGeometryRecipe,
} from "./types";

export type TextRecipeCompatibility =
  /** Same schema and algorithm: safe to regenerate. */
  | "CURRENT"
  /** Known older schema/algorithm: readable as data, never regenerated. */
  | "LEGACY_UPGRADE_REQUIRED"
  /** Newer than this build, or unrecognised: refuse everything. */
  | "UNSUPPORTED";

export interface TextRecipeCompatibilityReport {
  readonly compatibility: TextRecipeCompatibility;
  readonly regenerable: boolean;
  /** True only when `upgradeLegacyTextRecipe` can produce a current recipe. */
  readonly upgradable: boolean;
  readonly recipeSchemaVersion: number;
  readonly recipeAlgorithmVersion: string;
  readonly currentSchemaVersion: number;
  readonly currentAlgorithmVersion: string;
  /** Fields the operator must decide before an upgrade is allowed. */
  readonly missingFields: readonly string[];
  readonly note: string;
}

function hasAltitude(recipe: TextGeometryRecipe): boolean {
  return Number.isFinite((recipe as { centerAltitudeMeters?: number }).centerAltitudeMeters);
}

export function classifyPersistedTextRecipe(
  recipe: TextGeometryRecipe,
): TextRecipeCompatibilityReport {
  const base = {
    recipeSchemaVersion: recipe.schemaVersion,
    recipeAlgorithmVersion: recipe.algorithmVersion,
    currentSchemaVersion: TEXT_RECIPE_SCHEMA_VERSION,
    currentAlgorithmVersion: TEXT_GEOMETRY_ALGORITHM_VERSION,
  };
  if (
    recipe.schemaVersion === TEXT_RECIPE_SCHEMA_VERSION &&
    recipe.algorithmVersion === TEXT_GEOMETRY_ALGORITHM_VERSION
  ) {
    return {
      ...base,
      compatibility: "CURRENT",
      regenerable: true,
      upgradable: false,
      missingFields: [],
      note: "Recipe matches the current text geometry version and reproduces its persisted points.",
    };
  }
  if (recipe.schemaVersion > TEXT_RECIPE_SCHEMA_VERSION) {
    return {
      ...base,
      compatibility: "UNSUPPORTED",
      regenerable: false,
      upgradable: false,
      missingFields: [],
      note: "Recipe was written by a newer version of the app; this build must not guess its meaning.",
    };
  }
  const missingFields = hasAltitude(recipe) ? [] : ["centerAltitudeMeters"];
  return {
    ...base,
    compatibility: "LEGACY_UPGRADE_REQUIRED",
    regenerable: false,
    upgradable: true,
    missingFields,
    note:
      missingFields.length > 0
        ? "Legacy recipe: it carries no altitude intent, so it can only be rebuilt after the operator sets the text altitude explicitly."
        : "Legacy recipe: the geometry algorithm changed, so it must be re-authored explicitly before it is regenerated.",
  };
}

export interface TextRecipeUpgradeDecision {
  /** Explicit operator decision. Required for schema-1 recipes. */
  readonly centerAltitudeMeters: number;
}

export type TextRecipeUpgradeResult =
  | { readonly ok: true; readonly recipe: TextGeometryRecipe; readonly note: string }
  | { readonly ok: false; readonly reason: string; readonly note: string };

/**
 * EXPLICIT upgrade. Never called implicitly on Open: the result is a different
 * recipe identity (different hash) and therefore different geometry, so it must
 * be reviewed through preview + canonical readiness before Apply.
 */
export function upgradeLegacyTextRecipe(
  recipe: TextGeometryRecipe,
  decision: TextRecipeUpgradeDecision,
): TextRecipeUpgradeResult {
  const report = classifyPersistedTextRecipe(recipe);
  if (report.compatibility === "CURRENT") {
    return {
      ok: false,
      reason: "ALREADY_CURRENT",
      note: "The recipe already matches the current version; there is nothing to upgrade.",
    };
  }
  if (!report.upgradable) {
    return { ok: false, reason: report.compatibility, note: report.note };
  }
  if (!Number.isFinite(decision.centerAltitudeMeters)) {
    return {
      ok: false,
      reason: "ALTITUDE_DECISION_REQUIRED",
      note: "Upgrading a legacy text recipe requires an explicit text altitude in metres.",
    };
  }
  return {
    ok: true,
    recipe: makeTextRecipe({
      text: recipe.text,
      weight: recipe.weight,
      style: recipe.style,
      widthMeters: recipe.widthMeters,
      heightMeters: recipe.heightMeters,
      centerAltitudeMeters: decision.centerAltitudeMeters,
      letterSpacingEm: recipe.letterSpacingEm,
      alignment: recipe.alignment,
      participation: recipe.participation,
      outlineRatio: recipe.outlineRatio,
      bandOffsetEm: recipe.bandOffsetEm,
      seed: recipe.seed,
    }),
    note: "Upgraded recipe stamped with the current schema/algorithm. Its geometry identity changed, so it needs fresh canonical readiness evidence before Apply.",
  };
}
