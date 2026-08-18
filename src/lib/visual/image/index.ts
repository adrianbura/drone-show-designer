/**
 * REFERENCE IMAGE -> VISUAL FORMATION DESIGN — public surface.
 *
 * IMAGE -> analyzeImage() -> designFromAnalysis() -> compileVisualFormation().
 * The compiler stays the single exact-N authority; nothing here generates points.
 */
export * from "./types";
export * from "./luminance";
export * from "./mask";
export * from "./contours";
export * from "./simplify2d";
export * from "./analyze";
export * from "./design";
export { decodeImageFile, assertAcceptableFile, type DecodedImage } from "./decode";
