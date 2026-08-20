/**
 * VERTICAL STACK RISK ANALYSIS — DIAGNOSTIC / READ-ONLY.
 *
 * WHAT THIS IS
 *   A deterministic geometric metric that finds drone pairs which are nearly
 *   vertically stacked (small horizontal XZ offset, meaningful altitude
 *   difference) even when the canonical 3D min-separation check passes.
 *
 * WHAT THIS IS NOT
 *   - Not a safety limit, not vendor-certified safety logic, not a regulation.
 *   - Not an export gate: nothing here influences eligibility or validation.
 *   - Not a replacement for continuous 3D conflict detection.
 *   - It never moves, tilts, staggers, reassigns or otherwise mutates input.
 *
 * CONVENTIONS
 *   Show-local metres, +Y up (see ../coordinates.ts). "Vertical" always means
 *   WORLD Y — intentional: the operator concern is one aircraft flying directly
 *   above another. The metric is therefore translation invariant but NOT
 *   invariant under rotations that tilt the world vertical axis.
 */
import type { Vector3Tuple } from "../types";
import type { TrajectorySet } from "../trajectory/types";

/**
 * ANALYSIS DEFAULTS — descriptive starting points for inspection only.
 * They are NOT certified limits and are not derived from any vendor spec.
 */
export const VERTICAL_STACK_ANALYSIS_DEFAULTS = {
  /** Pairs closer than this horizontally are "overlapping" in plan view. */
  horizontalThresholdMeters: 2,
  /** Below this altitude difference a pair is "same layer", not a stack. */
  minVerticalDifferenceMeters: 1,
  /** Frames per second used when sampling a trajectory set. */
  analysisSampleRateHz: 2,
  /** Upper bound on reported candidate pairs (report stays bounded). */
  maxReportedPairs: 200,
} as const;

export interface VerticalStackOptions {
  horizontalThresholdMeters?: number;
  minVerticalDifferenceMeters?: number;
  maxReportedPairs?: number;
  /** Optional stable identity per index (drone id, object id, ...). */
  labels?: readonly string[];
}

export interface VerticalStackThresholds {
  readonly horizontalThresholdMeters: number;
  readonly minVerticalDifferenceMeters: number;
}

export interface VerticalStackPair {
  /** Lower index first — deterministic. */
  readonly indexA: number;
  readonly indexB: number;
  readonly labelA: string;
  readonly labelB: string;
  readonly horizontalDistanceXZ: number;
  readonly verticalDistance: number;
  readonly distance3D: number;
  /** Which of the two is above the other (world +Y). */
  readonly upperIndex: number;
}

export interface VerticalStackReport {
  readonly thresholds: VerticalStackThresholds;
  readonly pointCount: number;
  readonly candidatePairCount: number;
  /** Deterministically sorted; truncated to `maxReportedPairs`. */
  readonly candidates: readonly VerticalStackPair[];
  readonly truncated: boolean;
  /** Tightest horizontal overlap among candidates, null when none. */
  readonly worstPair: VerticalStackPair | null;
  /**
   * Minimum horizontal separation among pairs that ARE vertically separated
   * (verticalDistance >= minVerticalDifferenceMeters), regardless of the
   * horizontal threshold. Infinity when no such pair exists.
   */
  readonly minHorizontalAmongVerticallySeparated: number;
  readonly note: string;
}

const NOTE =
  "Informational geometry only. Not a safety limit and not an export gate; " +
  "canonical separation remains the SafetyValidator's call.";

function label(labels: readonly string[] | undefined, i: number): string {
  return labels?.[i] ?? `#${i}`;
}

/** Deterministic ordering: tightest horizontal first, then indices. */
function comparePairs(a: VerticalStackPair, b: VerticalStackPair): number {
  if (a.horizontalDistanceXZ !== b.horizontalDistanceXZ)
    return a.horizontalDistanceXZ - b.horizontalDistanceXZ;
  if (a.verticalDistance !== b.verticalDistance) return b.verticalDistance - a.verticalDistance;
  if (a.indexA !== b.indexA) return a.indexA - b.indexA;
  return a.indexB - b.indexB;
}

/**
 * Pure pairwise analysis of ONE static point set (formation, imported scene
 * frame, live playback frame). O(N^2); at 200-500 points this is microseconds.
 * The input array is never modified.
 */
