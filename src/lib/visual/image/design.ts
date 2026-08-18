/**
 * ANALYSIS -> VisualFormationDesign.
 *
 * This is the only place the image package produces the canonical IR. It emits
 * generic primitives with NO semantic claim: parts are not named, no wing / head
 * / body / tail recognition happens in 8B1. Priorities are geometric (relative
 * area / role), which is enough for the compiler's budget allocator.
 */
import {
  VISUAL_DESIGN_SCHEMA_VERSION,
  type DesignPoint,
  type VisualFormationDesign,
  type VisualPrimitive,
  type VisualSourceType,
} from "../types";
import type { ImageAnalysisResult, PixelRing } from "./types";

export interface DesignFromAnalysisInput {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  /** Original file name, used for provenance only. Never pixels. */
  readonly sourceName?: string | undefined;
  readonly createdAt?: string | undefined;
  /**
   * Canonical provenance of the RASTER that was analysed. Defaults to
   * IMAGE_ANALYSIS (a local import); an AI-generated reference passes
   * AI_GENERATED so assetSourceForDesign() stays the only mapping authority.
   */
  readonly sourceType?: VisualSourceType | undefined;
  /** Compact, pixel-free provenance extras (e.g. the AI drone count). */
  readonly provenance?: Readonly<Record<string, string | number | boolean>> | undefined;
}

interface Mapper {
  (ring: PixelRing): DesignPoint[];
}

/**
 * Analysis pixel space (X right, Y DOWN, origin top-left) -> design space
 * (X right, Y UP, origin centred, long edge normalised to 1).
 */
function makeMapper(width: number, height: number): { map: Mapper; width: number; height: number } {
  const longEdge = Math.max(width, height) || 1;
  const map: Mapper = (ring) =>
    ring.map((p) => [(p[0] + 0.5 - width / 2) / longEdge, (height / 2 - (p[1] + 0.5)) / longEdge]);
  return { map, width: width / longEdge, height: height / longEdge };
}

export function designFromAnalysis(
  analysis: ImageAnalysisResult,
  input: DesignFromAnalysisInput = {},
): VisualFormationDesign {
  const { map, width, height } = makeMapper(
    analysis.diagnostics.analysisWidth,
    analysis.diagnostics.analysisHeight,
  );
  const structure = analysis.options.structure;
  const largestArea = analysis.components[0]?.area ?? 1;
  const primitives: VisualPrimitive[] = [];

  analysis.components.forEach((component, index) => {
    const rel = component.area / Math.max(1, largestArea);
    const primary = index === 0;
    const outline = map(component.outer);
    const contourPriority = primary ? 1 : Math.max(0.35, Math.min(0.9, 0.35 + rel * 0.55));

    if (structure === "FILLED") {
      primitives.push({
        type: "REGION",
        id: `img-region-${component.id}`,
        priority: primary ? 0.9 : contourPriority * 0.8,
        essential: primary,
        minPoints: primary ? 12 : 4,
        outline,
        holes: component.holes.map((h) => map(h)),
      });
    }

    primitives.push({
      type: "CLOSED_CONTOUR",
      id: `img-outer-${component.id}`,
      priority: contourPriority,
      essential: primary,
      minPoints: primary ? 16 : 5,
      path: outline,
    });

    if (structure !== "OUTLINE") {
      component.holes.forEach((hole, hi) => {
        primitives.push({
          type: "CLOSED_CONTOUR",
          id: `img-hole-${component.id}-${hi}`,
          priority: Math.max(0.3, contourPriority * 0.7),
          minPoints: 4,
          path: map(hole),
        });
      });
    }
  });

  const sourceType = input.sourceType ?? "IMAGE_ANALYSIS";
  const sourceRef = JSON.stringify({
    kind: sourceType,
    file: input.sourceName ?? analysis.options.detail,
    fingerprint: analysis.fingerprint,
    detail: analysis.options.detail,
    structure: analysis.options.structure,
    background: analysis.options.background,
    simplify: analysis.options.simplify,
    polarity: analysis.diagnostics.polarity,
    ...(input.provenance ?? {}),
  });

  return {
    schemaVersion: VISUAL_DESIGN_SCHEMA_VERSION,
    id: input.id ?? `img-${analysis.fingerprint}`,
    name: input.name ?? input.sourceName ?? "Reference image",
    version: 1,
    // No semantic parts are claimed, so the design stays a 2D contour design.
    mode: "CONTOUR_2D",
    coordinateSpace: "DESIGN_XY",
    primitives,
    semanticParts: [],
    symmetry: "NONE",
    bounds: { width, height, depth: 0 },
    defaultStyle:
      structure === "FILLED" ? "FILLED" : structure === "OUTLINE" ? "OUTLINE" : "STRUCTURAL",
    fillBias: structure === "FILLED" ? "FILL_HEAVY" : "CONTOUR_HEAVY",
    metadata: {
      sourceType,
      tags: [
        "image",
        `detail:${analysis.options.detail}`,
        `structure:${structure}`,
        ...(sourceType === "AI_GENERATED" ? ["ai-reference"] : []),
      ],
      notes: "Deterministic local image analysis. No semantic part recognition.",
      sourceRef,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  };
}
