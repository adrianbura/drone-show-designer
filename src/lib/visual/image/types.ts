/**
 * REFERENCE IMAGE ANALYSIS — domain model (Sprint 8B1).
 *
 * The image pipeline is a PRODUCER of `VisualFormationDesign`. It never produces
 * formation points: the deterministic Drone Art Compiler
 * (src/lib/visual/compiler.ts) remains the single exact-N authority.
 *
 *   IMAGE -> deterministic analysis -> VisualFormationDesign
 *         -> compileVisualFormation() -> exact-N Formation -> Formation Library
 *
 * Everything in this package is pure and local: no network, no upload, no worker,
 * no external CV dependency. Enum values and keys are language-neutral.
 *
 * 8B1 SCOPE NOTE: the analysis reports SILHOUETTE, COMPONENTS, HOLES and REGIONS
 * only. It makes NO semantic claim (no wing/head/body/tail recognition) and
 * synthesises NO internal strokes (medial/ridge/skeleton work is deferred).
 */

/** Analysis-space raster image (RGBA, 8 bit per channel, row major). */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** length === width * height * 4 */
  readonly data: Uint8ClampedArray;
}

/** Structural richness of the extraction. Also drives analysis resolution. */
export type ImageDetailLevel = "LOW" | "MEDIUM" | "HIGH";

/**
 * How the extracted structure is expressed as primitives.
 * - OUTLINE: outer contours of the kept components only.
 * - STRUCTURAL: outer contours + holes + secondary meaningful components.
 * - FILLED: filled regions (with holes) plus the essential outer contour.
 */
export type ImageStructureMode = "OUTLINE" | "STRUCTURAL" | "FILLED";

/** What the image background is. AUTO estimates it from the border ring. */
export type ImageBackgroundMode = "AUTO" | "LIGHT" | "DARK";

export interface ImageAnalysisOptions {
  readonly detail?: ImageDetailLevel | undefined;
  readonly structure?: ImageStructureMode | undefined;
  readonly background?: ImageBackgroundMode | undefined;
  /** Extra simplification multiplier applied to the RDP epsilon. [0.25, 4]. */
  readonly simplify?: number | undefined;
  /** Provenance only — never pixels. */
  readonly sourceName?: string | undefined;
}

export interface ResolvedImageAnalysisOptions {
  readonly detail: ImageDetailLevel;
  readonly structure: ImageStructureMode;
  readonly background: ImageBackgroundMode;
  readonly simplify: number;
}

/** Polarity actually used, after AUTO resolution. */
export type ResolvedPolarity = "LIGHT" | "DARK" | "ALPHA";

/** Closed ring in analysis pixel coordinates (X right, Y DOWN). */
export type PixelRing = readonly (readonly [number, number])[];

export interface ImageComponent {
  readonly id: number;
  /** Foreground pixel count in analysis resolution. */
  readonly area: number;
  readonly outer: PixelRing;
  readonly holes: readonly PixelRing[];
  readonly bbox: readonly [number, number, number, number];
}

export interface ImageAnalysisDiagnostics {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly analysisWidth: number;
  readonly analysisHeight: number;
  readonly polarity: ResolvedPolarity;
  readonly threshold: number;
  readonly foregroundRatio: number;
  readonly componentsFound: number;
  readonly componentsKept: number;
  readonly componentsDropped: number;
  readonly holesFound: number;
  readonly holesKept: number;
  readonly rawContourPoints: number;
  readonly simplifiedContourPoints: number;
  readonly rdpEpsilon: number;
  /** Milliseconds, best effort. */
  readonly decodeMs?: number | undefined;
  readonly analysisMs?: number | undefined;
}

export interface ImageAnalysisResult {
  readonly options: ResolvedImageAnalysisOptions;
  readonly components: readonly ImageComponent[];
  readonly diagnostics: ImageAnalysisDiagnostics;
  /** Deterministic fingerprint of (mask + options). Never contains pixels. */
  readonly fingerprint: string;
}

export type ImageAnalysisErrorCode =
  | "UNSUPPORTED_TYPE"
  | "FILE_TOO_LARGE"
  | "DECODE_FAILED"
  | "DIMENSIONS_TOO_LARGE"
  | "PIXELS_TOO_LARGE"
  | "EMPTY_IMAGE"
  | "NO_STRUCTURE";

export class ImageAnalysisError extends Error {
  readonly code: ImageAnalysisErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: ImageAnalysisErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ImageAnalysisError";
    this.code = code;
    this.details = details;
  }
}

export const IMAGE_ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const IMAGE_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const IMAGE_MAX_EDGE = 8192;
export const IMAGE_MAX_PIXELS = 40_000_000;
/** Maximum analysis long edge. Analysis never runs at source resolution. */
export const IMAGE_ANALYSIS_MAX_EDGE = 512;

export const IMAGE_ANALYSIS_VERSION = "1.0.0";

interface DetailProfile {
  readonly analysisEdge: number;
  /** Minimum component area as a fraction of the largest component. */
  readonly minComponentAreaFrac: number;
  readonly maxComponents: number;
  /** Minimum hole area as a fraction of its parent component. */
  readonly minHoleAreaFrac: number;
  readonly maxHolesPerComponent: number;
  /** RDP epsilon as a fraction of the analysis long edge. */
  readonly epsilonFrac: number;
  /** Hard cap on simplified points per ring. */
  readonly maxRingPoints: number;
  /** Morphological opening/closing radius in analysis pixels. */
  readonly morphRadius: number;
}

export const DETAIL_PROFILES: Readonly<Record<ImageDetailLevel, DetailProfile>> = {
  LOW: {
    analysisEdge: 256,
    minComponentAreaFrac: 0.04,
    maxComponents: 4,
    minHoleAreaFrac: 0.06,
    maxHolesPerComponent: 2,
    epsilonFrac: 0.014,
    maxRingPoints: 96,
    morphRadius: 1,
  },
  MEDIUM: {
    analysisEdge: 384,
    minComponentAreaFrac: 0.012,
    maxComponents: 10,
    minHoleAreaFrac: 0.02,
    maxHolesPerComponent: 6,
    epsilonFrac: 0.006,
    maxRingPoints: 220,
    morphRadius: 1,
  },
  HIGH: {
    analysisEdge: IMAGE_ANALYSIS_MAX_EDGE,
    minComponentAreaFrac: 0.004,
    maxComponents: 20,
    minHoleAreaFrac: 0.008,
    maxHolesPerComponent: 12,
    epsilonFrac: 0.0028,
    maxRingPoints: 420,
    morphRadius: 1,
  },
};

export function resolveImageAnalysisOptions(
  options: ImageAnalysisOptions = {},
): ResolvedImageAnalysisOptions {
  const simplify = Number.isFinite(options.simplify) ? (options.simplify as number) : 1;
  return {
    detail: options.detail ?? "MEDIUM",
    structure: options.structure ?? "STRUCTURAL",
    background: options.background ?? "AUTO",
    simplify: Math.min(4, Math.max(0.25, simplify)),
  };
}
