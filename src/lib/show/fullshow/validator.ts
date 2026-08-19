/**
 * FULL SHOW VALIDATOR — global validation of the composed show.
 *
 * Composition, conflict detection, safety validation, continuity, timeline and
 * lighting checks are aggregated into ONE report with an explicit status.
 *
 * Honesty contract: PASS means "no violation of the configured simulation and
 * safety profile was detected in the composed trajectories". It says nothing
 * about wind, battery endurance, GNSS quality, radio link, geofence approval or
 * airspace clearance, and it is never an authorisation to fly.
 */
import { detectConflicts, type ConflictReport } from "../conflicts";
import { validatePreShow, type PreShowValidationReport } from "../preshow/validate";
import { validateTrajectorySet, type SafetyReport } from "../safety";
import type { ShowProject } from "../types";
import { composeFullShow, describeSegment, segmentAt } from "./composer";
import { segmentBoundaries, validateContinuity } from "./continuity";
import { validateLightProgram } from "./lighting";
import {
  droneMetrics,
  phaseMetrics,
  transitionAggregate,
  transitionReports,
} from "./metrics";
import { validateHomePads, validateTimelineStructure } from "./timeline";
import {
  FULL_SHOW_ENGINE_VERSION,
  FULL_SHOW_STAGE_LABELS,
  FullShowError,
  type AnalyzeFullShowOptions,
  type ContextualConflict,
  type ExportReadiness,
  type FullShowIssue,
  type FullShowMetrics,
  type FullShowPlan,
  type FullShowStage,
  type FullShowStageTiming,
  type FullShowStatus,
  type FullShowValidationReport,
} from "./types";

const STAGES: FullShowStage[] = [
  "preparing",
  "planningTransitions",
  "composingShow",
  "checkingConflicts",
  "validating",
  "buildingReport",
];

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const HONEST_PASS_STATEMENT =
  "Validated against the configured simulation and safety profile. This is NOT a certification of flight safety and NOT an authorisation to fly: wind, battery, GNSS, radio link, geofence and airspace clearance are out of scope.";

export const HONEST_FAIL_STATEMENT =
  "The composed show violates the configured simulation and safety profile. Resolve every blocking issue before exporting or attempting any flight.";

function normalizeSeparation(value: number): number {
  return Number.isFinite(value) ? value : Infinity;
}

