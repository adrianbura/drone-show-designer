/**
 * GEOMETRY PROPOSAL OPPORTUNITY SEARCH — PURE PRESENTATION / STALENESS HELPERS.
 *
 * OPERATOR NAVIGATION ONLY. This module adds no proposal math, no safety policy
 * and no materialisation path: it only derives the search identity key (so an
 * old search result can never be shown as current) and maps the canonical
 * `findGeometryProposalOpportunities` report to display rows.
 */
import type { GeometryProposalOpportunity } from "@/lib/show/diagnostics";
import type { AudienceViewSettings } from "./audienceView";

export const NO_OPPORTUNITY_MESSAGE =
  "No materialisable SHOW hold with an improving proposal was found at the current diagnostic settings.";

export const SEARCHING_MESSAGE = "Searching materialisable holds…";

export interface OpportunitySearchInputs {
  /** Canonical revision of everything the analysis depends on (includes project). */
  readonly analysisRevision: string;
  readonly audience: AudienceViewSettings;
  readonly horizontalThresholdMeters: number;
  readonly minVerticalDifferenceMeters: number;
  readonly maxDisplacementMeters: number;
}

/** Identity of a search result. Any change here invalidates a previous search. */
export function opportunitySearchKey(inputs: OpportunitySearchInputs): string {
  return [
    inputs.analysisRevision,
    inputs.audience.distanceMeters,
    inputs.audience.eyeHeightMeters,
    inputs.audience.targetHeightMeters,
    inputs.horizontalThresholdMeters,
    inputs.minVerticalDifferenceMeters,
    inputs.maxDisplacementMeters,
  ].join("|");
}

export interface OpportunitySearchState {
  readonly key: string;
  readonly clipId: string | null;
  readonly time: number | null;
  readonly rows: readonly OpportunityRow[];
}

export function isOpportunitySearchStale(
  state: OpportunitySearchState | null,
  currentKey: string,
): boolean {
  return !!state && state.key !== currentKey;
}

export interface OpportunityRow {
  readonly label: string;
  readonly value: string;
}

/** Maps ONE canonical opportunity to compact operator-facing rows. */
export function buildOpportunityRows(
  opportunity: GeometryProposalOpportunity,
  clipLabel?: string,
): readonly OpportunityRow[] {
  const best = opportunity.optimization.best;
  return [
    { label: "clip", value: clipLabel ?? opportunity.clipId },
    { label: "time", value: `${opportunity.time.toFixed(2)} s` },
    {
      label: "pairs before",
      value: String(opportunity.optimization.before.candidatePairCount),
    },
    { label: "pairs after", value: String(best?.after.candidatePairCount ?? "—") },
    { label: "reduction", value: String(best?.candidatePairReduction ?? 0) },
    {
      label: "amplitude",
      value: best ? `${best.amplitudeMeters.toFixed(2)} m` : "—",
    },
    { label: "materialisation", value: opportunity.materialisation.kind },
  ];
}
