/**
 * EXACT-N point sampling in the logo plane (metres).
 *
 * Both modes are pure functions of (geometry, params) and MUST return exactly
 * `targetCount` points or throw a structured {@link SvgError}. Sampling happens
 * in plane space so tolerances, spacing and relaxation are all in metres.
 */
import { planeTransform, toPlane, type PlaneTransform } from "./normalize";
import {
  allocateLargestRemainder,
  farthestPointSelection,
  isInsideRegion,
  makeRng,
  relaxAlongContour,
  relaxInsideRegion,
  samplePolylineByArcLength,
} from "./distribute";
import { boundsOf, polylineLength } from "./flatten";
import {
  SvgError,
  type Contour,
  type FillRule,
  type Point2,
  type SvgFormationParams,
  type SvgGeometry,
  type SvgWarning,
} from "./types";

/** A contour mapped into plane space (metres, +Y up, rotation applied). */
export interface PlaneContour {
  id: string;
  closed: boolean;
  points: Point2[];
  length: number;
}

export function toPlaneContours(contours: readonly Contour[], t: PlaneTransform): PlaneContour[] {
  return contours
    .map((c) => {
      const points = c.points.map((p) => toPlane(p, t));
      return { id: c.id, closed: c.closed, points, length: polylineLength(points, c.closed) };
    })
    .filter((c) => c.points.length >= 2 && c.length > 1e-9);
}

export interface SamplingOutcome {
  /** Exactly params.targetCount points, plane space (metres). */
  points: Point2[];
  warnings: SvgWarning[];
}

/**
 * OUTLINE mode: proportional-to-length allocation solved with the
 * largest-remainder method, then equal-arc-length placement per contour.
 */
export function sampleOutline(
  geometry: SvgGeometry,
  params: SvgFormationParams,
  t: PlaneTransform,
): SamplingOutcome {
  const warnings: SvgWarning[] = [];
  const target = params.targetCount;
  const all = toPlaneContours(geometry.contours, t);
  if (all.length === 0) throw new SvgError("EMPTY_GEOMETRY", "The SVG contains no usable contours.");

  // Deterministic prioritisation: longest contours first, ties by id.
  const ordered = [...all].sort((a, b) => b.length - a.length || a.id.localeCompare(b.id));
  let eligible = ordered;
  if (ordered.length > target) {
    eligible = ordered.slice(0, target);
    warnings.push({
      code: "SMALL_CONTOUR_DROPPED",
      message: `${ordered.length - target} small contour(s) could not be represented with ${target} drones.`,
      details: "Contours are prioritised by length. Increase the fleet size to cover every detail.",
    });
  }

  const minPer = Math.max(0, Math.min(params.minPointsPerContour, Math.floor(target / eligible.length)));
  const counts = allocateLargestRemainder(
    eligible.map((c) => c.length),
    target,
    minPer,
  );

  const points: Point2[] = [];
  eligible.forEach((contour, i) => {
    const n = counts[i] ?? 0;
    if (n <= 0) return;
    const placed =
      params.relaxIterations > 0
        ? relaxAlongContour(contour.points, contour.closed, n, params.relaxIterations)
        : samplePolylineByArcLength(contour.points, contour.closed, n);
    for (const p of placed) points.push(p);
  });

  if (points.length !== target) {
    throw new SvgError(
      "SAMPLING_FAILED",
      `Outline sampling produced ${points.length} points instead of ${target}.`,
    );
  }
  return { points, warnings };
}

function dominantFillRule(contours: readonly Contour[]): FillRule {
  return contours.some((c) => c.fillRule === "evenodd") ? "evenodd" : "nonzero";
}

/**
 * FILL mode: deterministic jittered-stratified candidate generation inside the
 * filled region (holes excluded by the fill rule), then farthest-point
 * selection down to exactly `targetCount`, then constrained relaxation.
 */
export function sampleFill(
  geometry: SvgGeometry,
  params: SvgFormationParams,
  t: PlaneTransform,
): SamplingOutcome {
  const warnings: SvgWarning[] = [];
  const target = params.targetCount;
  const regions = geometry.closedRegions.filter((c) => c.closed);
  if (regions.length === 0) {
    throw new SvgError(
      "EMPTY_GEOMETRY",
      "Fill sampling needs closed filled shapes. This SVG only contains open strokes — use Outline mode.",
    );
  }
  const rule = dominantFillRule(regions);
  const polygons = toPlaneContours(regions, t).map((c) => c.points);
  const bounds = boundsOf(polygons.flat());
  if (bounds.width <= 1e-6 || bounds.height <= 1e-6) {
    throw new SvgError("EMPTY_GEOMETRY", "The filled region is degenerate.");
  }

  const density = Math.max(2, params.fillDensity);
  let candidates: Point2[] = [];
  let attempt = 0;
  let wanted = Math.ceil(target * density);
  while (attempt < 7) {
    const rng = makeRng(params.seed + attempt * 7919);
    const aspect = bounds.width / bounds.height;
    const cols = Math.max(2, Math.round(Math.sqrt(wanted * aspect)));
    const rows = Math.max(2, Math.ceil(wanted / cols));
    const cw = bounds.width / cols;
    const ch = bounds.height / rows;
    const found: Point2[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = bounds.minX + (c + 0.15 + rng() * 0.7) * cw;
        const y = bounds.minY + (r + 0.15 + rng() * 0.7) * ch;
        if (isInsideRegion(polygons, x, y, rule)) found.push([x, y]);
      }
    }
    candidates = found;
    if (found.length >= Math.max(target, target * 3)) break;
    wanted *= 4;
    attempt++;
  }

  if (candidates.length < target) {
    throw new SvgError(
      "SAMPLING_FAILED",
      `Only ${candidates.length} valid interior positions were found for ${target} drones.`,
      "The filled area is very thin. Increase the formation width or use Outline mode.",
    );
  }

  let picked = farthestPointSelection(candidates, target);
  if (picked.length !== target) {
    throw new SvgError(
      "SAMPLING_FAILED",
      `Fill sampling produced ${picked.length} points instead of ${target}.`,
    );
  }

  if (params.relaxIterations > 0) {
    const area = bounds.width * bounds.height * (candidates.length / Math.max(1, wanted));
    const spacing = Math.sqrt(Math.max(area, 1e-6) / target);
    picked = relaxInsideRegion(picked, polygons, rule, params.relaxIterations, spacing);
  }
  return { points: picked, warnings };
}

export function samplePlanePoints(
  geometry: SvgGeometry,
  params: SvgFormationParams,
): { points: Point2[]; warnings: SvgWarning[]; transform: PlaneTransform } {
  if (!Number.isInteger(params.targetCount) || params.targetCount < 1) {
    throw new SvgError("TARGET_COUNT_INVALID", "Target drone count must be a positive integer.");
  }
  const transform = planeTransform(geometry.bounds, params);
  const outcome =
    params.mode === "fill" ? sampleFill(geometry, params, transform) : sampleOutline(geometry, params, transform);
  return { ...outcome, transform };
}
