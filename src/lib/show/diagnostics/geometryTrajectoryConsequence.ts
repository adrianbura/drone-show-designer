import { reconcileReferenceLayer } from "../../import/essp/native/intervals";
import type { AnalyzeFullShowOptions, FullShowStatus } from "../fullshow/types";
import { analyzeFullShow } from "../fullshow/validator";
import type { ShowProject, Vector3Tuple } from "../types";

/**
 * READ-ONLY GEOMETRY -> TRAJECTORY CONSEQUENCE EVALUATION.
 *
 * This module does not apply geometry and does not create a second safety model.
 * It runs BEFORE and AFTER projects through the existing canonical full-show
 * pipeline and reports the deltas. PASS means only that the configured simulation
 * and safety profile did not detect a blocking issue; it is not flight approval.
 */

const PREVIEW_PROMOTION_TIME = "1970-01-01T00:00:00.000Z";

export interface GeometryTrajectorySnapshot {
  readonly status: FullShowStatus;
  readonly exportReadiness: "READY" | "READY_WITH_WARNINGS" | "BLOCKED";
  readonly analysisRevision: string;
  readonly minimumDynamicSeparation: number;
  readonly maximumVelocity: number;
  readonly maximumAcceleration: number;
  readonly maximumJerk: number;
  readonly totalConflictCount: number;
  readonly continuityIssueCount: number;
  readonly spliceOk: boolean | null;
  readonly effectiveAuthorityKind: "PLANNER_ONLY" | "SPLICED";
  readonly plannerSeconds: number;
  readonly referenceSeconds: number;
  readonly blockingIssueCount: number;
  readonly warningCount: number;
  readonly promotedClipIds: readonly string[];
}

export interface GeometryTrajectoryDelta {
  readonly minimumDynamicSeparation: number;
  readonly maximumVelocity: number;
  readonly maximumAcceleration: number;
  readonly maximumJerk: number;
  readonly totalConflictCount: number;
  readonly continuityIssueCount: number;
  readonly blockingIssueCount: number;
  readonly warningCount: number;
}

export interface GeometryTrajectoryConsequenceReport {
  readonly before: GeometryTrajectorySnapshot;
  readonly after: GeometryTrajectorySnapshot;
  readonly delta: GeometryTrajectoryDelta;
  /** True only when the canonical AFTER report is not FAIL/BLOCKED. */
  readonly canonicalProfilePass: boolean;
  /** True when the candidate effective show contains planner-owned time. */
  readonly candidateGeometryExercisedByPlanner: boolean;
  /** New hypothetical promotions caused by the candidate project. */
  readonly newlyPromotedClipIds: readonly string[];
  readonly note: string;
}

function snapshot(result: ReturnType<typeof analyzeFullShow>): GeometryTrajectorySnapshot {
  const { plan, report } = result;
  return {
    status: report.status,
    exportReadiness: report.exportReadiness.status,
    analysisRevision: report.analysisRevision,
    minimumDynamicSeparation: report.metrics.minimumDynamicSeparation,
    maximumVelocity: report.metrics.maximumVelocity,
    maximumAcceleration: report.metrics.maximumAcceleration,
    maximumJerk: report.metrics.maximumJerk,
    totalConflictCount: report.metrics.totalConflictCount,
    continuityIssueCount: report.continuity.issues.length,
    spliceOk: report.splice?.ok ?? null,
    effectiveAuthorityKind: plan.effectiveAuthority.kind,
    plannerSeconds: plan.effectiveAuthority.plannerSeconds,
    referenceSeconds: plan.effectiveAuthority.referenceSeconds,
    blockingIssueCount: report.errors.length,
    warningCount: report.warnings.length,
    promotedClipIds: [...plan.effectiveAuthority.promotedClipIds],
  };
}

const delta = (after: number, before: number): number => {
  if (after === before) return 0;
  if (!Number.isFinite(after) && !Number.isFinite(before)) return 0;
  return after - before;
};

