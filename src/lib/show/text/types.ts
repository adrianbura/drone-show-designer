/**
 * DETERMINISTIC TEXT RECIPE — persisted authoring intent for text geometry.
 *
 * A recipe is the COMPLETE input of the generator: identical recipe input must
 * produce identical local-metre points in the browser, in tests, after
 * Save/Open and in export. Nothing outside this object (no canvas, no system
 * font, no locale, no clock, no RNG) may influence the output.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { Vec3 } from "../types";

export const TEXT_RECIPE_SCHEMA_VERSION = 1;
/** Bumped whenever an identical recipe can resolve to different geometry. */
export const TEXT_GEOMETRY_ALGORITHM_VERSION = "1.0.0";

export type TextWeight = "LIGHT" | "REGULAR" | "BOLD";
export type TextStyle = "UPRIGHT" | "ITALIC";
export type TextAlignment = "LEFT" | "CENTER" | "RIGHT";

export interface TextGeometryRecipe {
  readonly schemaVersion: number;
  readonly algorithmVersion: string;
  /** Bundled glyph pack identity — never a CSS/system font. */
  readonly glyphPackId: string;
  readonly glyphPackVersion: number;
  /** Replacement text ENTERED BY THE OPERATOR. Never inferred, never OCR'd. */
  readonly text: string;
  readonly weight: TextWeight;
  readonly style: TextStyle;
  /** Requested bounding box in show-local metres. */
  readonly widthMeters: number;
  readonly heightMeters: number;
  /**
   * Altitude (metres, Y axis) of the text block's vertical centre. The glyph
   * plane is authored around Y = 0, so a real show must anchor it explicitly:
   * without this the lower half of every letter would sit below ground.
   */
  readonly centerAltitudeMeters: number;
  /** Extra advance between glyphs, in em units. */
  readonly letterSpacingEm: number;
  readonly alignment: TextAlignment;
  /** Number of ACTIVE drones the geometry must occupy, exactly. */
  readonly participation: number;
  /** Fraction of points placed on the primary (outline) band, 0 < r <= 1. */
  readonly outlineRatio: number;
  /** Perpendicular spacing between fill bands, in em units. */
  readonly bandOffsetEm: number;
  /** Deterministic seed. Only steers documented tie-breaks, never randomness. */
  readonly seed: number;
}

export type TextGeometryErrorCode =
  | "EMPTY_TEXT"
  | "UNSUPPORTED_GLYPH"
  | "GLYPH_PACK_MISMATCH"
  | "INVALID_PARTICIPATION"
  | "INVALID_BOUNDS"
  | "INVALID_DISTRIBUTION"
  | "NO_GEOMETRY"
  | "DUPLICATE_POSITION"
  | "POINT_COUNT_MISMATCH";

export class TextGeometryError extends Error {
  readonly code: TextGeometryErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: TextGeometryErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "TextGeometryError";
    this.code = code;
    this.details = details;
  }
}

export interface TextGeometryResult {
  readonly recipe: TextGeometryRecipe;
  /** Show-local metres, +Y up, centred on the requested box, z = 0. */
  readonly points: readonly Vec3[];
  /** Stable ids, index aligned with `points`, unique by construction. */
  readonly pointIds: readonly string[];
  /** Deterministic fingerprint of the recipe (identity of the geometry). */
  readonly recipeHash: string;
  readonly bounds: {
    readonly widthMeters: number;
    readonly heightMeters: number;
  };
}

/**
 * PERSISTED PROVENANCE of a planner-owned text formation. Stored on the
 * formation so Save -> Open reproduces identical geometry from the recipe alone.
 */
export interface TextFormationSource {
  readonly recipe: TextGeometryRecipe;
  readonly recipeHash: string;
  /** Stable ids, index aligned with the formation points. */
  readonly pointIds: readonly string[];
  /** Clip the text was authored for. Provenance only; may dangle. */
  readonly authoredForClipId?: string;
  /** Object (scene instance) the text replaced, when the clip had a scene. */
  readonly authoredForObjectId?: string;
}
