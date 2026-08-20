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
  /**
   * False when the candidate is entirely reference-owned. In that case the
   * changed project geometry may not have been exercised by the effective set.
   */
  readonly candidateGeometryExercisedByPlanner: boolean;
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
  };
}

const delta = (after: number, before: number): number => {
  if (after === before) return 0;
  if (!Number.isFinite(after) && !Number.isFinite(before)) return 0;
  return after - before;
};

/**
 * Runs two project states through the SAME canonical full-show validation path.
 * The inputs are never mutated. Callers are responsible for preparing the
 * candidate project/reference ownership that represents the proposed authoring
 * result; this function deliberately does not promote ESSP intervals itself.
 */
export function evaluateGeometryTrajectoryConsequence(
  beforeProject: ShowProject,
  afterProject: ShowProject,
  options: AnalyzeFullShowOptions = {},
): GeometryTrajectoryConsequenceReport {
  const before = snapshot(analyzeFullShow(beforeProject, options));
  const after = snapshot(analyzeFullShow(afterProject, options));
  const candidateGeometryExercisedByPlanner = after.plannerSeconds > 1e-9 || after.effectiveAuthorityKind === "PLANNER_ONLY";
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
    note:
      "CANONICAL PIPELINE COMPARISON ONLY. The AFTER project was replanned and validated using the existing full-show authorities. A passing result is not a certification or authorisation to fly.",
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
