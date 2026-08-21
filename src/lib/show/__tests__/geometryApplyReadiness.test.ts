import { describe, expect, it } from "vitest";

import { evaluateGeometryApplyReadiness } from "../diagnostics/geometryApplyReadiness";
import type { GeometryConsequencePreflightReport } from "../diagnostics/geometryConsequencePreflight";
import type { GeometryTrajectoryConsequenceReport } from "../diagnostics/geometryTrajectoryConsequence";

function staticReport(overrides: Partial<GeometryConsequencePreflightReport> = {}): GeometryConsequencePreflightReport {
  const snapshot = {
    pointCount: 2,
    minPairSeparation3D: 3,
    minAltitude: 10,
    maxAltitude: 20,
    maxAbsX: 5,
    maxAbsZ: 5,
    outsideAreaCount: 0,
    belowGroundCount: 0,
    aboveAltitudeCeilingCount: 0,
    pairSeparationViolationCount: 0,
  };
  return {
    before: snapshot,
    after: snapshot,
    pointCountMatches: true,
    introducesAreaViolation: false,
    introducesAltitudeViolation: false,
    introducesPairSeparationViolation: false,
    staticEnvelopePass: true,
    note: "test",
    ...overrides,
  };
}

function trajectoryReport(overrides: Partial<GeometryTrajectoryConsequenceReport> = {}): GeometryTrajectoryConsequenceReport {
  const snapshot = {
    status: "PASS" as const,
    exportReadiness: "READY" as const,
    analysisRevision: "r1",
    minimumDynamicSeparation: 3,
    maximumVelocity: 2,
    maximumAcceleration: 2,
    maximumJerk: 2,
    totalConflictCount: 0,
    continuityIssueCount: 0,
    spliceOk: null,
    effectiveAuthorityKind: "PLANNER_ONLY" as const,
    plannerSeconds: 10,
    referenceSeconds: 0,
    blockingIssueCount: 0,
    warningCount: 0,
    promotedClipIds: [] as readonly string[],
  };
  return {
    before: snapshot,
    after: snapshot,
    delta: {
      minimumDynamicSeparation: 0,
      maximumVelocity: 0,
      maximumAcceleration: 0,
      maximumJerk: 0,
      totalConflictCount: 0,
      continuityIssueCount: 0,
      blockingIssueCount: 0,
      warningCount: 0,
    },
    canonicalProfilePass: true,
    candidateGeometryExercisedByPlanner: true,
    newlyPromotedClipIds: [],
    note: "test",
    ...overrides,
  };
}

describe("geometry apply readiness", () => {
  it("is READY only with both static and canonical trajectory evidence", () => {
    const report = evaluateGeometryApplyReadiness({
      staticPreflight: staticReport(),
      trajectory: trajectoryReport(),
    });
    expect(report.status).toBe("READY");
    expect(report.canApply).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it("blocks when static preflight is missing", () => {
    const report = evaluateGeometryApplyReadiness({ staticPreflight: null, trajectory: trajectoryReport() });
    expect(report.canApply).toBe(false);
    expect(report.blockers.join(" ")).toMatch(/Static geometry/);
  });

  it("blocks a newly introduced static separation violation", () => {
    const report = evaluateGeometryApplyReadiness({
      staticPreflight: staticReport({ introducesPairSeparationViolation: true, staticEnvelopePass: false }),
      trajectory: trajectoryReport(),
    });
    expect(report.status).toBe("BLOCKED");
    expect(report.blockers.join(" ")).toMatch(/static 3D separation/);
  });

  it("blocks canonical FAIL/BLOCKED results", () => {
    const bad = trajectoryReport({
      canonicalProfilePass: false,
      after: {
        ...trajectoryReport().after,
        status: "FAIL",
        exportReadiness: "BLOCKED",
        blockingIssueCount: 2,
      },
    });
    const report = evaluateGeometryApplyReadiness({ staticPreflight: staticReport(), trajectory: bad });
    expect(report.canApply).toBe(false);
    expect(report.blockers.length).toBeGreaterThan(0);
  });

  it("blocks when candidate geometry is not exercised by planner-owned time", () => {
    const report = evaluateGeometryApplyReadiness({
      staticPreflight: staticReport(),
      trajectory: trajectoryReport({ candidateGeometryExercisedByPlanner: false }),
    });
    expect(report.canApply).toBe(false);
    expect(report.blockers.join(" ")).toMatch(/planner-owned/);
  });

  it("requires explicit acknowledgement for new imported ownership promotions", () => {
    const trajectory = trajectoryReport({ newlyPromotedClipIds: ["scene-13"] });
    const blocked = evaluateGeometryApplyReadiness({ staticPreflight: staticReport(), trajectory });
    expect(blocked.canApply).toBe(false);
    expect(blocked.newlyPromotedClipIds).toEqual(["scene-13"]);

    const acknowledged = evaluateGeometryApplyReadiness({
      staticPreflight: staticReport(),
      trajectory,
      importedPromotionAcknowledged: true,
    });
    expect(acknowledged.canApply).toBe(true);
    expect(acknowledged.status).toBe("WARNING");
  });

  it("surfaces regressions as warnings without inventing a second safety gate", () => {
    const trajectory = trajectoryReport({
      delta: {
        ...trajectoryReport().delta,
        minimumDynamicSeparation: -0.2,
        maximumVelocity: 0.4,
        maximumAcceleration: 0.3,
        maximumJerk: 0.2,
      },
      after: { ...trajectoryReport().after, exportReadiness: "READY_WITH_WARNINGS" },
    });
    const report = evaluateGeometryApplyReadiness({ staticPreflight: staticReport(), trajectory });
    expect(report.canApply).toBe(true);
    expect(report.status).toBe("WARNING");
    expect(report.warnings.length).toBeGreaterThanOrEqual(4);
  });
});
