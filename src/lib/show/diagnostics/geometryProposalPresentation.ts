/**
 * GEOMETRY PROPOSAL — PRESENTATION MODEL (PURE, READ-ONLY).
 *
 * Maps the canonical optimizer + comparison output into review-ready rows and a
 * normalized 2D before/after preview from the audience viewpoint. This module
 * invents no staggering logic, never mutates input and is never consulted by
 * planning, safety or export. Wording here is deliberately diagnostic: a lower
 * vertical-stack candidate count is NOT a safety certification.
 */
import type { Vector3Tuple } from "../types";
import { analyzeAudienceProjection, type AudienceView } from "./audienceProjection";
import type {
  GeometryProposalCandidate,
  GeometryProposalOptimizationResult,
} from "./geometryProposalOptimizer";
import type { GeometryProposalComparison } from "./geometryProposalComparison";

export const GEOMETRY_PROPOSAL_WORDING = {
  header: "DESIGN PREVIEW ONLY",
  stackClaim: "Vertical-stack diagnostic candidates reduced",
  silhouette: "Silhouette preserved for this representative viewpoint",
  capLabel: "DESIGN LIMIT — NOT A FLIGHT SAFETY LIMIT",
  applyDisabled: "Apply requires trajectory + safety validation integration",
} as const;

export type ProposalPreviewMode = "BEFORE" | "AFTER" | "OVERLAY";

export interface ProposalPreviewPoint {
  readonly index: number;
  readonly before: readonly [number, number];
  readonly after: readonly [number, number];
  /** Audience-plane drift between before/after image positions, metres. */
  readonly driftMeters: number;
}

export interface ProposalPreviewModel {
  /** Shared box across BEFORE/AFTER so drift shows as movement, not rescaling. */
  readonly box: { readonly minX: number; readonly minY: number; readonly width: number; readonly height: number };
  readonly points: readonly ProposalPreviewPoint[];
  readonly maxDriftMeters: number;
  readonly rmsDriftMeters: number;
  /** True when drift is large enough to be worth flagging visually. */
  readonly driftIsNonTrivial: boolean;
}

/** Drift below this is numerical noise for a metre-scale show. */
export const PROPOSAL_DRIFT_NOTABLE_METERS = 0.05;

/**
 * Builds the shared-box audience-plane preview of original vs proposed points.
 * Points that cannot be projected (at/behind the viewer) are omitted in pairs.
 */
export function buildGeometryProposalPreview(
  originalPoints: readonly Vector3Tuple[],
  proposedPoints: readonly Vector3Tuple[],
  view: AudienceView,
): ProposalPreviewModel {
  const before = analyzeAudienceProjection(originalPoints, view);
  const after = analyzeAudienceProjection(proposedPoints, view);
  const afterByIndex = new Map(after.points.map((p) => [p.index, p]));

  const points: ProposalPreviewPoint[] = [];
  let maxDrift = 0;
  let sum2 = 0;
  for (const b of before.points) {
    const a = afterByIndex.get(b.index);
    if (!a) continue;
    const drift = Math.hypot(a.perspective[0] - b.perspective[0], a.perspective[1] - b.perspective[1]);
    maxDrift = Math.max(maxDrift, drift);
    sum2 += drift * drift;
    points.push({ index: b.index, before: b.perspective, after: a.perspective, driftMeters: drift });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    for (const c of [p.before, p.after]) {
      minX = Math.min(minX, c[0]);
      maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]);
      maxY = Math.max(maxY, c[1]);
    }
  }
  if (!points.length) {
    minX = 0;
    maxX = 1;
    minY = 0;
    maxY = 1;
  }
  const pad = Math.max((maxX - minX) * 0.06, (maxY - minY) * 0.06, 1);

  return {
    box: {
      minX: minX - pad,
      minY: minY - pad,
      width: Math.max(maxX - minX + pad * 2, 1e-6),
      height: Math.max(maxY - minY + pad * 2, 1e-6),
    },
    points,
    maxDriftMeters: maxDrift,
    rmsDriftMeters: points.length ? Math.sqrt(sum2 / points.length) : 0,
    driftIsNonTrivial: maxDrift > PROPOSAL_DRIFT_NOTABLE_METERS,
  };
}

export interface ProposalSummaryRow {
  readonly label: string;
  readonly value: string;
  /** Diagnostic emphasis only — never a safety verdict. */
  readonly emphasis?: "good" | "warn" | undefined;
}

const m = (v: number) => `${v.toFixed(2)} m`;

