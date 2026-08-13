/**
 * SVG vector-formation engine — domain types.
 *
 * This package converts an untrusted SVG document into an EXACT-N point set in
 * show-local coordinates (see src/lib/show/coordinates.ts). It contains NO
 * assignment, trajectory or safety logic; those layers stay downstream:
 *
 *   SVG -> parse -> geometry -> normalize -> sample -> distribute -> Formation
 *        -> AssignmentEngine -> TrajectoryPlanner -> Sampler -> SafetyValidator
 *
 * Nothing here touches React, Three.js or the DOM.
 */
import type { Vector3Tuple } from "../types";

/** Version of the SVG sampling/distribution algorithm. Bump on behaviour change. */
export const SVG_ALGORITHM_VERSION = "0.1.0";

/** Default maximum accepted file size for an imported SVG (bytes). */
export const DEFAULT_MAX_SVG_BYTES = 5 * 1024 * 1024;

/** Two points closer than this (metres) are considered duplicates. */
export const DUPLICATE_EPSILON_M = 0.05;

/** 2D point in some 2D space (SVG user units, or normalized plane metres). */
export type Point2 = readonly [number, number];

/** Affine 2D matrix [a, b, c, d, e, f] as in SVG `matrix(...)`. */
export type Matrix2D = readonly [number, number, number, number, number, number];

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface Bounds3 {
  min: Vector3Tuple;
  max: Vector3Tuple;
}

/** A flattened polyline extracted from one SVG subpath. */
export interface Contour {
  id: string;
  /** Source element tag ("path", "circle", ...). */
  source: string;
  closed: boolean;
  /** Flattened polyline. For closed contours the first point is NOT repeated. */
  points: Point2[];
  /** Total polyline length (closing segment included when `closed`). */
  length: number;
  /** Geometry participates in outline (visible stroke, or any visible shape). */
  stroked: boolean;
  /** Geometry participates in fill (closed + visible fill). */
  filled: boolean;
  /** Effective fill rule of the owning element. */
  fillRule: FillRule;
}

export type FillRule = "nonzero" | "evenodd";

export interface SvgSourceMetadata {
  fileName: string;
  byteLength: number;
  viewBox: Bounds2 | null;
  declaredWidth: number | null;
  declaredHeight: number | null;
  elementCounts: Record<string, number>;
}

/** Normalized, canonical internal representation of the imported vector art. */
export interface SvgGeometry {
  bounds: Bounds2;
  contours: Contour[];
  /** Closed + filled contours, i.e. candidates for FILL sampling. */
  closedRegions: Contour[];
  sourceMetadata: SvgSourceMetadata;
  warnings: SvgWarning[];
}

export type SvgWarningCode =
  | "LIVE_TEXT_PRESENT"
  | "RASTER_IMAGE_PRESENT"
  | "MASK_UNSUPPORTED"
  | "CLIP_PATH_PARTIAL_SUPPORT"
  | "FILTER_UNSUPPORTED"
  | "ACTIVE_CONTENT_STRIPPED"
  | "REMOTE_RESOURCE_IGNORED"
  | "UNSUPPORTED_GEOMETRY"
  | "UNSUPPORTED_TRANSFORM"
  | "SMALL_CONTOUR_DROPPED"
  | "NO_FILLED_GEOMETRY"
  | "LOW_DRONE_COUNT_FOR_COMPLEX_LOGO"
  | "DUPLICATE_POINTS"
  | "SHOW_AREA_EXCEEDED"
  | "ALTITUDE_LIMIT_EXCEEDED";

export interface SvgWarning {
  code: SvgWarningCode;
  message: string;
  details?: string;
}

export type SvgErrorCode =
  | "INVALID_SVG"
  | "EMPTY_GEOMETRY"
  | "UNSUPPORTED_GEOMETRY"
  | "NO_VISIBLE_GEOMETRY"
  | "TARGET_COUNT_INVALID"
  | "SAMPLING_FAILED"
  | "DUPLICATE_POINTS"
  | "INVALID_TRANSFORM"
  | "FILE_TOO_LARGE";

/** Structured, user-presentable failure. Never surfaces a raw stack trace. */
export interface SvgFormationError {
  code: SvgErrorCode;
  message: string;
  details?: string;
}

export class SvgError extends Error {
  readonly code: SvgErrorCode;
  readonly details?: string;
  constructor(code: SvgErrorCode, message: string, details?: string) {
    super(message);
    this.name = "SvgError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
  toStructured(): SvgFormationError {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export type SvgSamplingMode = "outline" | "fill";

/**
 * Orientation of the logo plane inside the show volume. Only `front` (vertical,
 * facing the audience along -Z) is implemented in this sprint; the extra members
 * exist so the representation does not need rewriting later.
 */
export type SvgPlaneOrientation = "front" | "horizontal" | "custom";

/** Everything needed to reproduce a point set bit-for-bit. */
export interface SvgFormationParams {
  mode: SvgSamplingMode;
  targetCount: number;
  /** Logo width in metres; height follows from the aspect ratio when locked. */
  width: number;
  /** Explicit height, used only when `lockAspect` is false. */
  height: number;
  lockAspect: boolean;
  /** Centre of the logo plane: X (metres, show frame). */
  positionX: number;
  /** Centre altitude of the logo plane (metres, +Y up). */
  altitude: number;
  /** Depth offset along +Z (metres). */
  depth: number;
  /** In-plane rotation, degrees, -180..180. NOT drone yaw. */
  rotation: number;
  orientation: SvgPlaneOrientation;
  /** Curve flattening tolerance in SVG user units. */
  flattenTolerance: number;
  /** Deterministic relaxation iterations (0-20). */
  relaxIterations: number;
  seed: number;
  /** Minimum points granted to each eligible contour in outline mode. */
  minPointsPerContour: number;
  /** Candidate oversampling factor for fill mode (>= 2). */
  fillDensity: number;
}

export const DEFAULT_SVG_PARAMS: Omit<SvgFormationParams, "targetCount"> = {
  mode: "outline",
  width: 80,
  height: 40,
  lockAspect: true,
  positionX: 0,
  altitude: 50,
  depth: 0,
  rotation: 0,
  orientation: "front",
  flattenTolerance: 0.4,
  relaxIterations: 6,
  seed: 20260813,
  minPointsPerContour: 2,
  fillDensity: 12,
};

/** Formation-level (STATIC design) quality report. Never a safety statement. */
export interface SVGFormationReport {
  valid: boolean;
  targetCount: number;
  generatedCount: number;
  duplicatePoints: number;
  /** Nearest-neighbour minimum spacing of the static formation, metres. */
  minSpacing: number;
  avgNearestNeighborSpacing: number;
  bounds: Bounds3;
  warnings: SvgWarning[];
}

/** Result of one exact-N generation pass. */
export interface SvgFormationResult {
  points: Vector3Tuple[];
  report: SVGFormationReport;
  /** Source contours mapped into show space — viewport guide only. */
  guideContours: Vector3Tuple[][];
  params: SvgFormationParams;
  algorithmVersion: string;
}

/** Imported source asset. Separate from any Formation generated from it. */
export interface SvgAsset {
  id: string;
  name: string;
  fileName: string;
  /** Normalized geometry — the canonical representation (never raw markup). */
  geometry: SvgGeometry;
}

/** Reproducibility metadata stored on a committed Formation. */
export interface SvgFormationSource {
  sourceType: "svg";
  assetId: string;
  sourceFileName: string;
  samplingMode: SvgSamplingMode;
  seed: number;
  sourceBounds: Bounds2;
  generationParameters: SvgFormationParams;
  svgAlgorithmVersion: string;
}
