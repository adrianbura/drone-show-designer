/**
 * SVG -> exact-N Formation.
 *
 * This is the only place the SVG package touches the Formation model. It emits
 * a plain {@link Formation} (kind "svg") plus reproducibility metadata, so every
 * downstream layer — AssignmentEngine, TrajectoryPlanner, Sampler,
 * SafetyValidator, exporters — treats it exactly like any built-in formation.
 */
import type { Formation, ShowProject, Vector3Tuple } from "../types";
import { planeToWorld, toPlane } from "./normalize";
import { samplePlanePoints } from "./sampling";
import { buildFormationReport, checkPlacement } from "./validation";
import {
  DEFAULT_SVG_PARAMS,
  SVG_ALGORITHM_VERSION,
  SvgError,
  type SvgAsset,
  type SvgFormationParams,
  type SvgFormationResult,
  type SvgFormationSource,
  type SvgGeometry,
} from "./types";

/** Fills in defaults; `targetCount` is always explicit. */
export function resolveSvgParams(
  targetCount: number,
  patch: Partial<SvgFormationParams> = {},
): SvgFormationParams {
  return { ...DEFAULT_SVG_PARAMS, targetCount, ...patch };
}

/**
 * Generates exactly `params.targetCount` world points. Throws {@link SvgError}
 * instead of ever returning the wrong number of points.
 */
export function generateSvgFormationPoints(
  geometry: SvgGeometry,
  params: SvgFormationParams,
): SvgFormationResult {
  const { points: planePoints, warnings, transform } = samplePlanePoints(geometry, params);
  const world: Vector3Tuple[] = planePoints.map((p) => planeToWorld(p, params));
  if (world.length !== params.targetCount) {
    throw new SvgError(
      "SAMPLING_FAILED",
      `Generated ${world.length} points for a target of ${params.targetCount}.`,
    );
  }

  const guideContours = geometry.contours.map((c) => {
    const pts = c.points.map((p) => planeToWorld(toPlane(p, transform), params));
    return c.closed && pts.length > 2 ? [...pts, pts[0]!] : pts;
  });

  const report = buildFormationReport(
    world,
    params,
    [...geometry.warnings, ...warnings],
    geometry.contours.length,
  );

  return { points: world, report, guideContours, params, algorithmVersion: SVG_ALGORITHM_VERSION };
}

/** Adds show-area / altitude placement warnings to an existing result. */
export function withPlacementWarnings(
  result: SvgFormationResult,
  project: ShowProject,
): SvgFormationResult {
  const extra = checkPlacement(result.report, project);
  if (extra.length === 0) return result;
  return {
    ...result,
    report: { ...result.report, warnings: [...result.report.warnings, ...extra] },
  };
}

/** "company-logo.svg" -> "Company Logo" */
export function formationNameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.svg$/i, "").replace(/[_-]+/g, " ").trim();
  if (!base) return "SVG Formation";
  return base
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function defaultFormationName(asset: SvgAsset, mode: SvgFormationParams["mode"]): string {
  const label = mode === "fill" ? "Fill" : "Outline";
  return `${formationNameFromFileName(asset.fileName)} — ${label}`;
}

export function svgFormationSource(
  asset: SvgAsset,
  params: SvgFormationParams,
): SvgFormationSource {
  return {
    sourceType: "svg",
    assetId: asset.id,
    sourceFileName: asset.fileName,
    samplingMode: params.mode,
    seed: params.seed,
    sourceBounds: asset.geometry.bounds,
    generationParameters: params,
    svgAlgorithmVersion: SVG_ALGORITHM_VERSION,
  };
}

/** Builds a committed Formation from an asset + generation result. */
export function makeSvgFormation(
  id: string,
  name: string,
  asset: SvgAsset,
  result: SvgFormationResult,
): Formation {
  const p = result.params;
  return {
    id,
    name,
    kind: "svg",
    points: result.points,
    params: {
      seed: p.seed,
      mode: p.mode,
      width: p.width,
      height: p.height,
      lockAspect: p.lockAspect ? 1 : 0,
      positionX: p.positionX,
      altitude: p.altitude,
      depth: p.depth,
      rotation: p.rotation,
      orientation: p.orientation,
      flattenTolerance: p.flattenTolerance,
      relaxIterations: p.relaxIterations,
      minPointsPerContour: p.minPointsPerContour,
      fillDensity: p.fillDensity,
      sourceFile: asset.fileName,
    },
    svg: svgFormationSource(asset, p),
  };
}

/**
 * Regenerates an SVG formation for a new drone count (or tweaked params) using
 * the stored asset geometry — this is what keeps fleet-size changes exact.
 */
export function regenerateSvgFormation(
  formation: Formation,
  asset: SvgAsset,
  targetCount: number,
  patch: Partial<SvgFormationParams> = {},
): Formation {
  const base = formation.svg?.generationParameters ?? resolveSvgParams(targetCount);
  const params = { ...base, ...patch, targetCount };
  const result = generateSvgFormationPoints(asset.geometry, params);
  return {
    ...formation,
    points: result.points,
    params: { ...formation.params, ...paramsToRecord(params) },
    svg: svgFormationSource(asset, params),
  };
}

function paramsToRecord(p: SvgFormationParams): Record<string, number | string> {
  return {
    seed: p.seed,
    mode: p.mode,
    width: p.width,
    height: p.height,
    lockAspect: p.lockAspect ? 1 : 0,
    positionX: p.positionX,
    altitude: p.altitude,
    depth: p.depth,
    rotation: p.rotation,
    orientation: p.orientation,
    flattenTolerance: p.flattenTolerance,
    relaxIterations: p.relaxIterations,
    minPointsPerContour: p.minPointsPerContour,
    fillDensity: p.fillDensity,
  };
}
