/** "Do not worsen" apply-readiness for imported shows; native stays absolute. */
import { describe, expect, it } from "vitest";

import { evaluateGeometryApplyReadiness } from "../diagnostics/geometryApplyReadiness";
import type { GeometryConsequencePreflightReport } from "../diagnostics/geometryConsequencePreflight";
import type { GeometryTrajectoryConsequenceReport } from "../diagnostics/geometryTrajectoryConsequence";

const staticOk = {
  pointCountMatches: true,
  introducesAreaViolation: false,
  introducesAltitudeViolation: false,
  introducesPairSeparationViolation: false,
  staticEnvelopePass: true,
} as unknown as GeometryConsequencePreflightReport;

const snap = {
  status: "FAIL" as const,
  exportReadiness: "BLOCKED" as const,
  analysisRevision: "r",
  minimumDynamicSeparation: 1.99,
  maximumVelocity: 4,
  maximumAcceleration: 3,
  maximumJerk: 40,
  totalConflictCount: 3,
  continuityIssueCount: 0,
  spliceOk: true,
  effectiveAuthorityKind: "SPLICED" as const,
  plannerSeconds: 1,
  referenceSeconds: 500,
  blockingIssueCount: 2,
  warningCount: 0,
  promotedClipIds: [] as readonly string[],
};

function traj(after: Partial<typeof snap> = {}): GeometryTrajectoryConsequenceReport {
  const a = { ...snap, ...after };
  return {
    before: snap,
    after: a,
    delta: {
      minimumDynamicSeparation: a.minimumDynamicSeparation - snap.minimumDynamicSeparation,
      maximumVelocity: a.maximumVelocity - snap.maximumVelocity,
      maximumAcceleration: a.maximumAcceleration - snap.maximumAcceleration,
      maximumJerk: a.maximumJerk - snap.maximumJerk,
      totalConflictCount: a.totalConflictCount - snap.totalConflictCount,
      continuityIssueCount: 0,
      blockingIssueCount: a.blockingIssueCount - snap.blockingIssueCount,
      warningCount: 0,
    },
    newlyPromotedClipIds: [],
    candidateGeometryExercisedByPlanner: true,
    canonicalProfilePass: a.status !== "FAIL" && a.exportReadiness !== "BLOCKED",
    note: "t",
  } as unknown as GeometryTrajectoryConsequenceReport;
}

const limits = { maxVelocity: 12, maxAcceleration: 5, maxJerk: 48.4, minSeparation: 1.95 };

describe("imported do-not-worsen readiness", () => {
  it("allows an edit of an already-failing imported show that adds nothing", () => {
    const r = evaluateGeometryApplyReadiness({
      staticPreflight: staticOk,
      trajectory: traj(),
      importedDoNotWorsen: true,
      limits,
    });
    expect(r.canApply).toBe(true);
  });
  it("refuses an edit that adds one blocking issue", () => {
    const r = evaluateGeometryApplyReadiness({
      staticPreflight: staticOk,
      trajectory: traj({ blockingIssueCount: 3 }),
      importedDoNotWorsen: true,
      limits,
    });
    expect(r.canApply).toBe(false);
  });
  it("refuses an edit that adds a conflict", () => {
    const r = evaluateGeometryApplyReadiness({
      staticPreflight: staticOk,
      trajectory: traj({ totalConflictCount: 4 }),
      importedDoNotWorsen: true,
      limits,
    });
    expect(r.canApply).toBe(false);
  });
  it("refuses an edit that lowers separation below the profile", () => {
    const r = evaluateGeometryApplyReadiness({
      staticPreflight: staticOk,
      trajectory: traj({ minimumDynamicSeparation: 1.9 }),
      importedDoNotWorsen: true,
      limits,
    });
    expect(r.canApply).toBe(false);
  });
  it("native projects stay absolute: the same failing show is blocked", () => {
    const r = evaluateGeometryApplyReadiness({ staticPreflight: staticOk, trajectory: traj() });
    expect(r.canApply).toBe(false);
  });
  it("missing trajectory evidence stays fail-closed even when imported", () => {
    const r = evaluateGeometryApplyReadiness({
      staticPreflight: staticOk,
      trajectory: null,
      importedDoNotWorsen: true,
      limits,
    });
    expect(r.canApply).toBe(false);
  });
});
