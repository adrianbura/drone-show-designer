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
  /**
   * True only for projects carrying an IMPORTED_SHOW safety profile. Enables
   * the "do not worsen" policy: pre-existing problems of the imported show do
   * not block, only problems the proposal ADDS do. Native projects stay
   * absolute and fail-closed.
   */
  readonly importedDoNotWorsen?: boolean;
  /** Project limits used by the relative policy for v/a/j caps. */
  readonly limits?: { maxVelocity: number; maxAcceleration: number; maxJerk: number; minSeparation: number };
}

const STATUS_RANK: Record<string, number> = { PASS: 0, PASS_WITH_WARNINGS: 1, FAIL: 2 };

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
    if (input.importedDoNotWorsen) {
      const { before, after, delta } = trajectory;
      if ((STATUS_RANK[after.status] ?? 2) > (STATUS_RANK[before.status] ?? 2)) {
        blockers.push("The proposal makes the imported show's validation status worse.");
      }
      if (after.exportReadiness === "BLOCKED" && before.exportReadiness !== "BLOCKED") {
        blockers.push("The proposal makes the imported show not export-ready.");
      }
      if (after.spliceOk === false && before.spliceOk !== false) {
        blockers.push("The proposed imported/planner splice is discontinuous.");
      }
      if (after.blockingIssueCount > before.blockingIssueCount) {
        blockers.push(
          `The proposal adds ${after.blockingIssueCount - before.blockingIssueCount} blocking issue(s) to the imported show.`,
        );
      }
      if (delta.totalConflictCount > 0) {
        blockers.push(`The proposal adds ${delta.totalConflictCount} conflict(s).`);
      }
      const lim = input.limits;
      if (
        delta.minimumDynamicSeparation < -1e-9 &&
        (!lim || after.minimumDynamicSeparation < lim.minSeparation)
      ) {
        blockers.push("The proposal reduces minimum separation below the imported-show profile.");
      }
      if (lim) {
        if (delta.maximumVelocity > 1e-9 && after.maximumVelocity > lim.maxVelocity)
          blockers.push("The proposal raises maximum velocity above the imported-show profile.");
        if (delta.maximumAcceleration > 1e-9 && after.maximumAcceleration > lim.maxAcceleration)
          blockers.push("The proposal raises maximum acceleration above the imported-show profile.");
        if (delta.maximumJerk > 1e-9 && after.maximumJerk > lim.maxJerk)
          blockers.push("The proposal raises maximum jerk above the imported-show profile.");
      }
      if (blockers.length === 0 && after.blockingIssueCount > 0) {
        warnings.push(
          `The imported show already had ${before.blockingIssueCount} blocking issue(s); the proposal does not add any. Validated against the profile derived from the imported show — NOT flight authorization.`,
        );
      }
    } else {
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
