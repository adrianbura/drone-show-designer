/**
 * CANONICAL PROVENANCE MAPPING — VisualDesignMetadata.sourceType -> library source.
 *
 * Provenance must follow the DESIGN, never the UI button that happened to save
 * the asset. This is the single mapping used by every producer (built-in designs,
 * image analysis, future AI generation, manual authoring).
 *
 *   BUILT_IN       -> BUILT_IN
 *   IMAGE_ANALYSIS -> IMPORTED
 *   AI_GENERATED   -> AI_GENERATED
 *   MANUAL         -> USER
 */
import type { FormationAssetSource } from "../library/types";
import type { VisualFormationDesign, VisualSourceType } from "./types";

const MAP: Readonly<Record<VisualSourceType, FormationAssetSource>> = {
  BUILT_IN: "BUILT_IN",
  IMAGE_ANALYSIS: "IMPORTED",
  AI_GENERATED: "AI_GENERATED",
  MANUAL: "USER",
};

export function assetSourceFromDesignSourceType(
  sourceType: VisualSourceType,
): FormationAssetSource {
  return MAP[sourceType] ?? "USER";
}

export function assetSourceForDesign(design: VisualFormationDesign): FormationAssetSource {
  return assetSourceFromDesignSourceType(design.metadata.sourceType);
}
