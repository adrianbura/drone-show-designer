/**
 * SHOW READINESS — PURE PRESENTATION PROJECTION.
 *
 * Recomputes nothing. It reads the canonical authorities only:
 *   - the project document (saved state, authored flight site),
 *   - `FullShowValidationReport` (freshness, blocking issues, geofence scan),
 *   - `evaluateExportEligibility` (the single export gate).
 *
 * No safety, geometry or geofence mathematics happens here, and it never calls a
 * show "safe to fly": it only says what still stands between the operator and a
 * simulator handoff.
 */
import { evaluateExportEligibility } from "./exportEligibility";
import type { GeofenceScanResult } from "@/lib/show/geo";
import type { FullShowValidationReport, FullShowIssue } from "@/lib/show/fullshow/types";

export type ReadinessItemId =
  | "SAVED"
  | "SITE"
  | "ANALYSIS"
  | "TRAJECTORY"
  | "GEOFENCE"
  | "HANDOFF";

export type ReadinessItemState = "OK" | "WARNING" | "BLOCKED" | "TODO";

export type ReadinessActionId =
  | "SAVE_PROJECT"
  | "CONFIGURE_SITE"
  | "ANALYZE_FULL_SHOW"
  | "OPEN_BLOCKING_ISSUES"
  | "EXPORT_SIMULATOR_PACKAGE";

export interface ReadinessItem {
  readonly id: ReadinessItemId;
  readonly label: string;
  readonly state: ReadinessItemState;
  readonly detail: string;
  /** The single action that resolves this item, when one exists. */
  readonly action: { readonly id: ReadinessActionId; readonly label: string } | null;
}

export interface ReadinessGeofenceFacts {
  readonly minClearanceM: number;
  readonly minHeadroomM: number;
  readonly outsideCount: number;
  readonly marginCount: number;
  readonly ceilingCount: number;
  readonly sampleCount: number;
}

export type ReadinessStatus = "READY" | "READY_WITH_WARNINGS" | "BLOCKED" | "INCOMPLETE";

export interface ShowReadinessModel {
  readonly status: ReadinessStatus;
  readonly statusDetail: string;
  readonly items: readonly ReadinessItem[];
  /** Canonical geofence numbers, verbatim; null when the report carries none. */
  readonly geofence: ReadinessGeofenceFacts | null;
  readonly blockingIssues: readonly FullShowIssue[];
  readonly canExportSimulatorPackage: boolean;
}

export interface ShowReadinessInput {
  readonly projectDirty: boolean;
  readonly hasFlightSite: boolean;
  readonly report: FullShowValidationReport | null | undefined;
  readonly stale: boolean;
}

