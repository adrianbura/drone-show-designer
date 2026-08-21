import type { GeometryConsequencePreflightReport } from "./geometryConsequencePreflight";
import type { GeometryTrajectoryConsequenceReport } from "./geometryTrajectoryConsequence";

/**
 * PURE / READ-ONLY APPLY-READINESS POLICY for a geometry proposal.
 *
 * This is deliberately NOT a safety validator and NOT an apply command. It only
 * decides whether the evidence already produced by the canonical static and
 * full-show consequence analyzers is sufficient to enable a future authoring
 * action. The future action must still be one undoable project command and must
 * recompute/reconcile ownership after applying.
 */

export type GeometryApplyReadinessStatus = "READY" | "WARNING" | "BLOCKED";

export interface GeometryApplyReadinessInput {
  readonly staticPreflight: GeometryConsequencePreflightReport | null;
  readonly trajectory: GeometryTrajectoryConsequenceReport | null;
  /**
   * Optional UI/product acknowledgement for imported ESSP proposals that would
   * promote previously REFERENCE-owned output to PLANNER ownership.
   */
  readonly importedPromotionAcknowledged?: boolean;
}

export interface GeometryApplyReadinessReport {
  readonly status: GeometryApplyReadinessStatus;
  readonly canApply: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly newlyPromotedClipIds: readonly string[];
  readonly note: string;
}

export function evaluateGeometryApplyReadiness(
  input: GeometryApplyReadinessInput,
): GeometryApplyReadinessReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const staticPreflight = input.staticPreflight;
  const trajectory = input.trajectory;

  if (!staticPreflight) {
    blockers.push("Static geometry consequence preflight has not been run.");
  } else {
    if (!staticPreflight.pointCountMatches) {
      blockers.push("Proposal changes the point count; assignment identity is not preserved.");
    }
    if (staticPreflight.introducesAreaViolation) {
      blockers.push("Proposal introduces new show-area violations.");
    }
    if (staticPreflight.introducesAltitudeViolation) {
      blockers.push("Proposal introduces new altitude violations.");
    }
    if (staticPreflight.introducesPairSeparationViolation) {
      blockers.push("Proposal introduces new static 3D separation violations.");
    }
    if (!staticPreflight.staticEnvelopePass && blockers.length === 0) {
      blockers.push("Static geometry consequence preflight did not pass.");
    }
  }

  let newlyPromotedClipIds: readonly string[] = [];
  if (!trajectory) {
    blockers.push("Canonical full-show trajectory consequence analysis has not been run.");
  } else {
    newlyPromotedClipIds = trajectory.newlyPromotedClipIds;
    if (!trajectory.candidateGeometryExercisedByPlanner) {
      blockers.push("The proposed geometry was not exercised by planner-owned trajectory time.");
    }
    if (!trajectory.canonicalProfilePass) {
      blockers.push("The proposed show is blocked by the canonical full-show validation profile.");
    }
    if (trajectory.after.status === "FAIL") {
      blockers.push("The proposed full show fails canonical validation.");
    }
    if (trajectory.after.exportReadiness === "BLOCKED") {
      blockers.push("The proposed full show is not export-ready.");
    }
    if (trajectory.after.spliceOk === false) {
      blockers.push("The proposed imported/planner splice is discontinuous.");
    }
    if (trajectory.after.blockingIssueCount > 0) {
      blockers.push(
        `The proposed full show has ${trajectory.after.blockingIssueCount} blocking issue(s).`,
      );
    }

    if (trajectory.after.exportReadiness === "READY_WITH_WARNINGS") {
      warnings.push("Canonical full-show validation is ready with warnings.");
    }
    if (trajectory.delta.totalConflictCount > 0) {
      warnings.push(
        `Proposal increases detected conflict count by ${trajectory.delta.totalConflictCount}.`,
      );
    }
    if (trajectory.delta.minimumDynamicSeparation < -1e-9) {
      warnings.push("Proposal reduces the minimum dynamic separation compared with before.");
    }
    if (trajectory.delta.maximumVelocity > 1e-9) {
      warnings.push("Proposal increases maximum velocity compared with before.");
    }
    if (trajectory.delta.maximumAcceleration > 1e-9) {
      warnings.push("Proposal increases maximum acceleration compared with before.");
    }
    if (trajectory.delta.maximumJerk > 1e-9) {
      warnings.push("Proposal increases maximum jerk compared with before.");
    }
  }

  if (newlyPromotedClipIds.length > 0) {
    if (!input.importedPromotionAcknowledged) {
      blockers.push(
        `Applying would promote ${newlyPromotedClipIds.length} imported clip(s) from REFERENCE to PLANNER ownership; acknowledgement is required.`,
      );
    } else {
      warnings.push(
        `Applying will promote imported clip(s) to PLANNER ownership: ${newlyPromotedClipIds.join(", ")}.`,
      );
    }
  }

  const canApply = blockers.length === 0;
  const status: GeometryApplyReadinessStatus = canApply
    ? warnings.length > 0
      ? "WARNING"
      : "READY"
    : "BLOCKED";

  return {
    status,
    canApply,
    blockers,
    warnings,
    newlyPromotedClipIds,
    note:
      "AUTHORING READINESS ONLY. READY means the proposal has passed the existing static consequence checks and canonical full-show validation evidence required to enable a future undoable Apply command. It is not a certification or authorisation to fly.",
  };
}
