import type { ShowProject, Vector3Tuple } from "../types";
import { clipPhase } from "../types";
import type { AudienceView } from "./audienceProjection";
import {
  optimizeProjectionPreservingStackProposal,
  type GeometryProposalOptimizerOptions,
  type GeometryProposalOptimizationResult,
} from "./geometryProposalOptimizer";
import {
  resolveProposalMaterialisation,
  type ProposalMaterialisation,
} from "./geometryProposalMaterialisation";

/**
 * READ-ONLY HOLD OPPORTUNITY FINDER.
 *
 * Geometry Proposal can only be applied honestly on instants that the canonical
 * materialisation resolver can represent. Searching arbitrary sampled show
 * frames is therefore misleading: the "worst" vertical-stack frame may sit
 * inside a transition where Apply is intentionally unavailable.
 *
 * This helper inspects one deterministic instant per SHOW hold (the hold
 * midpoint), asks the canonical materialisation resolver whether that instant is
 * representable, then runs the existing proposal optimizer on the supplied
 * point sampler. It never mutates project state and never makes a safety claim.
 */

export interface GeometryProposalOpportunity {
  readonly clipId: string;
  readonly time: number;
  readonly materialisation: Exclude<ProposalMaterialisation, { readonly kind: "UNAVAILABLE" }>;
  readonly optimization: GeometryProposalOptimizationResult;
}

export interface GeometryProposalOpportunityReport {
  readonly checkedHoldCount: number;
  readonly materialisableHoldCount: number;
  readonly opportunities: readonly GeometryProposalOpportunity[];
  readonly best: GeometryProposalOpportunity | null;
  readonly note: string;
}

function compareOpportunity(a: GeometryProposalOpportunity, b: GeometryProposalOpportunity): number {
  const aBefore = a.optimization.before.candidatePairCount;
  const bBefore = b.optimization.before.candidatePairCount;
  if (aBefore !== bBefore) return bBefore - aBefore;

  const aReduction = a.optimization.best?.candidatePairReduction ?? 0;
  const bReduction = b.optimization.best?.candidatePairReduction ?? 0;
  if (aReduction !== bReduction) return bReduction - aReduction;

  const aAfter = a.optimization.best?.after.candidatePairCount ?? Number.MAX_SAFE_INTEGER;
  const bAfter = b.optimization.best?.after.candidatePairCount ?? Number.MAX_SAFE_INTEGER;
  if (aAfter !== bAfter) return aAfter - bAfter;

  if (a.time !== b.time) return a.time - b.time;
  return a.clipId.localeCompare(b.clipId);
}

export function findGeometryProposalOpportunities(
  project: ShowProject,
  pointsAt: (time: number) => readonly Vector3Tuple[],
  view: AudienceView,
  options: GeometryProposalOptimizerOptions = {},
): GeometryProposalOpportunityReport {
  let checkedHoldCount = 0;
  let materialisableHoldCount = 0;
  const opportunities: GeometryProposalOpportunity[] = [];

  for (const clip of project.timeline) {
    if (clipPhase(clip) !== "SHOW" || clip.hold <= 0) continue;
    checkedHoldCount += 1;

    const time = clip.start + clip.transition + clip.hold * 0.5;
    const points = pointsAt(time);
    const materialisation = resolveProposalMaterialisation(project, time, points.length);
    if (materialisation.kind === "UNAVAILABLE") continue;
    materialisableHoldCount += 1;

    const optimization = optimizeProjectionPreservingStackProposal(points, view, options);
    if (!optimization.best || !optimization.improved) continue;

    opportunities.push({
      clipId: clip.id,
      time,
      materialisation,
      optimization,
    });
  }

  opportunities.sort(compareOpportunity);
  return {
    checkedHoldCount,
    materialisableHoldCount,
    opportunities,
    best: opportunities[0] ?? null,
    note:
      "DIAGNOSTIC NAVIGATION ONLY. Hold midpoints are searched because they are materialisable authoring instants; this does not replace full-show trajectory validation or continuous conflict detection.",
  };
}
