/**
 * REFERENCE IMAGE DIAGNOSTICS — pure presentation helper.
 *
 * Derives an operator-facing summary from the canonical compiler report. It adds
 * no geometry, no severity of its own and no flight-safety meaning: every value
 * comes from the issues the Drone Art Compiler already produced. Full-show
 * validation stays the authority for anything safety related.
 */
import type { VisualCompileIssue } from "@/lib/visual";

export type ImageDiagnosticsStatus = "CLEAR" | "ATTENTION";

/** Issue codes that share one corrective hint (resolution of fine detail). */
const RESOLUTION_CODES = new Set(["DETAILS_OMITTED", "UNDER_RESOLVED"]);

export interface ImageDiagnosticsSummary {
  readonly status: ImageDiagnosticsStatus;
  readonly warningCount: number;
  readonly infoCount: number;
  /** Deduplicated guidance codes, in first-seen order. */
  readonly guidance: readonly VisualCompileIssue["code"][];
}

/**
 * Summarises compiler issues. ATTENTION only when the compiler itself flagged a
 * warning; info issues stay visible but do not raise the status.
 */
export function summarizeCompileIssues(
  issues: readonly VisualCompileIssue[],
): ImageDiagnosticsSummary {
  let warningCount = 0;
  let infoCount = 0;
  const guidance: VisualCompileIssue["code"][] = [];
  const seenResolution = { used: false };

  for (const issue of issues) {
    if (issue.severity === "warning") warningCount += 1;
    else infoCount += 1;

    if (RESOLUTION_CODES.has(issue.code)) {
      if (seenResolution.used) continue;
      seenResolution.used = true;
      guidance.push("DETAILS_OMITTED");
      continue;
    }
    if (!guidance.includes(issue.code)) guidance.push(issue.code);
  }

  return {
    status: warningCount > 0 ? "ATTENTION" : "CLEAR",
    warningCount,
    infoCount,
    guidance,
  };
}
