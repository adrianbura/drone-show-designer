import type { FullShowValidationReport } from "@/lib/show/fullshow/types";

/**
 * Canonical UI eligibility for COMPUTED SHOW EXPORTS (generic show JSON,
 * trajectory + light CSV). FullShowValidationReport.exportReadiness stays the
 * single safety authority — this helper only reads it.
 */
export type ExportEligibilityReason =
  | "OK"
  | "OK_WITH_WARNINGS"
  | "NO_REPORT"
  | "STALE"
  | "BLOCKED";

export interface ExportEligibility {
  /** Generic show JSON + trajectory CSV. */
  readonly canExportComputedShow: boolean;
  /** Studio project file is an editable document — always available. */
  readonly canExportProjectFile: true;
  readonly reason: ExportEligibilityReason;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
}

export function evaluateExportEligibility(
  report: FullShowValidationReport | null | undefined,
  stale: boolean,
): ExportEligibility {
  if (!report) {
    return {
      canExportComputedShow: false,
      canExportProjectFile: true,
      reason: "NO_REPORT",
      blockers: [],
      warnings: [],
    };
  }
  const { status, blockers, warnings } = report.exportReadiness;
  if (stale) {
    return {
      canExportComputedShow: false,
      canExportProjectFile: true,
      reason: "STALE",
      blockers,
      warnings,
    };
  }
  if (status === "BLOCKED") {
    return {
      canExportComputedShow: false,
      canExportProjectFile: true,
      reason: "BLOCKED",
      blockers,
      warnings,
    };
  }
  return {
    canExportComputedShow: true,
    canExportProjectFile: true,
    reason: status === "READY_WITH_WARNINGS" ? "OK_WITH_WARNINGS" : "OK",
    blockers,
    warnings,
  };
}