export function analyzeVerticalStackRisk(
  points: readonly Vector3Tuple[],
  options: VerticalStackOptions = {},
): VerticalStackReport {
  const horizontalThresholdMeters =
    options.horizontalThresholdMeters ??
    VERTICAL_STACK_ANALYSIS_DEFAULTS.horizontalThresholdMeters;
  const minVerticalDifferenceMeters =
    options.minVerticalDifferenceMeters ??
    VERTICAL_STACK_ANALYSIS_DEFAULTS.minVerticalDifferenceMeters;
  const maxReportedPairs =
    options.maxReportedPairs ?? VERTICAL_STACK_ANALYSIS_DEFAULTS.maxReportedPairs;

  const candidates: VerticalStackPair[] = [];
  let minHorizontalAmongVerticallySeparated = Infinity;

  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    for (let j = i + 1; j < points.length; j++) {
      const b = points[j]!;
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const dz = a[2] - b[2];
      const horizontalDistanceXZ = Math.hypot(dx, dz);
      const verticalDistance = Math.abs(dy);
      if (verticalDistance < minVerticalDifferenceMeters) continue;
      if (horizontalDistanceXZ < minHorizontalAmongVerticallySeparated)
        minHorizontalAmongVerticallySeparated = horizontalDistanceXZ;
      if (horizontalDistanceXZ > horizontalThresholdMeters) continue;
      candidates.push({
        indexA: i,
        indexB: j,
        labelA: label(options.labels, i),
        labelB: label(options.labels, j),
        horizontalDistanceXZ,
        verticalDistance,
        distance3D: Math.hypot(dx, dy, dz),
        upperIndex: a[1] >= b[1] ? i : j,
      });
    }
  }

  candidates.sort(comparePairs);
  return {
    thresholds: { horizontalThresholdMeters, minVerticalDifferenceMeters },
    pointCount: points.length,
    candidatePairCount: candidates.length,
    candidates: candidates.slice(0, maxReportedPairs),
    truncated: candidates.length > maxReportedPairs,
    worstPair: candidates[0] ?? null,
    minHorizontalAmongVerticallySeparated,
    note: NOTE,
  };
}

// ---------------------------------------------------------------------------
// Point-cloud 3D geometry (depth / tilt evidence)
// ---------------------------------------------------------------------------

export interface PointCloudGeometryReport {
  readonly pointCount: number;
  readonly extentX: number;
  readonly extentY: number;
  readonly extentZ: number;
  readonly minY: number;
  readonly maxY: number;
  /** Standard deviation of Z — "depth spread". */
  readonly depthSpread: number;
  /**
   * Pearson correlation between depth (Z) and altitude (Y) in [-1, 1].
   * A large magnitude is EVIDENCE consistent with a tilted formation plane.
   * It does not prove authorial intent.
   */
  readonly depthHeightCorrelation: number;
  /**
   * Unit normal of the least-squares best-fit plane (PCA smallest axis), or
   * null when the cloud is degenerate (< 3 points).
   */
  readonly planeNormal: Vector3Tuple | null;
  /** Angle between the plane normal and world +Y, degrees (0 = flat/level). */
  readonly planeTiltDegrees: number | null;
  /** RMS distance of points to the best-fit plane, metres. */
  readonly planeResidualRms: number | null;
  readonly note: string;
}

/** Symmetric 3x3 eigen decomposition by Jacobi rotations (deterministic). */
function jacobiEigen(m: number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((r) => [...r]);
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) off += a[p]![q]! * a[p]![q]!;
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-18) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: [a[0]![0]!, a[1]![1]!, a[2]![2]!], vectors: v };
}

const GEOMETRY_NOTE =
  "Measured geometry of the points as authored/imported. Depth spread and " +
  "plane tilt are evidence only — no intent is asserted.";

