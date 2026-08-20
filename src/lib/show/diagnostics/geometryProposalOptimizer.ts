/**
 * READ-ONLY FLIGHT-GEOMETRY PROPOSAL OPTIMIZER.
 *
 * This module NEVER mutates formations, planner output, safety state or export.
 * It searches deterministic audience-ray depth offsets and scores the resulting
 * point cloud with the existing Vertical Stack diagnostic while preserving the
 * exact audience projection for the supplied representative viewpoint.
 *
 * The result is a DESIGN PROPOSAL only. Any proposal that is later applied must
 * still pass the normal planner + canonical SafetyValidator + export gates.
 */
import type { Vector3Tuple } from "../types";
import type { AudienceView } from "./audienceProjection";
import {
  proposeProjectionPreservingDepthDeltas,
  type ProjectionPreservingProposal,
} from "./projectionPreservingGeometry";
import {
  VERTICAL_STACK_ANALYSIS_DEFAULTS,
  analyzeVerticalStackRisk,
  type VerticalStackOptions,
  type VerticalStackReport,
} from "./verticalStack";

export const GEOMETRY_PROPOSAL_DEFAULTS = {
  /** Candidate audience-axis move magnitudes to evaluate, metres. */
  amplitudesMeters: [0.5, 1, 1.5, 2, 3] as readonly number[],
  /** Hard design-proposal displacement cap, not a certified flight limit. */
  maxDisplacementMeters: 4,
} as const;

export interface GeometryProposalOptimizerOptions extends VerticalStackOptions {
  readonly amplitudesMeters?: readonly number[];
  readonly maxDisplacementMeters?: number;
}

export interface GeometryProposalCandidate {
  readonly amplitudeMeters: number;
  readonly depthDeltas: readonly number[];
  readonly proposal: ProjectionPreservingProposal;
  readonly before: VerticalStackReport;
  readonly after: VerticalStackReport;
  readonly candidatePairReduction: number;
  readonly minHorizontalGainMeters: number;
  readonly acceptedByDisplacementCap: boolean;
  readonly score: readonly [number, number, number, number];
}

export interface GeometryProposalOptimizationResult {
  readonly before: VerticalStackReport;
  readonly best: GeometryProposalCandidate | null;
  readonly candidates: readonly GeometryProposalCandidate[];
  readonly improved: boolean;
  readonly note: string;
}

function movedPoints(proposal: ProjectionPreservingProposal): Vector3Tuple[] {
  return proposal.moves.map((m) => m.proposed as Vector3Tuple);
}

/**
 * Stable two-colour assignment of the vertical-stack candidate graph.
 *
 * A true graph colouring is not required here: this is only a deterministic
 * proposal seed. Each connected component is traversed in index order and gets
 * alternating signs. Odd cycles are resolved deterministically by keeping the
 * first assigned sign rather than introducing random state.
 */
function alternatingSigns(pointCount: number, report: VerticalStackReport): number[] {
  const adjacency = Array.from({ length: pointCount }, () => [] as number[]);
  for (const pair of report.candidates) {
    adjacency[pair.indexA]!.push(pair.indexB);
    adjacency[pair.indexB]!.push(pair.indexA);
  }
  adjacency.forEach((xs) => xs.sort((a, b) => a - b));

  const signs = Array<number>(pointCount).fill(0);
  for (let root = 0; root < pointCount; root += 1) {
    if (signs[root] !== 0 || adjacency[root]!.length === 0) continue;
    signs[root] = root % 2 === 0 ? -1 : 1;
    const queue = [root];
    while (queue.length) {
      const i = queue.shift()!;
      for (const j of adjacency[i]!) {
        if (signs[j] === 0) {
          signs[j] = -signs[i]!;
          queue.push(j);
        }
      }
    }
  }
  return signs;
}

