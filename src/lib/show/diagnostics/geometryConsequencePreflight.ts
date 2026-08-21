/**
 * GEOMETRY PROPOSAL CONSEQUENCE PREFLIGHT — PURE / READ-ONLY.
 *
 * Evaluates STATIC geometric consequences of a proposed point cloud against the
 * project's spatial envelope and configured minimum separation. It deliberately
 * does NOT evaluate transitions, velocity, acceleration, jerk, continuity or
 * any full-show trajectory property. Those remain the canonical planner +
 * SafetyValidator's responsibility after a proposal is actually applied.
 */
import type { SafetyLimits, ShowArea, Vector3Tuple } from "../types";

export interface GeometryConsequencePreflightInput {
  readonly before: readonly Vector3Tuple[];
  readonly after: readonly Vector3Tuple[];
  readonly area: ShowArea;
  readonly limits: SafetyLimits;
}

export interface GeometryConsequenceSnapshot {
  readonly pointCount: number;
  readonly minPairSeparation3D: number;
  readonly minAltitude: number;
  readonly maxAltitude: number;
  readonly maxAbsX: number;
  readonly maxAbsZ: number;
  readonly outsideAreaCount: number;
  readonly belowGroundCount: number;
  readonly aboveAltitudeCeilingCount: number;
  readonly pairSeparationViolationCount: number;
}

export interface GeometryConsequencePreflightReport {
  readonly before: GeometryConsequenceSnapshot;
  readonly after: GeometryConsequenceSnapshot;
  readonly pointCountMatches: boolean;
  readonly introducesAreaViolation: boolean;
  readonly introducesAltitudeViolation: boolean;
  readonly introducesPairSeparationViolation: boolean;
  readonly staticEnvelopePass: boolean;
  readonly note: string;
}

function finitePoint(p: Vector3Tuple): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
}

function snapshot(
  points: readonly Vector3Tuple[],
  area: ShowArea,
  limits: SafetyLimits,
): GeometryConsequenceSnapshot {
  let minPairSeparation3D = Infinity;
  let minAltitude = Infinity;
  let maxAltitude = -Infinity;
  let maxAbsX = 0;
  let maxAbsZ = 0;
  let outsideAreaCount = 0;
  let belowGroundCount = 0;
  let aboveAltitudeCeilingCount = 0;
  let pairSeparationViolationCount = 0;

  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    if (!finitePoint(p)) {
      outsideAreaCount += 1;
      belowGroundCount += 1;
      continue;
    }
    minAltitude = Math.min(minAltitude, p[1]);
    maxAltitude = Math.max(maxAltitude, p[1]);
    maxAbsX = Math.max(maxAbsX, Math.abs(p[0]));
    maxAbsZ = Math.max(maxAbsZ, Math.abs(p[2]));
    if (Math.abs(p[0]) > area.width / 2 || Math.abs(p[2]) > area.depth / 2) outsideAreaCount += 1;
    if (p[1] < 0) belowGroundCount += 1;
    if (p[1] > Math.min(area.height, limits.maxAltitude)) aboveAltitudeCeilingCount += 1;

    for (let j = i + 1; j < points.length; j += 1) {
      const q = points[j]!;
      if (!finitePoint(q)) continue;
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      minPairSeparation3D = Math.min(minPairSeparation3D, d);
      if (d < limits.minSeparation) pairSeparationViolationCount += 1;
    }
  }

  return {
    pointCount: points.length,
    minPairSeparation3D,
    minAltitude: points.length ? minAltitude : Infinity,
    maxAltitude: points.length ? maxAltitude : -Infinity,
    maxAbsX,
    maxAbsZ,
    outsideAreaCount,
    belowGroundCount,
    aboveAltitudeCeilingCount,
    pairSeparationViolationCount,
  };
}

export function analyzeGeometryProposalConsequences(
  input: GeometryConsequencePreflightInput,
): GeometryConsequencePreflightReport {
  const before = snapshot(input.before, input.area, input.limits);
  const after = snapshot(input.after, input.area, input.limits);
  const pointCountMatches = input.before.length === input.after.length;
  const introducesAreaViolation = after.outsideAreaCount > before.outsideAreaCount;
  const introducesAltitudeViolation =
    after.belowGroundCount > before.belowGroundCount ||
    after.aboveAltitudeCeilingCount > before.aboveAltitudeCeilingCount;
  const introducesPairSeparationViolation =
    after.pairSeparationViolationCount > before.pairSeparationViolationCount;
  const staticEnvelopePass =
    pointCountMatches &&
    !introducesAreaViolation &&
    !introducesAltitudeViolation &&
    !introducesPairSeparationViolation;

  return {
    before,
    after,
    pointCountMatches,
    introducesAreaViolation,
    introducesAltitudeViolation,
    introducesPairSeparationViolation,
    staticEnvelopePass,
    note:
      "STATIC PREFLIGHT ONLY. Passing means the proposal introduces no new static show-area, altitude or point-cloud separation violation. It does not evaluate trajectories, dynamics, continuous separation, splice continuity or export readiness.",
  };
}