/** Flattens optimizer + comparison evidence into ordered review rows. */
export function buildGeometryProposalSummary(
  result: GeometryProposalOptimizationResult,
  comparison: GeometryProposalComparison | null,
): readonly ProposalSummaryRow[] {
  const best = result.best;
  const rows: ProposalSummaryRow[] = [
    {
      label: "proposal available",
      value: best ? "yes" : "no",
      emphasis: best ? "good" : undefined,
    },
    { label: "chosen amplitude", value: best ? m(best.amplitudeMeters) : "—" },
    { label: "candidate pairs before", value: String(result.before.candidatePairCount) },
    { label: "candidate pairs after", value: best ? String(best.after.candidatePairCount) : "—" },
    {
      label: "pair reduction",
      value: best ? String(best.candidatePairReduction) : "—",
      emphasis: best && best.candidatePairReduction > 0 ? "good" : undefined,
    },
  ];

  if (comparison) {
    rows.push(
      { label: "min horizontal before", value: m(comparison.minHorizontalBefore) },
      {
        label: "min horizontal after",
        value: m(comparison.minHorizontalAfter),
        emphasis: comparison.minHorizontalGainMeters > 1e-9 ? "good" : undefined,
      },
      { label: "max 3D displacement", value: m(comparison.maxDisplacementMeters) },
      { label: "RMS 3D displacement", value: m(comparison.rmsDisplacementMeters) },
      {
        label: "max projection drift",
        value: m(comparison.maxAudienceImageDriftMeters),
        emphasis:
          comparison.maxAudienceImageDriftMeters > PROPOSAL_DRIFT_NOTABLE_METERS ? "warn" : "good",
      },
      { label: "RMS projection drift", value: m(comparison.rmsAudienceImageDriftMeters) },
      { label: "depth extent before", value: m(comparison.originalDepthExtentMeters) },
      { label: "depth extent after", value: m(comparison.proposedDepthExtentMeters) },
    );
  }

  rows.push({
    label: "displacement cap accepted",
    value: best ? (best.acceptedByDisplacementCap ? "yes" : "no") : "—",
    emphasis: best && !best.acceptedByDisplacementCap ? "warn" : undefined,
  });
  return rows;
}

export interface CandidateExplanation {
  readonly amplitudeMeters: number;
  readonly candidatePairsAfter: number;
  readonly minHorizontalAfter: number;
  readonly maxDisplacementMeters: number;
  readonly withinCap: boolean;
  readonly selected: boolean;
  /** Plain-language reason, never an opaque score tuple. */
  readonly reason: string;
}

function finiteOrZero(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/**
 * Explains the optimizer ranking in words: fewest stack candidates first, then
 * larger horizontal separation, then smaller displacement, then smaller amplitude.
 */
export function explainProposalCandidates(
  result: GeometryProposalOptimizationResult,
): readonly CandidateExplanation[] {
  const best = result.best;
  return result.candidates.map((c: GeometryProposalCandidate) => {
    const selected = !!best && best.amplitudeMeters === c.amplitudeMeters;
    let reason: string;
    if (!c.acceptedByDisplacementCap) {
      reason = "rejected: exceeds the design-proposal displacement cap";
    } else if (!best) {
      reason = "no eligible candidate improved the diagnostic";
    } else if (selected) {
      reason = "selected: fewest stack candidates, then widest horizontal spacing, then smallest move";
    } else if (c.after.candidatePairCount > best.after.candidatePairCount) {
      reason = "more stack candidates remain than the selected amplitude";
    } else if (
      finiteOrZero(c.after.minHorizontalAmongVerticallySeparated) <
      finiteOrZero(best.after.minHorizontalAmongVerticallySeparated)
    ) {
      reason = "tied stack candidates, but tighter horizontal spacing";
    } else if (c.proposal.maxDisplacement > best.proposal.maxDisplacement) {
      reason = "tied outcome, but a larger 3D move";
    } else {
      reason = "tied outcome, but a larger amplitude";
    }
    return {
      amplitudeMeters: c.amplitudeMeters,
      candidatePairsAfter: c.after.candidatePairCount,
      minHorizontalAfter: finiteOrZero(c.after.minHorizontalAmongVerticallySeparated),
      maxDisplacementMeters: c.proposal.maxDisplacement,
      withinCap: c.acceptedByDisplacementCap,
      selected,
      reason,
    };
  });
}

/** Proposed world positions for a candidate — preview geometry only. */
export function proposedPointsOf(candidate: GeometryProposalCandidate): Vector3Tuple[] {
  return candidate.proposal.moves.map((mv) => [...mv.proposed] as Vector3Tuple);
}