function finiteNonNegative(values: readonly number[]): number[] {
  return [...new Set(values.filter((v) => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);
}

/** Lexicographic score: fewer stack candidates, larger min horizontal, smaller move, smaller amplitude. */
function candidateScore(after: VerticalStackReport, proposal: ProjectionPreservingProposal, amplitude: number): readonly [number, number, number, number] {
  const minHorizontal = Number.isFinite(after.minHorizontalAmongVerticallySeparated)
    ? after.minHorizontalAmongVerticallySeparated
    : Number.MAX_SAFE_INTEGER;
  return [after.candidatePairCount, -minHorizontal, proposal.maxDisplacement, amplitude] as const;
}

function compareScore(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/**
 * Produces deterministic projection-preserving depth-stagger proposals.
 *
 * Important: this function does NOT claim that reducing the diagnostic candidate
 * count makes a flight safe. It does not evaluate transitions, dynamics, show
 * area, altitude ceilings or continuous separation.
 */
export function optimizeProjectionPreservingStackProposal(
  points: readonly Vector3Tuple[],
  view: AudienceView,
  options: GeometryProposalOptimizerOptions = {},
): GeometryProposalOptimizationResult {
  const stackOptions: VerticalStackOptions = {
    horizontalThresholdMeters:
      options.horizontalThresholdMeters ?? VERTICAL_STACK_ANALYSIS_DEFAULTS.horizontalThresholdMeters,
    minVerticalDifferenceMeters:
      options.minVerticalDifferenceMeters ?? VERTICAL_STACK_ANALYSIS_DEFAULTS.minVerticalDifferenceMeters,
    maxReportedPairs: options.maxReportedPairs ?? Math.max(200, points.length * 4),
    labels: options.labels,
  };
  const before = analyzeVerticalStackRisk(points, stackOptions);
  if (before.candidatePairCount === 0) {
    return {
      before,
      best: null,
      candidates: [],
      improved: false,
      note: "No vertical-stack candidates at the supplied analysis thresholds; no proposal generated.",
    };
  }

  const signs = alternatingSigns(points.length, before);
  const amplitudes = finiteNonNegative(options.amplitudesMeters ?? GEOMETRY_PROPOSAL_DEFAULTS.amplitudesMeters);
  const maxDisplacement = options.maxDisplacementMeters ?? GEOMETRY_PROPOSAL_DEFAULTS.maxDisplacementMeters;
  const candidates: GeometryProposalCandidate[] = [];

  for (const amplitude of amplitudes) {
    const depthDeltas = signs.map((sign) => sign * amplitude);
    const proposal = proposeProjectionPreservingDepthDeltas(points, depthDeltas, view);
    const after = analyzeVerticalStackRisk(movedPoints(proposal), stackOptions);
    const beforeMin = before.minHorizontalAmongVerticallySeparated;
    const afterMin = after.minHorizontalAmongVerticallySeparated;
    const minHorizontalGainMeters =
      Number.isFinite(beforeMin) && Number.isFinite(afterMin) ? afterMin - beforeMin : 0;
    const acceptedByDisplacementCap = proposal.maxDisplacement <= maxDisplacement + 1e-9;
    candidates.push({
      amplitudeMeters: amplitude,
      depthDeltas,
      proposal,
      before,
      after,
      candidatePairReduction: before.candidatePairCount - after.candidatePairCount,
      minHorizontalGainMeters,
      acceptedByDisplacementCap,
      score: candidateScore(after, proposal, amplitude),
    });
  }

  const eligible = candidates.filter((c) => c.acceptedByDisplacementCap);
  eligible.sort((a, b) => compareScore(a.score, b.score));
  const best = eligible[0] ?? null;
  const improved = !!best && (
    best.after.candidatePairCount < before.candidatePairCount ||
    best.minHorizontalGainMeters > 1e-9
  );

  return {
    before,
    best,
    candidates,
    improved,
    note:
      "DESIGN PROPOSAL ONLY. Audience projection is preserved for the supplied viewpoint. Any applied geometry must still pass canonical trajectory planning, continuous separation, SafetyValidator and export readiness.",
  };
}
