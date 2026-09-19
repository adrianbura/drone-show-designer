import type { VisualCompileIssue } from "@/lib/visual";

export type ImageDiagnosticsStatus = "CLEAR" | "ATTENTION";

const RESOLUTION_CODES = new Set(["DETAILS_OMITTED", "UNDER_RESOLVED"]);

export interface ImageDiagnosticsSummary {
  readonly status: ImageDiagnosticsStatus;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly guidance: readonly VisualCompileIssue["code"][];
}

/** Pure presentation projection; it adds no safety meaning or blocking state. */
export function summarizeCompileIssues(
  issues: readonly VisualCompileIssue[],
): ImageDiagnosticsSummary {
  let warningCount = 0;
  let infoCount = 0;
  const guidance: VisualCompileIssue["code"][] = [];
  let seenResolution = false;

  for (const issue of issues) {
    if (issue.severity === "warning") warningCount += 1;
    else infoCount += 1;
    if (RESOLUTION_CODES.has(issue.code)) {
      if (seenResolution) continue;
      seenResolution = true;
      guidance.push("DETAILS_OMITTED");
    } else if (!guidance.includes(issue.code)) guidance.push(issue.code);
  }

  return {
    status: warningCount > 0 ? "ATTENTION" : "CLEAR",
    warningCount,
    infoCount,
    guidance,
  };
}
