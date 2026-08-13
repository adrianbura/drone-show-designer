/**
 * SVG formation validation — STATIC design metrics only.
 *
 * IMPORTANT: nothing here says anything about flight safety. A valid formation
 * only means "the point set is well formed". Dynamic separation, velocity,
 * acceleration, jerk and yaw-rate limits remain the exclusive responsibility of
 * the SafetyValidator (src/lib/show/safety.ts) after trajectory sampling.
 */
import type { ShowProject, Vector3Tuple } from "../types";
import { spacingStats } from "./distribute";
import {
  DUPLICATE_EPSILON_M,
  type Bounds3,
  type SVGFormationReport,
  type SvgFormationParams,
  type SvgWarning,
} from "./types";

export function bounds3(points: readonly Vector3Tuple[]): Bounds3 {
  if (points.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      if (p[k]! < min[k]!) min[k] = p[k]!;
      if (p[k]! > max[k]!) max[k] = p[k]!;
    }
  }
  return { min, max };
}

/** Builds the static formation report and appends quality warnings. */
export function buildFormationReport(
  points: readonly Vector3Tuple[],
  params: SvgFormationParams,
  inputWarnings: readonly SvgWarning[],
  contourCount: number,
): SVGFormationReport {
  const warnings: SvgWarning[] = [...inputWarnings];
  const stats = spacingStats(points as readonly number[][]);

  if (stats.duplicates > 0) {
    warnings.push({
      code: "DUPLICATE_POINTS",
      message: `${stats.duplicates} generated point pair(s) are closer than ${DUPLICATE_EPSILON_M} m.`,
      details: "Increase the formation width or lower the drone count.",
    });
  }
  if (contourCount > 0 && params.targetCount < contourCount * 3) {
    warnings.push({
      code: "LOW_DRONE_COUNT_FOR_COMPLEX_LOGO",
      message: "Low drone count may significantly reduce logo recognizability.",
      details: `${contourCount} contours for ${params.targetCount} drones.`,
    });
  }

  return {
    valid: points.length === params.targetCount && stats.duplicates === 0,
    targetCount: params.targetCount,
    generatedCount: points.length,
    duplicatePoints: stats.duplicates,
    minSpacing: stats.min,
    avgNearestNeighborSpacing: stats.average,
    bounds: bounds3(points),
    warnings,
  };
}

/**
 * Show-area and altitude checks. These NEVER clamp or distort the logo — they
 * only report, so the user can resize or reposition it.
 */
export function checkPlacement(report: SVGFormationReport, project: ShowProject): SvgWarning[] {
  const warnings: SvgWarning[] = [];
  const { min, max } = report.bounds;
  const halfW = project.area.width / 2;
  const halfD = project.area.depth / 2;
  const overX = Math.max(0, max[0] - halfW, -halfW - min[0]);
  const overZ = Math.max(0, max[2] - halfD, -halfD - min[2]);
  if (overX > 0.01 || overZ > 0.01) {
    const parts: string[] = [];
    if (overX > 0.01) parts.push(`width by ${overX.toFixed(1)} m`);
    if (overZ > 0.01) parts.push(`depth by ${overZ.toFixed(1)} m`);
    warnings.push({
      code: "SHOW_AREA_EXCEEDED",
      message: `Formation exceeds show area ${parts.join(" and ")}.`,
    });
  }
  const ceiling = Math.min(project.area.height, project.limits.maxAltitude);
  if (max[1] > ceiling + 0.01) {
    warnings.push({
      code: "ALTITUDE_LIMIT_EXCEEDED",
      message: `Formation exceeds the altitude limit by ${(max[1] - ceiling).toFixed(1)} m.`,
    });
  }
  if (min[1] < project.limits.minAltitude - 0.01) {
    warnings.push({
      code: "ALTITUDE_LIMIT_EXCEEDED",
      message: `Formation dips ${(project.limits.minAltitude - min[1]).toFixed(1)} m below the minimum flight altitude.`,
    });
  }
  return warnings;
}
