/**
 * VALIDATION REPORT BUILDER — pure projection.
 *
 * Turns the canonical full-show validation report (plus the project's own site
 * and limits) into a printable document model. It performs NO safety, geometry
 * or geofence computation: every number it prints was produced by
 * `analyzeFullShow` / `scanGeofence` / the project itself.
 */
import { isSiteUsable, siteSummary } from "../show/geo";
import type { FullShowValidationReport } from "../show/fullshow/types";
import type { ShowProject } from "../show/types";
import {
  VALIDATION_REPORT_DISCLAIMER,
  type ReportBar,
  type ReportBlock,
  type ReportSection,
  type ValidationReportDocument,
} from "./types";

export interface BuildValidationReportInput {
  readonly project: ShowProject;
  readonly report: FullShowValidationReport;
  /** ISO-8601 instant, supplied by the caller so the builder stays pure. */
  readonly generatedAt: string;
}

const n = (value: number, digits = 2): string =>
  Number.isFinite(value) ? value.toFixed(digits) : "n/a";

function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "n/a";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")} (${n(seconds, 1)} s)`;
}

function verdict(measured: number, limit: number, mode: "max" | "min"): string {
  if (!Number.isFinite(measured)) return "not measured";
  if (mode === "max") return measured <= limit ? "within limit" : "EXCEEDED";
  return measured >= limit ? "within limit" : "BELOW LIMIT";
}

function statusDetail(report: FullShowValidationReport): string {
  if (report.status === "FAIL") {
    return `${report.errors.length} blocking finding${report.errors.length === 1 ? "" : "s"}. The show cannot be exported for flight.`;
  }
  if (report.status === "PASS_WITH_WARNINGS") {
    return `No blocking findings. ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"} require operator review.`;
  }
  return "All automated checks passed with no warnings.";
}

function limitsBlock(project: ShowProject, report: FullShowValidationReport): ReportBlock {
  const l = project.limits;
  const m = report.metrics;
  const rows: string[][] = [
    [
      "Horizontal/vertical speed",
      `${n(l.maxVelocity)} m/s`,
      `${n(m.maximumVelocity)} m/s`,
      verdict(m.maximumVelocity, l.maxVelocity, "max"),
    ],
    [
      "Acceleration",
      `${n(l.maxAcceleration)} m/s²`,
      `${n(m.maximumAcceleration)} m/s²`,
      verdict(m.maximumAcceleration, l.maxAcceleration, "max"),
    ],
    [
      "Jerk",
      `${n(l.maxJerk)} m/s³`,
      `${n(m.maximumJerk)} m/s³`,
      verdict(m.maximumJerk, l.maxJerk, "max"),
    ],
    [
      "Yaw rate",
      `${n(l.maxYawRate)} °/s`,
      `${n(m.maximumYawRate)} °/s`,
      verdict(m.maximumYawRate, l.maxYawRate, "max"),
    ],
    [
      "Separation between drones",
      `${n(l.minSeparation)} m`,
      `${n(m.minimumDynamicSeparation)} m`,
      verdict(m.minimumDynamicSeparation, l.minSeparation, "min"),
    ],
    [
      "Ceiling (show frame)",
      `${n(l.maxAltitude)} m`,
      `${n(Math.max(0, ...report.droneReports.map((d) => d.maxAltitude)))} m`,
      "",
    ],
  ];
  return { kind: "table", table: { columns: ["Check", "Limit", "Measured", "Verdict"], rows } };
}

function phaseBlock(report: FullShowValidationReport): ReportBlock {
  const rows = report.phaseReports.map((p) => [
    p.phase,
    `${n(p.start, 1)} – ${n(p.end, 1)} s`,
    `${n(p.minSeparation)} m`,
    `${n(p.maxVelocity)} m/s`,
    `${n(p.maxAcceleration)} m/s²`,
    String(p.conflictCount),
  ]);
  return {
    kind: "table",
    table: {
      columns: ["Phase", "Window", "Min separation", "Max speed", "Max accel", "Conflicts"],
      rows,
    },
  };
}