const m = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)} m` : "n/a");

function geofenceFacts(scan: GeofenceScanResult | null): ReadinessGeofenceFacts | null {
  if (!scan) return null;
  return {
    minClearanceM: scan.minClearanceM,
    minHeadroomM: scan.minHeadroomM,
    outsideCount: scan.outsideCount,
    marginCount: scan.marginCount,
    ceilingCount: scan.ceilingCount,
    sampleCount: scan.sampleCount,
  };
}

export function buildShowReadiness(input: ShowReadinessInput): ShowReadinessModel {
  const { projectDirty, hasFlightSite, report, stale } = input;
  const eligibility = evaluateExportEligibility(report, stale);
  const geofence = geofenceFacts(report?.geofence ?? null);
  const blockingIssues = (report?.issues ?? []).filter((i) => i.severity === "error");

  const items: ReadinessItem[] = [
    {
      id: "SAVED",
      label: "Project saved",
      state: projectDirty ? "TODO" : "OK",
      detail: projectDirty
        ? "Unsaved changes — save the Studio document before handing it over."
        : "The Studio document matches the last save.",
      action: projectDirty ? { id: "SAVE_PROJECT", label: "Save project" } : null,
    },
    {
      id: "SITE",
      label: "Flight site configured",
      state: hasFlightSite ? "OK" : "TODO",
      detail: hasFlightSite
        ? "Take-off coordinates and authorised area are authored."
        : "No GPS site: the authorised area cannot be checked."
      ,
      action: hasFlightSite ? null : { id: "CONFIGURE_SITE", label: "Configure site" },
    },
    {
      id: "ANALYSIS",
      label: "Full-show analysis fresh",
      state: !report ? "TODO" : stale ? "BLOCKED" : "OK",
      detail: !report
        ? "No full-show analysis for this revision yet."
        : stale
          ? "The project changed after this analysis; results cannot be trusted."
          : `Analysed revision ${report.analysisRevision.slice(0, 10)}.`,
      action:
        !report || stale ? { id: "ANALYZE_FULL_SHOW", label: "Analyze full show" } : null,
    },
    {
      id: "TRAJECTORY",
      label: "No blocking trajectory issues",
      state: !report ? "TODO" : blockingIssues.length > 0 ? "BLOCKED" : "OK",
      detail: !report
        ? "Blocking issues are only known after a full-show analysis."
        : blockingIssues.length > 0
          ? `${blockingIssues.length} blocking issue(s) reported by full-show validation.`
          : `${report.warnings.length} warning(s), no blocking issue.`,
      action:
        report && blockingIssues.length > 0
          ? { id: "OPEN_BLOCKING_ISSUES", label: "Open blocking issues" }
          : null,
    },
    {
      id: "GEOFENCE",
      label: "Geofence checked",
      state: !geofence
        ? "TODO"
        : geofence.outsideCount > 0 || geofence.ceilingCount > 0
          ? "BLOCKED"
          : geofence.marginCount > 0
            ? "WARNING"
            : "OK",
      detail: !geofence
        ? hasFlightSite
          ? "Run the full-show analysis to scan the flown trajectory against the site."
          : "Authorise a site first, then run the full-show analysis."
        : geofence.outsideCount > 0 || geofence.ceilingCount > 0
          ? `${geofence.outsideCount} sample(s) outside the perimeter, ${geofence.ceilingCount} above the ceiling.`
          : geofence.marginCount > 0
            ? `${geofence.marginCount} sample(s) inside the authored clearance margin.`
            : `${geofence.sampleCount} sample(s) scanned; nothing outside the authored area.`,
      action: !geofence
        ? hasFlightSite
          ? { id: "ANALYZE_FULL_SHOW", label: "Analyze full show" }
          : { id: "CONFIGURE_SITE", label: "Configure site" }
        : geofence.outsideCount > 0 || geofence.ceilingCount > 0
          ? { id: "OPEN_BLOCKING_ISSUES", label: "Open blocking issues" }
          : null,
    },
    {
      id: "HANDOFF",
      label: "Simulator handoff available",
      state: eligibility.canExportComputedShow
        ? eligibility.reason === "OK_WITH_WARNINGS"
          ? "WARNING"
          : "OK"
        : eligibility.reason === "BLOCKED"
          ? "BLOCKED"
          : "TODO",
      detail: eligibility.canExportComputedShow
        ? "Canonical export gate allows a simulator handoff bundle."
        : eligibility.reason === "STALE"
          ? "Export stays closed while the analysis is stale."
          : eligibility.reason === "BLOCKED"
            ? "The canonical export gate blocks flight output."
            : "Export opens after a fresh full-show analysis.",
      action: eligibility.canExportComputedShow
        ? { id: "EXPORT_SIMULATOR_PACKAGE", label: "Export simulator package" }
        : null,
    },
  ];

  const blocked = items.some((i) => i.state === "BLOCKED");
  const todo = items.some((i) => i.state === "TODO");
  const warned = items.some((i) => i.state === "WARNING");
  const status: ReadinessStatus = blocked
    ? "BLOCKED"
    : todo
      ? "INCOMPLETE"
      : warned
        ? "READY_WITH_WARNINGS"
        : "READY";

  const statusDetail =
    status === "BLOCKED"
      ? "Blocking findings remain. Nothing here authorises a flight."
      : status === "INCOMPLETE"
        ? "Steps remain before a simulator handoff can be produced."
        : status === "READY_WITH_WARNINGS"
          ? "Handoff allowed with recorded warnings. Not a statement that the show is safe to fly."
          : "Every canonical check completed for this revision. Not a statement that the show is safe to fly.";

  return {
    status,
    statusDetail,
    items,
    geofence,
    blockingIssues,
    canExportSimulatorPackage: eligibility.canExportComputedShow,
  };
}

/** Human-readable geofence rows, straight from the canonical scan. */
export function geofenceFactRows(
  facts: ReadinessGeofenceFacts,
): readonly { readonly label: string; readonly value: string }[] {
  return [
    { label: "min boundary clearance", value: m(facts.minClearanceM) },
    { label: "min ceiling headroom", value: m(facts.minHeadroomM) },
    { label: "outside samples", value: String(facts.outsideCount) },
    { label: "margin samples", value: String(facts.marginCount) },
    { label: "ceiling samples", value: String(facts.ceilingCount) },
    { label: "scanned samples", value: String(facts.sampleCount) },
  ];
}