function reconciledOptions(
  project: ShowProject,
  options: AnalyzeFullShowOptions,
): AnalyzeFullShowOptions {
  if (!options.reference) return options;
  const context = {
    assignmentStrategy: options.assignmentStrategy ?? "nearestNeighbor",
    transitionOverrides: options.transitionOverrides ?? {},
  };
  const reconciled = reconcileReferenceLayer(
    project,
    options.reference.layer,
    context,
    PREVIEW_PROMOTION_TIME,
  );
  return {
    ...options,
    reference: {
      show: options.reference.show,
      layer: reconciled.layer,
    },
  };
}

/**
 * Runs two project states through the SAME canonical full-show validation path.
 * The inputs are never mutated.
 *
 * Imported ESSP projects are previewed honestly: their reference layer is
 * reconciled independently against BEFORE and AFTER output signatures. A geometry
 * change therefore hypothetically promotes exactly the same clip closure that a
 * real authoring edit would promote, and the AFTER analysis judges that mixed
 * effective show rather than accidentally hiding the proposal behind REFERENCE.
 */
export function evaluateGeometryTrajectoryConsequence(
  beforeProject: ShowProject,
  afterProject: ShowProject,
  options: AnalyzeFullShowOptions = {},
): GeometryTrajectoryConsequenceReport {
  const beforeOptions = reconciledOptions(beforeProject, options);
  const afterOptions = reconciledOptions(afterProject, options);
  const before = snapshot(analyzeFullShow(beforeProject, beforeOptions));
  const after = snapshot(analyzeFullShow(afterProject, afterOptions));
  const prior = new Set(before.promotedClipIds);
  const newlyPromotedClipIds = after.promotedClipIds.filter((id) => !prior.has(id));
  const candidateGeometryExercisedByPlanner =
    after.effectiveAuthorityKind === "PLANNER_ONLY" || after.plannerSeconds > 1e-9;
  return {
    before,
    after,
    delta: {
      minimumDynamicSeparation: delta(after.minimumDynamicSeparation, before.minimumDynamicSeparation),
      maximumVelocity: delta(after.maximumVelocity, before.maximumVelocity),
      maximumAcceleration: delta(after.maximumAcceleration, before.maximumAcceleration),
      maximumJerk: delta(after.maximumJerk, before.maximumJerk),
      totalConflictCount: after.totalConflictCount - before.totalConflictCount,
      continuityIssueCount: after.continuityIssueCount - before.continuityIssueCount,
      blockingIssueCount: after.blockingIssueCount - before.blockingIssueCount,
      warningCount: after.warningCount - before.warningCount,
    },
    canonicalProfilePass: after.status !== "FAIL" && after.exportReadiness !== "BLOCKED",
    candidateGeometryExercisedByPlanner,
    newlyPromotedClipIds,
    note:
      "CANONICAL PIPELINE COMPARISON ONLY. Imported reference ownership is reconciled hypothetically from output signatures before each analysis, so edited intervals are judged by the same planner/reference rules as real authoring. A passing result is not a certification or authorisation to fly.",
  };
}

/**
 * Pure helper for the simplest authoring case: replace one reusable formation's
 * point cloud while preserving every other project field. Scene/object-level
 * proposals must be materialised by their own scene authoring authority instead.
 */
export function projectWithFormationPoints(
  project: ShowProject,
  formationId: string,
  points: readonly Vector3Tuple[],
): ShowProject {
  const index = project.formations.findIndex((f) => f.id === formationId);
  if (index < 0) throw new Error(`formation not found: ${formationId}`);
  const existing = project.formations[index]!;
  if (existing.points.length !== points.length) {
    throw new Error(
      `formation point-count mismatch for ${formationId}: ${existing.points.length} -> ${points.length}`,
    );
  }
  const formations = project.formations.map((formation, i) =>
    i === index
      ? { ...formation, points: points.map((p) => [p[0], p[1], p[2]] as Vector3Tuple) }
      : formation,
  );
  return { ...project, formations };
}
