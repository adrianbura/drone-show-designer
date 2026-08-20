/**
 * VERTICAL STACK RISK ANALYSIS — informational only.
 *
 * This module does NOT replace the canonical SafetyValidator and does NOT block
 * export. It answers one narrower diagnostic question: are two drones nearly in
 * the same world-vertical column (Y is altitude) even when their full 3D
 * separation is otherwise acceptable?
 *
 * The thresholds below are analysis defaults, not certified operational limits.
 * Callers may override them explicitly.
 */
import type { TrajectorySet } from "./trajectory/types";
import type { Vector3Tuple } from "./types";

export const VERTICAL_STACK_ANALYSIS_VERSION = "0.1.0";

export interface VerticalStackOptions {
  /** Horizontal XZ distance at or below which a pair is considered column-like. */
  readonly maxHorizontalDistance?: number;
  /** Minimum Y separation required so same-altitude neighbours are not misclassified. */
  readonly minVerticalDistance?: number;
}

export const VERTICAL_STACK_DEFAULTS = {
  maxHorizontalDistance: 0.8,
  minVerticalDistance: 0.5,
  status: "INFORMATIONAL_NOT_EXPORT_GATE",
} as const;

export interface VerticalStackPair {
  readonly indexA: number;
  readonly indexB: number;
  readonly horizontalDistance: number;
  readonly verticalDistance: number;
  readonly distance3d: number;
}

export interface VerticalStackStaticReport {
  readonly candidateCount: number;
  readonly candidates: readonly VerticalStackPair[];
  readonly worst: VerticalStackPair | null;
  readonly minHorizontalDistance: number | null;
  readonly options: Required<VerticalStackOptions>;
  readonly version: string;
}

export interface SceneGeometryExtent {
  readonly min: Vector3Tuple;
  readonly max: Vector3Tuple;
  readonly extentX: number;
  readonly extentY: number;
  readonly extentZ: number;
  /** Pearson correlation between altitude Y and depth Z; null if undefined. */
  readonly depthAltitudeCorrelation: number | null;
}

export interface VerticalStackTrajectoryReport {
  readonly affectedPairCount: number;
  readonly affectedPairs: readonly [number, number][];
  readonly framesChecked: number;
  readonly framesWithCandidates: number;
  readonly frameFractionWithCandidates: number;
  readonly firstRiskTime: number | null;
  readonly lastRiskTime: number | null;
  readonly worstTime: number | null;
  readonly worst: VerticalStackPair | null;
  readonly options: Required<VerticalStackOptions>;
  readonly limitation: "SAMPLED_TIMES_ONLY";
  readonly version: string;
}

function resolveOptions(options: VerticalStackOptions = {}): Required<VerticalStackOptions> {
  const maxHorizontalDistance = options.maxHorizontalDistance ?? VERTICAL_STACK_DEFAULTS.maxHorizontalDistance;
  const minVerticalDistance = options.minVerticalDistance ?? VERTICAL_STACK_DEFAULTS.minVerticalDistance;
  if (!Number.isFinite(maxHorizontalDistance) || maxHorizontalDistance < 0) {
    throw new Error("maxHorizontalDistance must be a finite non-negative number");
  }
  if (!Number.isFinite(minVerticalDistance) || minVerticalDistance < 0) {
    throw new Error("minVerticalDistance must be a finite non-negative number");
  }
  return { maxHorizontalDistance, minVerticalDistance };
}

function pairMetric(a: Vector3Tuple, b: Vector3Tuple, indexA: number, indexB: number): VerticalStackPair {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return {
    indexA,
    indexB,
    horizontalDistance: Math.hypot(dx, dz),
    verticalDistance: Math.abs(dy),
    distance3d: Math.hypot(dx, dy, dz),
  };
}

function candidateOrder(a: VerticalStackPair, b: VerticalStackPair): number {
  return (
    a.horizontalDistance - b.horizontalDistance ||
    b.verticalDistance - a.verticalDistance ||
    a.indexA - b.indexA ||
    a.indexB - b.indexB
  );
}

export function analyzeVerticalStackRisk(
  positions: readonly Vector3Tuple[],
  options: VerticalStackOptions = {},
): VerticalStackStaticReport {
  const resolved = resolveOptions(options);
  const candidates: VerticalStackPair[] = [];
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const metric = pairMetric(positions[i]!, positions[j]!, i, j);
      if (
        metric.horizontalDistance <= resolved.maxHorizontalDistance &&
        metric.verticalDistance >= resolved.minVerticalDistance
      ) {
        candidates.push(metric);
      }
    }
  }
  candidates.sort(candidateOrder);
  return {
    candidateCount: candidates.length,
    candidates,
    worst: candidates[0] ?? null,
    minHorizontalDistance: candidates[0]?.horizontalDistance ?? null,
    options: resolved,
    version: VERTICAL_STACK_ANALYSIS_VERSION,
  };
}

export function sceneGeometryExtent(points: readonly Vector3Tuple[]): SceneGeometryExtent {
  if (points.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      extentX: 0,
      extentY: 0,
      extentZ: 0,
      depthAltitudeCorrelation: null,
    };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let sumY = 0, sumZ = 0;
  for (const p of points) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
    sumY += p[1]; sumZ += p[2];
  }
  const meanY = sumY / points.length;
  const meanZ = sumZ / points.length;
  let covariance = 0, varianceY = 0, varianceZ = 0;
  for (const p of points) {
    const y = p[1] - meanY;
    const z = p[2] - meanZ;
    covariance += y * z;
    varianceY += y * y;
    varianceZ += z * z;
  }
  const denom = Math.sqrt(varianceY * varianceZ);
  const correlation = denom > 1e-12 ? covariance / denom : null;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    extentX: maxX - minX,
    extentY: maxY - minY,
    extentZ: maxZ - minZ,
    depthAltitudeCorrelation: correlation,
  };
}

export function analyzeVerticalStackTrajectory(
  set: TrajectorySet,
  options: VerticalStackOptions = {},
): VerticalStackTrajectoryReport {
  const resolved = resolveOptions(options);
  const frames = set.drones[0]?.samples.length ?? 0;
  let framesWithCandidates = 0;
  let firstRiskTime: number | null = null;
  let lastRiskTime: number | null = null;
  let worstTime: number | null = null;
  let worst: VerticalStackPair | null = null;
  const affected = new Set<string>();

  for (let k = 0; k < frames; k += 1) {
    const positions = set.drones.map((d) => d.samples[k]?.position ?? ([0, 0, 0] as Vector3Tuple));
    const report = analyzeVerticalStackRisk(positions, resolved);
    if (report.candidateCount === 0) continue;
    const t = set.drones[0]?.samples[k]?.t ?? k / set.sampleRate;
    framesWithCandidates += 1;
    if (firstRiskTime === null) firstRiskTime = t;
    lastRiskTime = t;
    for (const candidate of report.candidates) {
      affected.add(`${candidate.indexA}:${candidate.indexB}`);
      if (!worst || candidateOrder(candidate, worst) < 0) {
        worst = candidate;
        worstTime = t;
      }
    }
  }

  const affectedPairs = [...affected]
    .map((key) => key.split(":").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  return {
    affectedPairCount: affectedPairs.length,
    affectedPairs,
    framesChecked: frames,
    framesWithCandidates,
    frameFractionWithCandidates: frames > 0 ? framesWithCandidates / frames : 0,
    firstRiskTime,
    lastRiskTime,
    worstTime,
    worst,
    options: resolved,
    limitation: "SAMPLED_TIMES_ONLY",
    version: VERTICAL_STACK_ANALYSIS_VERSION,
  };
}
