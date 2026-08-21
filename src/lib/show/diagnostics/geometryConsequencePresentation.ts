/**
 * CONSEQUENCE EVIDENCE — PRESENTATION MAPPING (PURE, READ-ONLY).
 *
 * Flattens the canonical static preflight, canonical full-show trajectory
 * consequence and canonical apply-readiness reports into ordered rows for the
 * Geometry Proposal panel. NO policy, NO thresholds and NO verdicts are decided
 * here: every status string comes from the authority that produced it.
 */
import type { GeometryApplyReadinessReport } from "./geometryApplyReadiness";
import type { GeometryConsequencePreflightReport } from "./geometryConsequencePreflight";
import type { GeometryTrajectoryConsequenceReport } from "./geometryTrajectoryConsequence";

export const CONSEQUENCE_WORDING = {
  staticHeader: "STATIC CONSEQUENCE PREFLIGHT",
  staticScope:
    "STATIC ONLY. This evaluates the proposed point cloud against show area, altitude and static 3D separation at this instant. It is not a flight-safety result and does not evaluate trajectories, dynamics or export readiness.",
  trajectoryHeader: "TRAJECTORY CONSEQUENCE",
  trajectoryScope:
    "Produced by the SAME canonical full-show validation path as normal validation, on a hypothetical project. A passing result is not certification or authorisation to fly.",
  ownershipHeader: "IMPORTED OUTPUT OWNERSHIP CHANGE",
  ownershipExplain:
    "These intervals would no longer preserve the imported trajectory bytes after the geometry edit.",
  readinessHeader: "APPLY READINESS",
  applyBlocked: "Apply unavailable — resolve proposal preflight blockers",
  applyReady: "Apply integration ready — authoring command not enabled yet",
  staleEvidence:
    "STALE — trajectory evidence was computed for different settings. Re-evaluate before trusting it.",
  unavailableTrajectory: "Full trajectory consequence preview unavailable for this scene representation",
} as const;

export interface ConsequenceRow {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly emphasis?: "good" | "warn" | "bad" | undefined;
}

const m = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)} m` : "—");
const n = (v: number) => String(v);

function countEmphasis(before: number, after: number): ConsequenceRow["emphasis"] {
  if (after > before) return "bad";
  if (after < before) return "good";
  return undefined;
}

/** Static preflight rows. Wording is deliberately static-scoped. */
export function buildStaticPreflightRows(
  report: GeometryConsequencePreflightReport,
): readonly ConsequenceRow[] {
  return [
    {
      label: "point count preserved",
      before: n(report.before.pointCount),
      after: n(report.after.pointCount),
      emphasis: report.pointCountMatches ? "good" : "bad",
    },
    {
      label: "show-area violations",
      before: n(report.before.outsideAreaCount),
      after: n(report.after.outsideAreaCount),
      emphasis: countEmphasis(report.before.outsideAreaCount, report.after.outsideAreaCount),
    },
    {
      label: "altitude violations",
      before: n(report.before.belowGroundCount + report.before.aboveAltitudeCeilingCount),
      after: n(report.after.belowGroundCount + report.after.aboveAltitudeCeilingCount),
      emphasis: countEmphasis(
        report.before.belowGroundCount + report.before.aboveAltitudeCeilingCount,
        report.after.belowGroundCount + report.after.aboveAltitudeCeilingCount,
      ),
    },
    {
      label: "static 3D separation violations",
      before: n(report.before.pairSeparationViolationCount),
      after: n(report.after.pairSeparationViolationCount),
      emphasis: countEmphasis(
        report.before.pairSeparationViolationCount,
        report.after.pairSeparationViolationCount,
      ),
    },
    {
      label: "minimum static 3D separation",
      before: m(report.before.minPairSeparation3D),
      after: m(report.after.minPairSeparation3D),
      emphasis:
        report.after.minPairSeparation3D < report.before.minPairSeparation3D ? "warn" : undefined,
    },
  ];
}

export function staticPreflightVerdict(report: GeometryConsequencePreflightReport): "PASS" | "BLOCKED" {
  return report.staticEnvelopePass ? "PASS" : "BLOCKED";
}

/** Canonical BEFORE → AFTER full-show metrics. Values are copied, never judged. */
export function buildTrajectoryConsequenceRows(
  report: GeometryTrajectoryConsequenceReport,
): readonly ConsequenceRow[] {
  const b = report.before;
  const a = report.after;
  return [
    { label: "full-show status", before: b.status, after: a.status, emphasis: a.status === "FAIL" ? "bad" : undefined },
    {
      label: "export readiness",
      before: b.exportReadiness,
      after: a.exportReadiness,
      emphasis: a.exportReadiness === "BLOCKED" ? "bad" : undefined,
    },
    {
      label: "min dynamic separation",
      before: m(b.minimumDynamicSeparation),
      after: m(a.minimumDynamicSeparation),
      emphasis: report.delta.minimumDynamicSeparation < -1e-9 ? "warn" : undefined,
    },
    {
      label: "max velocity (m/s)",
      before: b.maximumVelocity.toFixed(2),
      after: a.maximumVelocity.toFixed(2),
      emphasis: report.delta.maximumVelocity > 1e-9 ? "warn" : undefined,
    },
    {
      label: "max acceleration (m/s²)",
      before: b.maximumAcceleration.toFixed(2),
      after: a.maximumAcceleration.toFixed(2),
      emphasis: report.delta.maximumAcceleration > 1e-9 ? "warn" : undefined,
    },
    {
      label: "max jerk (m/s³)",
      before: b.maximumJerk.toFixed(2),
      after: a.maximumJerk.toFixed(2),
      emphasis: report.delta.maximumJerk > 1e-9 ? "warn" : undefined,
    },
    {
      label: "conflict count",
      before: n(b.totalConflictCount),
      after: n(a.totalConflictCount),
      emphasis: countEmphasis(b.totalConflictCount, a.totalConflictCount),
    },
    {
      label: "continuity issues",
      before: n(b.continuityIssueCount),
      after: n(a.continuityIssueCount),
      emphasis: countEmphasis(b.continuityIssueCount, a.continuityIssueCount),
    },
    {
      label: "splice status",
      before: b.spliceOk === null ? "n/a" : b.spliceOk ? "ok" : "discontinuous",
      after: a.spliceOk === null ? "n/a" : a.spliceOk ? "ok" : "discontinuous",
      emphasis: a.spliceOk === false ? "bad" : undefined,
    },
    {
      label: "blocking issues",
      before: n(b.blockingIssueCount),
      after: n(a.blockingIssueCount),
      emphasis: countEmphasis(b.blockingIssueCount, a.blockingIssueCount),
    },
    {
      label: "warnings",
      before: n(b.warningCount),
      after: n(a.warningCount),
      emphasis: countEmphasis(b.warningCount, a.warningCount),
    },
  ];
}

/** Apply-action label derived ONLY from the canonical readiness authority. */
export function applyActionMessage(readiness: GeometryApplyReadinessReport | null): string {
  if (!readiness || readiness.status === "BLOCKED") return CONSEQUENCE_WORDING.applyBlocked;
  return CONSEQUENCE_WORDING.applyReady;
}
