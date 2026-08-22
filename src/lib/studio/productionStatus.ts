/**
 * PRODUCTION STATUS — PURE PRESENTATION MODEL.
 *
 * ONE dominant export readiness state for the operator. This module DERIVES NO
 * NEW AUTHORITY: it reads the canonical export eligibility (which itself only
 * reads `FullShowValidationReport.exportReadiness`) and flattens it into the
 * wording, tone and next action the primary workflow shows.
 *
 * Current-frame authoring safety (`safety.status`) is intentionally NOT an input
 * here: it is authoring feedback, never the export-authorizing result.
 */
import {
  evaluateExportEligibility,
  type ExportEligibility,
} from "@/lib/adapters/exportEligibility";
import type { FullShowValidationReport } from "@/lib/show/fullshow/types";

export type ProductionReadiness =
  | "NOT_ANALYZED"
  | "STALE"
  | "BLOCKED"
  | "READY_WITH_WARNINGS"
  | "READY";

/** What the operator should do next on the primary path. */
export type ProductionNextAction = "RUN_VALIDATION" | "REVIEW_BLOCKERS" | "EXPORT";

export type ProductionTone = "neutral" | "review" | "unsafe" | "nominal";

export interface ProductionStatusModel {
  readonly readiness: ProductionReadiness;
  /** Short pill wording. */
  readonly label: string;
  /** One sentence: what happened + what to do next. */
  readonly detail: string;
  readonly tone: ProductionTone;
  readonly nextAction: ProductionNextAction;
  readonly nextActionLabel: string;
  readonly canExport: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  /** Mirrored canonical eligibility, for panels that need the raw model. */
  readonly eligibility: ExportEligibility;
}

const READINESS_BY_REASON: Record<ExportEligibility["reason"], ProductionReadiness> = {
  NO_REPORT: "NOT_ANALYZED",
  STALE: "STALE",
  BLOCKED: "BLOCKED",
  OK_WITH_WARNINGS: "READY_WITH_WARNINGS",
  OK: "READY",
};

const PRESENTATION: Record<
  ProductionReadiness,
  {
    label: string;
    detail: string;
    tone: ProductionTone;
    nextAction: ProductionNextAction;
    nextActionLabel: string;
  }
> = {
  NOT_ANALYZED: {
    label: "Not analysed",
    detail: "This show has not been validated yet. Run Full-Show Validation to enable export.",
    tone: "neutral",
    nextAction: "RUN_VALIDATION",
    nextActionLabel: "Run Full-Show Validation",
  },
  STALE: {
    label: "Stale",
    detail: "The show changed after the last validation. Run Full-Show Validation again.",
    tone: "review",
    nextAction: "RUN_VALIDATION",
    nextActionLabel: "Re-run Full-Show Validation",
  },
  BLOCKED: {
    label: "Blocked",
    detail: "Validation blocked flight export. Review the blockers and fix the show.",
    tone: "unsafe",
    nextAction: "REVIEW_BLOCKERS",
    nextActionLabel: "Review blockers",
  },
  READY_WITH_WARNINGS: {
    label: "Ready with warnings",
    detail: "Export is allowed with non-blocking warnings. Review them, then export.",
    tone: "review",
    nextAction: "EXPORT",
    nextActionLabel: "Export flight output",
  },
  READY: {
    label: "Ready",
    detail:
      "Validated against the current safety profile. Not a real-world safety guarantee.",
    tone: "nominal",
    nextAction: "EXPORT",
    nextActionLabel: "Export flight output",
  },
};

export function buildProductionStatus(
  report: FullShowValidationReport | null | undefined,
  stale: boolean,
): ProductionStatusModel {
  const eligibility = evaluateExportEligibility(report, stale);
  const readiness = READINESS_BY_REASON[eligibility.reason];
  const p = PRESENTATION[readiness];
  return {
    readiness,
    label: p.label,
    detail: p.detail,
    tone: p.tone,
    nextAction: p.nextAction,
    nextActionLabel: p.nextActionLabel,
    canExport: eligibility.canExportComputedShow,
    blockers: eligibility.blockers,
    warnings: eligibility.warnings,
    eligibility,
  };
}

/** Operator-facing authority label for imported / authored / mixed shows. */
export type AuthorityLabel = "REFERENCE" | "PLANNER" | "MIXED";

export interface AuthorityModel {
  readonly label: AuthorityLabel;
  readonly detail: string;
}

export function authorityLabel(
  ownership: { referenceIntervalCount: number; plannerIntervalCount: number } | null | undefined,
): AuthorityModel | null {
  if (!ownership) return null;
  const ref = ownership.referenceIntervalCount > 0;
  const planner = ownership.plannerIntervalCount > 0;
  if (!ref && !planner) return null;
  if (ref && planner) {
    return {
      label: "MIXED",
      detail: "Part of this show plays the original imported trajectories, part is Studio-authored.",
    };
  }
  if (ref) {
    return {
      label: "REFERENCE",
      detail: "This show plays the original imported trajectory and lighting data.",
    };
  }
  return { label: "PLANNER", detail: "This show is Studio-authored." };
}
