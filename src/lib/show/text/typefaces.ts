/**
 * GLYPH PACK REGISTRY — the closed set of geometry sources text may use.
 *
 * Every persisted recipe names its pack by id + version, so a show reopened on
 * another machine regenerates the same points. Adding a pack NEVER changes the
 * geometry of existing recipes; removing or editing one would, which is why
 * generated packs are immutable and bumped by id (`...-v2`) instead.
 *
 * Pure module: no React, no I/O, no font parsing.
 */
import { STROKE_PACK, type GlyphPackDefinition } from "./glyphPack";
import { ARCHIVO_WIDE_V1_PACK } from "./typefaceArchivo.generated";

export const GLYPH_PACKS: readonly GlyphPackDefinition[] = [STROKE_PACK, ARCHIVO_WIDE_V1_PACK];

/** Default for new recipes: unchanged legacy stroke pack (stable identity). */
export const DEFAULT_GLYPH_PACK_ID = STROKE_PACK.id;

export function glyphPackById(id: string): GlyphPackDefinition | undefined {
  return GLYPH_PACKS.find((pack) => pack.id === id);
}

export function packSupportsGlyph(pack: GlyphPackDefinition, character: string): boolean {
  return Object.prototype.hasOwnProperty.call(pack.glyphs, character);
}

export function supportedGlyphsOf(pack: GlyphPackDefinition): readonly string[] {
  return Object.keys(pack.glyphs).sort();
}