function separationBars(project: ShowProject, report: FullShowValidationReport): ReportBlock {
  const bars: ReportBar[] = report.phaseReports.map((p) => ({
    label: p.phase,
    value: Number.isFinite(p.minSeparation) ? p.minSeparation : 0,
    danger: p.minSeparation < project.limits.minSeparation,
  }));
  return {
    kind: "bars",
    unit: "m",
    bars,
    reference: {
      label: `required ${n(project.limits.minSeparation)} m`,
      value: project.limits.minSeparation,
    },
  };
}

function speedBars(project: ShowProject, report: FullShowValidationReport): ReportBlock {
  const limit = project.limits.maxVelocity;
  const buckets = 6;
  const step = limit > 0 ? limit / buckets : 1;
  const counts = new Array<number>(buckets + 1).fill(0);
  for (const drone of report.droneReports) {
    const v = Number.isFinite(drone.maxVelocity) ? drone.maxVelocity : 0;
    const index = v > limit ? buckets : Math.min(buckets - 1, Math.max(0, Math.floor(v / step)));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const bars: ReportBar[] = counts.map((count, index) => ({
    label:
      index === buckets ? `> ${n(limit, 1)}` : `${n(index * step, 1)}–${n((index + 1) * step, 1)}`,
    value: count,
    danger: index === buckets && count > 0,
  }));
  return { kind: "bars", unit: "drones", bars };
}

function issueList(
  report: FullShowValidationReport,
  kind: "errors" | "warnings",
  cap = 40,
): ReportBlock {
  const source = kind === "errors" ? report.errors : report.warnings;
  const items = source.slice(0, cap).map((issue) => {
    const at =
      Number.isFinite(issue.time as number) && issue.time !== undefined
        ? ` @ ${n(issue.time, 1)} s`
        : "";
    return `[${issue.category}/${issue.code}]${at} ${issue.message}`;
  });
  if (source.length > cap) items.push(`… and ${source.length - cap} more of the same kind.`);
  if (items.length === 0) items.push(kind === "errors" ? "No blocking findings." : "No warnings.");
  return { kind: "list", items };
}

function siteSection(project: ShowProject, report: FullShowValidationReport): ReportSection {
  const blocks: ReportBlock[] = [];
  if (isSiteUsable(project.site)) {
    const site = project.site;
    blocks.push({
      kind: "facts",
      facts: [
        {
          label: "Origin (WGS84)",
          value: `${site.origin.lat.toFixed(6)}, ${site.origin.lon.toFixed(6)}`,
        },
        { label: "Heading of local +Z", value: `${n(site.headingDeg, 1)}° from north` },
        { label: "Perimeter points", value: String(site.perimeter.length) },
        { label: "Required clearance", value: `${n(site.marginM, 1)} m inside the perimeter` },
        { label: "Authorised ceiling", value: `${n(site.ceilingM, 1)} m AGL` },
        { label: "Summary", value: siteSummary(site) },
      ],
    });
    const scan = report.geofence;
    if (scan) {
      blocks.push({
        kind: "facts",
        facts: [
          { label: "Samples scanned", value: String(scan.sampleCount) },
          { label: "Smallest clearance", value: `${n(scan.minClearanceM)} m` },
          { label: "Smallest ceiling headroom", value: `${n(scan.minHeadroomM)} m` },
          { label: "Outside perimeter", value: String(scan.outsideCount) },
          { label: "Inside clearance margin", value: String(scan.marginCount) },
          { label: "Above ceiling", value: String(scan.ceilingCount) },
        ],
      });
      if (scan.breaches.length > 0) {
        blocks.push({
          kind: "table",
          table: {
            columns: ["Drone", "Time", "Kind", "Clearance", "Headroom"],
            rows: scan.breaches
              .slice(0, 30)
              .map((b) => [
                `#${b.droneIndex + 1}`,
                `${n(b.time, 1)} s`,
                b.status,
                `${n(b.clearanceM)} m`,
                `${n(b.headroomM)} m`,
              ]),
          },
        });
      }
    } else {
      blocks.push({ kind: "note", text: "No geofence scan is present in this analysis." });
    }
  } else {
    blocks.push({
      kind: "note",
      text: "No real-world flight site is authored for this project, so no GPS perimeter or ceiling could be verified.",
    });
  }
  return { title: "1. Flight site and perimeter", blocks };
}

export function buildValidationReport(input: BuildValidationReportInput): ValidationReportDocument {
  const { project, report, generatedAt } = input;

  const sections: ReportSection[] = [
    siteSection(project, report),
    {
      title: "2. Show and fleet",
      blocks: [
        {
          kind: "facts",
          facts: [
            { label: "Show", value: project.name },
            { label: "Drones", value: String(report.droneCount) },
            { label: "Duration", value: duration(report.showDuration) },
            { label: "Timeline clips", value: String(report.timeline.clipCount) },
            {
              label: "Transitions",
              value: `${report.transitionCount} (${report.optimizedTransitions} optimised, ${report.unresolvedTransitions} unresolved)`,
            },
            { label: "Analysis sample rate", value: `${n(report.sampleRate, 1)} Hz` },
            {
              label: "Distance flown",
              value: `${n(report.metrics.totalDistanceFlown, 1)} m total, ${n(report.metrics.averageDistancePerDrone, 1)} m average per drone`,
            },
            {
              label: "Design area",
              value: `${n(project.area.width, 1)} × ${n(project.area.depth, 1)} × ${n(project.area.height, 1)} m`,
            },
          ],
        },
      ],
    },
    {
      title: "3. Safety limits versus measured flight",
      blocks: [limitsBlock(project, report), separationBars(project, report)],
    },
    { title: "4. Per-phase results", blocks: [phaseBlock(report)] },
    {
      title: "5. Peak speed distribution across the fleet",
      blocks: [speedBars(project, report)],
    },
    {
      title: "6. Conflicts and continuity",
      blocks: [
        {
          kind: "facts",
          facts: [
            {
              label: "Conflicts detected",
              value: `${report.conflicts.conflictCount} (${report.conflicts.criticalCount} critical)`,
            },
            {
              label: "Unique conflicting pairs",
              value: String(report.metrics.uniqueConflictPairs),
            },
            {
              label: "Trajectory continuity",
              value: report.continuity.ok
                ? "continuous"
                : `${report.continuity.issues.length} discontinuity finding(s)`,
            },
            {
              label: "Drones landed at their pad",
              value: `${report.continuity.landedCount} of ${report.droneCount}`,
            },
            {
              label: "Launch pads",
              value: `${report.homePads.padCount}, minimum spacing ${n(report.homePads.minSpacing)} m`,
            },
          ],
        },
      ],
    },
    { title: "7. Blocking findings", blocks: [issueList(report, "errors")] },
    { title: "8. Warnings", blocks: [issueList(report, "warnings")] },
    {
      title: "9. Export readiness",
      blocks: [
        {
          kind: "facts",
          facts: [
            { label: "Status", value: report.exportReadiness.status },
            { label: "Blockers", value: String(report.exportReadiness.blockers.length) },
            { label: "Warnings", value: String(report.exportReadiness.warnings.length) },
          ],
        },
        {
          kind: "list",
          items:
            report.exportReadiness.blockers.length > 0
              ? report.exportReadiness.blockers
              : ["No export blockers reported."],
        },
      ],
    },
    {
      title: "10. Provenance",
      blocks: [
        {
          kind: "facts",
          facts: [
            { label: "Project id", value: project.id },
            { label: "Analysis revision", value: report.analysisRevision },
            { label: "Show package id", value: report.showPackageId },
            { label: "Engine version", value: report.engineVersion },
            { label: "Trajectory algorithm", value: report.algorithmVersions.trajectory },
            { label: "Formation algorithm", value: report.algorithmVersions.formation },
          ],
        },
        { kind: "note", text: report.statement },
      ],
    },
  ];

  return {
    title: `Validation report — ${project.name}`,
    subtitle: `${report.droneCount} drones · ${duration(report.showDuration)}`,
    generatedAt,
    status: report.status,
    statusDetail: statusDetail(report),
    sections,
    disclaimer: VALIDATION_REPORT_DISCLAIMER,
  };
}

/** Deterministic, filesystem-safe file name for the rendered PDF. */
export function validationReportFileName(project: ShowProject, generatedAt: string): string {
  const slug = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stamp = generatedAt.replace(/[:.]/g, "-").replace(/Z$/, "");
  return `${slug || "show"}-validation-${stamp}.pdf`;
}
