/**
 * READ-ONLY comparison model for a geometry proposal.
 *
 * This module does not apply geometry and is never used by planning, safety or
 * export. It only packages before/after evidence for review UI.
 */
import type { Vector3Tuple } from "../types";
import { analyzeAudienceProjection, type AudienceView } from "./audienceProjection";
import type { GeometryProposalCandidate } from "./geometryProposalOptimizer";

export interface GeometryProposalComparison {
  readonly pointCount: number;
  readonly candidatePairsBefore: number;
  readonly candidatePairsAfter: number;
  readonly candidatePairReduction: number;
  readonly minHorizontalBefore: number;
  readonly minHorizontalAfter: number;
  readonly minHorizontalGainMeters: number;
  readonly maxDisplacementMeters: number;
  readonly rmsDisplacementMeters: number;
  readonly maxAudienceImageDriftMeters: number;
  readonly rmsAudienceImageDriftMeters: number;
  readonly originalDepthExtentMeters: number;
  readonly proposedDepthExtentMeters: number;
  readonly note: string;
}

function finiteOrZero(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** Builds a deterministic Before/After evidence summary for one proposal candidate. */
export function compareGeometryProposal(
  originalPoints: readonly Vector3Tuple[],
  view: AudienceView,
  candidate: GeometryProposalCandidate,
): GeometryProposalComparison {
  if (candidate.proposal.moves.length !== originalPoints.length) {
    throw new Error(
      `proposal/original point count mismatch (${candidate.proposal.moves.length} vs ${originalPoints.length})`,
    );
  }

  const proposedPoints = candidate.proposal.moves.map((m) => m.proposed as Vector3Tuple);
  const beforeProjection = analyzeAudienceProjection(originalPoints, view);
  const afterProjection = analyzeAudienceProjection(proposedPoints, view);
  if (beforeProjection.points.length !== afterProjection.points.length) {
    throw new Error("proposal changed the number of audience-projectable points");
  }

  let maxDrift = 0;
  let drift2 = 0;
  for (let i = 0; i < beforeProjection.points.length; i += 1) {
    const a = beforeProjection.points[i]!.perspective;
    const b = afterProjection.points[i]!.perspective;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    maxDrift = Math.max(maxDrift, d);
    drift2 += d * d;
  }
  const n = beforeProjection.points.length;

  return {
    pointCount: originalPoints.length,
    candidatePairsBefore: candidate.before.candidatePairCount,
    candidatePairsAfter: candidate.after.candidatePairCount,
    candidatePairReduction: candidate.candidatePairReduction,
    minHorizontalBefore: finiteOrZero(candidate.before.minHorizontalAmongVerticallySeparated),
    minHorizontalAfter: finiteOrZero(candidate.after.minHorizontalAmongVerticallySeparated),
    minHorizontalGainMeters: candidate.minHorizontalGainMeters,
    maxDisplacementMeters: candidate.proposal.maxDisplacement,
    rmsDisplacementMeters: candidate.proposal.rmsDisplacement,
    maxAudienceImageDriftMeters: maxDrift,
    rmsAudienceImageDriftMeters: n ? Math.sqrt(drift2 / n) : 0,
    originalDepthExtentMeters: beforeProjection.depthExtent,
    proposedDepthExtentMeters: afterProjection.depthExtent,
    note:
      "REVIEW EVIDENCE ONLY. A lower vertical-stack diagnostic count and preserved audience image do not imply a safe or flyable show; applied geometry must be replanned and pass canonical validation.",
  };
}