/** Pure 3D geometry of a point cloud. Z/depth is never flattened. */
export function analyzePointCloudGeometry(
  points: readonly Vector3Tuple[],
): PointCloudGeometryReport {
  const n = points.length;
  if (n === 0) {
    return {
      pointCount: 0,
      extentX: 0,
      extentY: 0,
      extentZ: 0,
      minY: 0,
      maxY: 0,
      depthSpread: 0,
      depthHeightCorrelation: 0,
      planeNormal: null,
      planeTiltDegrees: null,
      planeResidualRms: null,
      note: GEOMETRY_NOTE,
    };
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity,
    sx = 0,
    sy = 0,
    sz = 0;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
    minZ = Math.min(minZ, p[2]);
    maxZ = Math.max(maxZ, p[2]);
    sx += p[0];
    sy += p[1];
    sz += p[2];
  }
  const cx = sx / n,
    cy = sy / n,
    cz = sz / n;

  let cxx = 0,
    cxy = 0,
    cxz = 0,
    cyy = 0,
    cyz = 0,
    czz = 0;
  for (const p of points) {
    const dx = p[0] - cx,
      dy = p[1] - cy,
      dz = p[2] - cz;
    cxx += dx * dx;
    cxy += dx * dy;
    cxz += dx * dz;
    cyy += dy * dy;
    cyz += dy * dz;
    czz += dz * dz;
  }
  const varY = cyy / n;
  const varZ = czz / n;
  const depthSpread = Math.sqrt(varZ);
  const depthHeightCorrelation =
    varY > 1e-12 && varZ > 1e-12 ? cyz / n / Math.sqrt(varY * varZ) : 0;

  let planeNormal: Vector3Tuple | null = null;
  let planeTiltDegrees: number | null = null;
  let planeResidualRms: number | null = null;
  if (n >= 3) {
    const { values, vectors } = jacobiEigen([
      [cxx / n, cxy / n, cxz / n],
      [cxy / n, cyy / n, cyz / n],
      [cxz / n, cyz / n, czz / n],
    ]);
    let k = 0;
    for (let i = 1; i < 3; i++) if (values[i]! < values[k]!) k = i;
    let nx = vectors[0]![k]!,
      ny = vectors[1]![k]!,
      nz = vectors[2]![k]!;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    // Deterministic sign: normal always points to the +Y half-space.
    if (ny < 0 || (ny === 0 && nx + nz < 0)) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    planeNormal = [nx, ny, nz];
    planeTiltDegrees = (Math.acos(Math.min(1, Math.abs(ny))) * 180) / Math.PI;
    let acc = 0;
    for (const p of points) {
      const d = (p[0] - cx) * nx + (p[1] - cy) * ny + (p[2] - cz) * nz;
      acc += d * d;
    }
    planeResidualRms = Math.sqrt(acc / n);
  }

  return {
    pointCount: n,
    extentX: maxX - minX,
    extentY: maxY - minY,
    extentZ: maxZ - minZ,
    minY,
    maxY,
    depthSpread,
    depthHeightCorrelation,
    planeNormal,
    planeTiltDegrees,
    planeResidualRms,
    note: GEOMETRY_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Trajectory (show-wide) analysis over sampled frames
// ---------------------------------------------------------------------------

export interface TrajectoryVerticalStackOptions extends VerticalStackOptions {
  /** Frames per second to inspect. Defaults to the analysis default. */
  analysisSampleRateHz?: number;
}

export interface TrajectoryVerticalStackReport {
  readonly thresholds: VerticalStackThresholds;
  readonly analysisSampleRateHz: number;
  readonly framesAnalyzed: number;
  readonly framesWithCandidates: number;
  readonly framePercentWithCandidates: number;
  readonly firstRiskTime: number | null;
  readonly lastRiskTime: number | null;
  readonly worstTime: number | null;
  readonly worstPair: VerticalStackPair | null;
  /** Distinct pairs seen at any analysed frame. */
  readonly affectedPairCount: number;
  readonly limitation: string;
  readonly note: string;
}

const SAMPLED_LIMITATION =
  "SAMPLED-TIME ANALYSIS: only the analysed frames are inspected, so an " +
  "occurrence entirely between two frames can be missed. This does not " +
  "replace continuous 3D conflict detection.";

/** Pure sampled-time analysis of a canonical trajectory set. Never mutates it. */
export function analyzeTrajectoryVerticalStackRisk(
  set: TrajectorySet,
  options: TrajectoryVerticalStackOptions = {},
): TrajectoryVerticalStackReport {
  const hz = Math.max(
    0.01,
    options.analysisSampleRateHz ?? VERTICAL_STACK_ANALYSIS_DEFAULTS.analysisSampleRateHz,
  );
  const labels = options.labels ?? set.drones.map((d) => d.droneId);
  const start = set.startTime ?? 0;
  const end = start + Math.max(0, set.duration);
  const step = 1 / hz;

  let framesAnalyzed = 0;
  let framesWithCandidates = 0;
  let firstRiskTime: number | null = null;
  let lastRiskTime: number | null = null;
  let worstTime: number | null = null;
  let worstPair: VerticalStackPair | null = null;
  const affected = new Set<string>();

  const times: number[] = [];
  for (let t = start; t <= end + 1e-9; t += step) times.push(t);
  if (times.length === 0) times.push(start);

  for (const t of times) {
    const points: Vector3Tuple[] = [];
    for (const d of set.drones) {
      const s = sampleAt(d.samples, t, set.sampleRate, start);
      if (s) points.push(s);
    }
    framesAnalyzed++;
    const report = analyzeVerticalStackRisk(points, { ...options, labels });
    if (report.candidatePairCount === 0) continue;
    framesWithCandidates++;
    if (firstRiskTime === null) firstRiskTime = t;
    lastRiskTime = t;
    for (const c of report.candidates) affected.add(`${c.indexA}-${c.indexB}`);
    const w = report.worstPair!;
    if (!worstPair || comparePairs(w, worstPair) < 0) {
      worstPair = w;
      worstTime = t;
    }
  }

  return {
    thresholds:
      analyzeVerticalStackRisk([], options).thresholds,
    analysisSampleRateHz: hz,
    framesAnalyzed,
    framesWithCandidates,
    framePercentWithCandidates:
      framesAnalyzed > 0 ? (framesWithCandidates / framesAnalyzed) * 100 : 0,
    firstRiskTime,
    lastRiskTime,
    worstTime,
    worstPair,
    affectedPairCount: affected.size,
    limitation: SAMPLED_LIMITATION,
    note: NOTE,
  };
}

/** Nearest-sample read of a drone track — read-only. */
function sampleAt(
  samples: readonly { readonly t: number; readonly position: Vector3Tuple }[],
  t: number,
  rate: number,
  start: number,
): Vector3Tuple | null {
  if (samples.length === 0) return null;
  const i = Math.round((t - start) * rate);
  const clamped = Math.min(samples.length - 1, Math.max(0, i));
  return samples[clamped]!.position;
}