/** Runs the whole pipeline and returns the composed plan plus its report. */
export function analyzeFullShow(
  project: ShowProject,
  options: AnalyzeFullShowOptions = {},
): { plan: FullShowPlan; report: FullShowValidationReport } {
  const started = nowMs();
  const stages: FullShowStageTiming[] = [];
  let stageStart = started;
  let stageIndex = 0;

  const advance = (stage: FullShowStage) => {
    if (stageIndex > 0) {
      stages.push({ stage: STAGES[stageIndex - 1]!, ms: nowMs() - stageStart });
    }
    stageStart = nowMs();
    stageIndex++;
    options.onProgress?.({
      stage,
      label: FULL_SHOW_STAGE_LABELS[stage],
      step: stageIndex,
      totalSteps: STAGES.length,
    });
    if (options.isCancelled?.()) {
      throw new FullShowError("ANALYSIS_CANCELLED", "Full-show analysis was cancelled.");
    }
  };

  advance("preparing");
  const timeline = validateTimelineStructure(project);

  advance("planningTransitions");
  advance("composingShow");
  const plan = composeFullShow(project, options);
  // Authoritative homes come from the composed plan (launch-grid pads under
  // PRE_SHOW), never from a second, independent home resolution.
  const homePads = validateHomePads(project, plan.drones);

  advance("checkingConflicts");
  const conflicts: ConflictReport = detectConflicts(plan.trajectorySet, {
    minSeparation: project.limits.minSeparation,
  });

  advance("validating");
  const safety: SafetyReport = validateTrajectorySet(plan.trajectorySet, {
    limits: project.limits,
    area: project.area,
    drones: plan.drones,
  });
  const continuity = validateContinuity(plan.trajectorySet, {
    limits: project.limits,
    drones: plan.drones,
    boundaries: segmentBoundaries(plan),
  });
  const lighting = validateLightProgram(project, plan);

  advance("buildingReport");
  const contextualConflicts: ContextualConflict[] = conflicts.conflicts.map((c) => {
    const seg = segmentAt(plan, c.timeOfClosestApproach);
    return {
      ...c,
      clipId: seg?.clipId ?? null,
      phase: seg?.phase ?? null,
      context: describeSegment(seg),
    };
  });

  const phaseReports = phaseMetrics(plan, conflicts, project.area);
  const transitions = transitionReports(plan, conflicts);
  const aggregate = transitionAggregate(transitions);
  const droneReports = droneMetrics(plan, conflicts);

  const takeoffPhase = phaseReports.find((p) => p.phase === "TAKEOFF");
  const landingPhase = phaseReports.find((p) => p.phase === "LANDING");
  const totalDistance = droneReports.reduce((s, d) => s + d.totalDistance, 0);

  const errors: FullShowIssue[] = [];
  const warnings: FullShowIssue[] = [];
  let n = 0;
  const add = (issue: Omit<FullShowIssue, "id">) => {
    const full: FullShowIssue = { ...issue, id: `fs-${++n}` };
    (full.severity === "error" ? errors : warnings).push(full);
  };

  for (const issue of [...timeline.issues, ...homePads.issues, ...lighting.issues]) {
    (issue.severity === "error" ? errors : warnings).push(issue);
  }

  for (const err of plan.errors) {
    add({
      severity: "error",
      category: "transition",
      code: err.code,
      message: err.message,
      ...(typeof err.details["clipId"] === "string" ? { clipId: err.details["clipId"] } : {}),
    });
  }

  for (const issue of continuity.issues.slice(0, 100)) {
    add({
      severity: issue.type === "WRONG_HOME_PAD" ? "warning" : "error",
      category: "continuity",
      code: issue.type,
      message:
        issue.type === "POSITION_DISCONTINUITY"
          ? `${issue.droneId} jumps ${issue.magnitude.toFixed(2)} m between consecutive samples at ${issue.time.toFixed(2)}s (tolerance ${issue.tolerance.toFixed(2)} m).`
          : issue.type === "NOT_LANDED"
            ? `${issue.droneId} is still airborne at ${issue.magnitude.toFixed(2)} m when the show ends.`
            : issue.type === "WRONG_HOME_PAD"
              ? `${issue.droneId} lands ${issue.magnitude.toFixed(2)} m away from its own pad.`
              : `${issue.droneId}: ${issue.type.toLowerCase().replace(/_/g, " ")} at ${issue.time.toFixed(2)}s.`,
      time: issue.time,
      droneIds: [issue.droneId],
      droneIndices: [issue.droneIndex],
      value: issue.magnitude,
      limit: issue.tolerance,
    });
  }

  // SPLICE BOUNDARIES. Where the imported authority hands over to the planner
  // (or back), both must agree on position AND velocity: otherwise the show
  // teleports or snaps speed at that instant, which blocks export.
  for (const boundary of plan.splice?.boundaries ?? []) {
    if (boundary.ok) continue;
    add({
      severity: "error",
      category: "continuity",
      code: "SPLICE_DISCONTINUITY",
      message: `Imported/planned handover at ${boundary.time.toFixed(2)}s disagrees by ${boundary.maxPositionDeltaMeters.toFixed(2)} m and ${boundary.maxVelocityDeltaMps.toFixed(2)} m/s (tolerances ${plan.splice!.positionToleranceMeters.toFixed(2)} m / ${plan.splice!.velocityToleranceMps.toFixed(2)} m/s) between clips "${boundary.leftClipId}" and "${boundary.rightClipId}".`,
      time: boundary.time,
      clipId: boundary.rightClipId,
      value: boundary.maxPositionDeltaMeters,
      limit: plan.splice!.positionToleranceMeters,
      ...(boundary.worstPositionDroneIndex >= 0
        ? { droneIndices: [boundary.worstPositionDroneIndex] }
        : {}),
    });
  }

  for (const issue of safety.issues.slice(0, 200)) {
    const seg = segmentAt(plan, issue.time);
    add({
      severity: issue.severity === "critical" ? "error" : "warning",
      category: "safety",
      code: issue.category.toUpperCase(),
      message: `${issue.message} (${describeSegment(seg)})`,
      time: issue.time,
      droneIds: issue.droneIds,
      droneIndices: issue.drones,
      value: issue.value,
      limit: issue.limit,
      ...(seg ? { clipId: seg.clipId, phase: seg.phase } : {}),
    });
  }

  for (const c of contextualConflicts.slice(0, 200)) {
    add({
      severity: c.severity === "critical" ? "error" : "warning",
      category: "conflict",
      code: "PROXIMITY",
      message: `${c.droneA} and ${c.droneB} come within ${c.minDistance.toFixed(2)} m (required ${c.requiredDistance.toFixed(2)} m) at ${c.timeOfClosestApproach.toFixed(2)}s during ${c.context}.`,
      time: c.timeOfClosestApproach,
      droneIds: [c.droneA, c.droneB],
      droneIndices: [c.indexA, c.indexB],
      value: c.minDistance,
      limit: c.requiredDistance,
      ...(c.clipId ? { clipId: c.clipId } : {}),
      ...(c.phase ? { phase: c.phase } : {}),
    });
  }

  // PRE-SHOW section: the launch grid, staging formation and grouped takeoff
  // are validated against the SAME composed set and conflict report.
  const preShowReport: PreShowValidationReport | null = plan.preShow
    ? validatePreShow({ project, plan: plan.preShow, set: plan.trajectorySet, conflicts })
    : null;
  if (preShowReport) {
    for (const issue of preShowReport.issues) {
      add({
        severity: issue.severity,
        category: "preShow",
        code: issue.code,
        message: `PRE-SHOW: ${issue.message}`,
        ...(issue.time !== undefined ? { time: issue.time } : {}),
        ...(issue.droneIds ? { droneIds: issue.droneIds } : {}),
        ...(issue.droneIndices ? { droneIndices: issue.droneIndices } : {}),
        ...(issue.value !== undefined ? { value: issue.value } : {}),
        ...(issue.limit !== undefined ? { limit: issue.limit } : {}),
        phase: "PRE_SHOW",
      });
    }
  }

  const unresolvedTransitions = transitions.filter(
    (t) => t.status === "unresolved" || (t.conflictCount > 0 && t.phase === "SHOW"),
  );
  for (const t of unresolvedTransitions) {
    add({
      severity: "warning",
      category: "transition",
      code: "UNRESOLVED_TRANSITION",
      message: `Transition "${t.clipId}" still has ${t.conflictCount} unresolved proximity conflict(s).`,
      clipId: t.clipId,
      time: t.start,
      value: t.conflictCount,
    });
  }

  const notAnalyzed = transitions.filter((t) => t.phase === "SHOW" && t.status === "notAnalyzed");
  if (notAnalyzed.length > 0) {
    add({
      severity: "info",
      category: "transition",
      code: "NOT_INDIVIDUALLY_ANALYZED",
      message: `${notAnalyzed.length} SHOW transition(s) were never individually analysed or optimised; only the global validation covers them.`,
    });
  }

  const info = warnings.filter((w) => w.severity === "info");
  const realWarnings = warnings.filter((w) => w.severity === "warning");

  const status: FullShowStatus =
    errors.length > 0 ? "FAIL" : realWarnings.length > 0 ? "PASS_WITH_WARNINGS" : "PASS";

  const blockers = errors.slice(0, 20).map((e) => e.message);
  const exportReadiness: ExportReadiness = {
    status: errors.length > 0 ? "BLOCKED" : realWarnings.length > 0 ? "READY_WITH_WARNINGS" : "READY",
    blockers,
    warnings: realWarnings.slice(0, 20).map((w) => w.message),
  };

  const runtimeMs = nowMs() - started;
  stages.push({ stage: STAGES[stageIndex - 1]!, ms: nowMs() - stageStart });

  const metrics: FullShowMetrics = {
    droneCount: plan.droneCount,
    showDuration: plan.duration,
    sampleRate: plan.sampleRate,
    totalDistanceFlown: totalDistance,
    averageDistancePerDrone: plan.droneCount > 0 ? totalDistance / plan.droneCount : 0,
    maxDistanceBySingleDrone: droneReports.reduce((m, d) => Math.max(m, d.totalDistance), 0),
    minimumDynamicSeparation: normalizeSeparation(conflicts.metrics.minimumSeparation),
    maximumVelocity: safety.metrics.maxVelocity,
    maximumAcceleration: safety.metrics.maxAcceleration,
    maximumJerk: safety.metrics.maxJerk,
    maximumYawRate: safety.metrics.maxYawRate,
    totalConflictCount: conflicts.conflictCount,
    uniqueConflictPairs: conflicts.metrics.uniqueConflictPairs,
    unresolvedTransitionCount: unresolvedTransitions.length,
    takeoffMinSeparation: takeoffPhase ? takeoffPhase.minSeparation : Infinity,
    landingMinSeparation: landingPhase ? landingPhase.minSeparation : Infinity,
    validationRuntimeMs: runtimeMs,
    trajectoryMemoryEstimateBytes: plan.metadata.trajectoryMemoryEstimateBytes,
  };

  const report: FullShowValidationReport = {
    status,
    statement: status === "FAIL" ? HONEST_FAIL_STATEMENT : HONEST_PASS_STATEMENT,
    projectId: project.id,
    analysisRevision: plan.metadata.analysisRevision,
    showPackageId: plan.metadata.showPackageId,
    showDuration: plan.duration,
    droneCount: plan.droneCount,
    sampleRate: plan.sampleRate,
    transitionCount: transitions.length,
    analyzedTransitions: transitions.filter((t) => t.status !== "notAnalyzed").length,
    optimizedTransitions: transitions.filter((t) => t.status === "optimized").length,
    unresolvedTransitions: unresolvedTransitions.length,
    conflicts,
    contextualConflicts,
    safety,
    continuity,
    effectiveAuthority: plan.effectiveAuthority,
    splice: plan.splice,
    timeline,
    homePads,
    lighting,
    preShow: preShowReport,
    phaseReports,
    transitionReports: transitions,
    transitionAggregate: aggregate,
    droneReports,
    metrics,
    exportReadiness,
    warnings: realWarnings,
    errors,
    issues: [...errors, ...realWarnings, ...info].sort(
      (a, b) => (a.time ?? Number.POSITIVE_INFINITY) - (b.time ?? Number.POSITIVE_INFINITY),
    ),
    stages,
    algorithmVersions: plan.algorithmVersions,
    engineVersion: FULL_SHOW_ENGINE_VERSION,
  };

  return { plan, report };
}

/** Human-readable one-line summary used in the UI header. */
export function summarizeReport(report: FullShowValidationReport): string {
  const sep = Number.isFinite(report.metrics.minimumDynamicSeparation)
    ? `${report.metrics.minimumDynamicSeparation.toFixed(2)} m min separation`
    : "no pairs in range";
  return `${report.status} · ${report.errors.length} errors · ${report.warnings.length} warnings · ${sep}`;
}
