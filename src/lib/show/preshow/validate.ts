/**
 * PRE-SHOW VALIDATION.
 *
 * Structural checks (pads, staging, groups, bounds, feasibility) plus dynamic
 * checks that reuse the EXISTING ConflictDetector on the canonical pre-show
 * trajectories — there is no separate proximity implementation here.
 *
 * Terminology is deliberately non-operational: PRE-SHOW VALID / WARNING / FAIL.
 * Never "safe to launch", never "flight certified".
 */
import { detectConflicts, type ConflictReport, type TrajectoryConflict } from "../conflicts";
import type { DroneDefinition } from "../drones";
import { buildDroneDefinitions } from "../drones";
import { sampleTrajectorySet, DEFAULT_SAMPLE_RATE } from "../trajectory/sampler";
import type { TrajectorySet } from "../trajectory/types";
import type { ShowProject } from "../types";
import { resolvePreShowConfig } from "./config";
import { composePreShow, launchHomePositions } from "./plan";
import {
  PRE_SHOW_HONESTY_STATEMENT,
  PRE_SHOW_STATUS_LABELS,
  type LaunchGroupMetrics,
  type PreShowConfig,
  type PreShowMetrics,
  type PreShowPlan,
  type PreShowStatus,
} from "./types";

export type PreShowIssueSeverity = "error" | "warning" | "info";
export type PreShowIssueCategory = "launchGrid" | "staging" | "takeoffSchedule" | "preShowConflict";

export interface PreShowIssue {
  readonly id: string;
  readonly severity: PreShowIssueSeverity;
  readonly category: PreShowIssueCategory;
  readonly code: string;
  readonly message: string;
  /** Show time (negative during pre-show), when the issue is time-located. */
  readonly time?: number;
  readonly droneIds?: string[];
  readonly droneIndices?: number[];
  readonly groupId?: string;
  readonly value?: number;
  readonly limit?: number;
}

export interface PreShowValidationReport {
  readonly status: PreShowStatus;
  readonly statusLabel: string;
  readonly statement: string;
  readonly launchGrid: {
    readonly padCount: number;
    readonly rows: number;
    readonly columns: number;
    readonly width: number;
    readonly depth: number;
    readonly minPadSpacing: number;
    readonly duplicateCount: number;
  };
  readonly staging: {
    readonly formationKind: string;
    readonly altitude: number;
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly minStaticSpacing: number;
    readonly outsideAreaCount: number;
  };
  readonly groupCount: number;
  readonly groupMetrics: LaunchGroupMetrics[];
  readonly metrics: PreShowMetrics;
  readonly conflicts: ConflictReport;
  readonly issues: PreShowIssue[];
  readonly errors: PreShowIssue[];
  readonly warnings: PreShowIssue[];
  readonly engineVersion: string;
}

export interface ValidatePreShowInput {
  readonly project: ShowProject;
  readonly plan: PreShowPlan;
  /** Canonical samples covering the pre-show window (t <= 0). */
  readonly set: TrajectorySet;
  /** Conflicts of the analysed set; recomputed on the pre-show window if absent. */
  readonly conflicts?: ConflictReport;
}

const PRE_SHOW_END = 1e-9;

function isPreShowTime(t: number): boolean {
  return t <= PRE_SHOW_END;
}

export function validatePreShow({
  project,
  plan,
  set,
  conflicts,
}: ValidatePreShowInput): PreShowValidationReport {
  const limits = project.limits;
  const issues: PreShowIssue[] = [];
  let n = 0;
  const add = (issue: Omit<PreShowIssue, "id">) => issues.push({ ...issue, id: `ps-${++n}` });

  /* ---------------------------------------------------------- launch grid */
  const layout = plan.layout;
  for (const [a, b] of layout.duplicatePads) {
    add({
      severity: "error",
      category: "launchGrid",
      code: "DUPLICATE_PAD",
      message: `${a} and ${b} occupy the same physical launch position.`,
    });
  }
  if (Number.isFinite(layout.minPadSpacing) && layout.minPadSpacing < limits.minSeparation) {
    add({
      severity: "warning",
      category: "launchGrid",
      code: "PAD_SPACING_BELOW_SEPARATION",
      message: `Minimum STATIC pad spacing is ${layout.minPadSpacing.toFixed(2)} m, below the configured in-flight separation of ${limits.minSeparation.toFixed(2)} m. Static pad spacing is a site-layout metric, not a dynamic separation guarantee.`,
      value: layout.minPadSpacing,
      limit: limits.minSeparation,
    });
  }
  const padsOutside = layout.pads.filter(
    (p) =>
      Math.abs(p.position[0]) > project.area.width / 2 + 0.01 ||
      Math.abs(p.position[2]) > project.area.depth / 2 + 0.01,
  );
  if (padsOutside.length > 0) {
    add({
      severity: "error",
      category: "launchGrid",
      code: "PADS_OUTSIDE_AREA",
      message: `${padsOutside.length} launch pad(s) lie outside the configured show area.`,
      value: padsOutside.length,
    });
  }

  /* -------------------------------------------------------------- staging */
  const staging = plan.staging;
  const stagingOutside = staging.targets.filter(
    (p) =>
      Math.abs(p[0]) > project.area.width / 2 + 0.01 ||
      Math.abs(p[2]) > project.area.depth / 2 + 0.01,
  ).length;
  if (stagingOutside > 0) {
    add({
      severity: "error",
      category: "staging",
      code: "STAGING_OUTSIDE_AREA",
      message: `${stagingOutside} staging position(s) lie outside the configured show area.`,
      value: stagingOutside,
    });
  }
  if (staging.config.altitude > limits.maxAltitude + 0.01) {
    add({
      severity: "error",
      category: "staging",
      code: "STAGING_ABOVE_CEILING",
      message: `Staging altitude ${staging.config.altitude.toFixed(1)} m exceeds the configured ceiling of ${limits.maxAltitude.toFixed(1)} m. The formation is NOT clamped.`,
      value: staging.config.altitude,
      limit: limits.maxAltitude,
    });
  }
  if (staging.config.altitude < limits.minAltitude - 0.01) {
    add({
      severity: "warning",
      category: "staging",
      code: "STAGING_BELOW_MIN_ALTITUDE",
      message: `Staging altitude ${staging.config.altitude.toFixed(1)} m is below the configured minimum airborne altitude of ${limits.minAltitude.toFixed(1)} m.`,
      value: staging.config.altitude,
      limit: limits.minAltitude,
    });
  }
  if (
    Number.isFinite(staging.bounds.minStaticSpacing) &&
    staging.bounds.minStaticSpacing < limits.minSeparation
  ) {
    add({
      severity: "warning",
      category: "staging",
      code: "STAGING_SPACING_TIGHT",
      message: `Staging formation spacing is ${staging.bounds.minStaticSpacing.toFixed(2)} m, below the configured separation of ${limits.minSeparation.toFixed(2)} m.`,
      value: staging.bounds.minStaticSpacing,
      limit: limits.minSeparation,
    });
  }

  /* ---------------------------------------------- trajectory-level checks */
  const report =
    conflicts ??
    detectConflicts(set, { minSeparation: limits.minSeparation });
  const preShowConflicts = report.conflicts.filter((c) => isPreShowTime(c.timeOfClosestApproach));

  let maxVelocity = 0;
  let maxAcceleration = 0;
  let maxJerk = 0;
  let totalDistance = 0;
  let maxIndividual = 0;
  let outOfBounds = 0;
  let nonFinite = 0;
  const perDrone = set.drones.map(() => ({ v: 0, a: 0, j: 0, d: 0 }));

  set.drones.forEach((drone, i) => {
    const acc = perDrone[i]!;
    let previous: readonly [number, number, number] | null = null;
    for (const s of drone.samples) {
      if (!isPreShowTime(s.t)) break;
      const finite =
        s.position.every(Number.isFinite) &&
        s.velocity.every(Number.isFinite) &&
        Number.isFinite(s.yaw);
      if (!finite) {
        nonFinite++;
        continue;
      }
      acc.v = Math.max(acc.v, Math.hypot(...s.velocity));
      acc.a = Math.max(acc.a, Math.hypot(...s.acceleration));
      acc.j = Math.max(acc.j, Math.hypot(...s.jerk));
      if (previous) {
        acc.d += Math.hypot(
          s.position[0] - previous[0],
          s.position[1] - previous[1],
          s.position[2] - previous[2],
        );
      }
      previous = s.position;
      if (
        Math.abs(s.position[0]) > project.area.width / 2 + 0.01 ||
        Math.abs(s.position[2]) > project.area.depth / 2 + 0.01 ||
        s.position[1] > limits.maxAltitude + 0.01 ||
        s.position[1] < -0.01
      ) {
        outOfBounds++;
      }
    }
    maxVelocity = Math.max(maxVelocity, acc.v);
    maxAcceleration = Math.max(maxAcceleration, acc.a);
    maxJerk = Math.max(maxJerk, acc.j);
    totalDistance += acc.d;
    maxIndividual = Math.max(maxIndividual, acc.d);
  });

  if (nonFinite > 0) {
    add({
      severity: "error",
      category: "takeoffSchedule",
      code: "NON_FINITE_SAMPLE",
      message: `${nonFinite} non-finite pre-show trajectory sample(s).`,
      value: nonFinite,
    });
  }
  if (outOfBounds > 0) {
    add({
      severity: "error",
      category: "takeoffSchedule",
      code: "PRE_SHOW_OUT_OF_BOUNDS",
      message: `${outOfBounds} pre-show sample(s) leave the configured simulation bounds (area or altitude ceiling).`,
      value: outOfBounds,
    });
  }
  if (maxVelocity > limits.maxVelocity + 1e-6) {
    add({
      severity: "error",
      category: "takeoffSchedule",
      code: "PRE_SHOW_VELOCITY",
      message: `Pre-show peak velocity ${maxVelocity.toFixed(2)} m/s exceeds the configured limit of ${limits.maxVelocity.toFixed(2)} m/s. Increase the ascent/transit durations.`,
      value: maxVelocity,
      limit: limits.maxVelocity,
    });
  }
  if (maxAcceleration > limits.maxAcceleration + 1e-6) {
    add({
      severity: "warning",
      category: "takeoffSchedule",
      code: "PRE_SHOW_ACCELERATION",
      message: `Pre-show peak acceleration ${maxAcceleration.toFixed(2)} m/s² exceeds the configured limit of ${limits.maxAcceleration.toFixed(2)} m/s².`,
      value: maxAcceleration,
      limit: limits.maxAcceleration,
    });
  }
  if (maxJerk > limits.maxJerk + 1e-6) {
    add({
      severity: "warning",
      category: "takeoffSchedule",
      code: "PRE_SHOW_JERK",
      message: `Pre-show peak jerk ${maxJerk.toFixed(2)} m/s³ exceeds the configured limit of ${limits.maxJerk.toFixed(2)} m/s³.`,
      value: maxJerk,
      limit: limits.maxJerk,
    });
  }
  for (const err of plan.errors) {
    add({
      severity: "error",
      category: "takeoffSchedule",
      code: err.code,
      message: err.message,
    });
  }

  /* -------------------------------------------------------- group metrics */
  const groupOf = new Map<number, string>();
  plan.groups.forEach((g) => g.droneIndices.forEach((i) => groupOf.set(i, g.id)));
  const conflictsByGroup = new Map<string, TrajectoryConflict[]>();
  for (const c of preShowConflicts) {
    for (const id of [groupOf.get(c.indexA), groupOf.get(c.indexB)]) {
      if (!id) continue;
      const list = conflictsByGroup.get(id);
      if (list) list.push(c);
      else conflictsByGroup.set(id, [c]);
    }
  }

  const ascent = Math.max(0.01, plan.config.ascentDuration);
  const transit = Math.max(0.01, plan.config.transitDuration);
  const groupMetrics: LaunchGroupMetrics[] = plan.groups.map((g) => {
    let v = 0;
    let a = 0;
    let j = 0;
    let total = 0;
    let maxOne = 0;
    for (const i of g.droneIndices) {
      const acc = perDrone[i];
      if (!acc) continue;
      v = Math.max(v, acc.v);
      a = Math.max(a, acc.a);
      j = Math.max(j, acc.j);
      total += acc.d;
      maxOne = Math.max(maxOne, acc.d);
    }
    const groupConflicts = conflictsByGroup.get(g.id) ?? [];
    const separation = groupConflicts.reduce((m, c) => Math.min(m, c.minDistance), Infinity);
    return {
      groupId: g.id,
      droneCount: g.droneIndices.length,
      startTime: g.startTime,
      duration: ascent + transit,
      minimumSeparation: Number.isFinite(separation)
        ? separation
        : Number.isFinite(report.metrics.minimumSeparation)
          ? report.metrics.minimumSeparation
          : Infinity,
      maximumVelocity: v,
      maximumAcceleration: a,
      maximumJerk: j,
      totalDistance: total,
      maximumIndividualDistance: maxOne,
      conflictCount: groupConflicts.length,
    };
  });

  const uniquePairs = new Set(
    preShowConflicts.map((c) => `${Math.min(c.indexA, c.indexB)}-${Math.max(c.indexA, c.indexB)}`),
  );
  let minSeparation = Infinity;
  for (const c of preShowConflicts) minSeparation = Math.min(minSeparation, c.minDistance);
  if (!Number.isFinite(minSeparation)) minSeparation = report.metrics.minimumSeparation;

  for (const c of preShowConflicts.slice(0, 200)) {
    add({
      severity: c.severity === "critical" ? "error" : "warning",
      category: "preShowConflict",
      code: "PRE_SHOW_PROXIMITY",
      message: `${c.droneA} and ${c.droneB} come within ${c.minDistance.toFixed(2)} m (required ${c.requiredDistance.toFixed(2)} m) at T = ${c.timeOfClosestApproach.toFixed(2)} s of show time, during pre-show.`,
      time: c.timeOfClosestApproach,
      droneIds: [c.droneA, c.droneB],
      droneIndices: [c.indexA, c.indexB],
      value: c.minDistance,
      limit: c.requiredDistance,
      ...(groupOf.get(c.indexA) ? { groupId: groupOf.get(c.indexA)! } : {}),
    });
  }

  const metrics: PreShowMetrics = {
    droneCount: plan.droneCount,
    groupCount: plan.groups.length,
    preShowDuration: plan.duration,
    firstLiftoffTime: plan.firstLiftoffTime,
    lastLiftoffTime: plan.lastLiftoffTime,
    allDronesAtStagingTime: plan.allDronesAtStagingTime,
    showReadyTime: plan.showReadyTime,
    minimumSeparation: minSeparation,
    maximumVelocity: maxVelocity,
    maximumAcceleration: maxAcceleration,
    maximumJerk: maxJerk,
    totalConflicts: preShowConflicts.length,
    uniqueConflictPairs: uniquePairs.size,
    totalDistance,
    maximumIndividualDistance: maxIndividual,
    minPadSpacing: layout.minPadSpacing,
    planningMs: plan.planningMs,
  };

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const status: PreShowStatus =
    errors.length > 0 ? "FAIL" : warnings.length > 0 ? "WARNING" : "VALID";

  return {
    status,
    statusLabel: PRE_SHOW_STATUS_LABELS[status],
    statement: PRE_SHOW_HONESTY_STATEMENT,
    launchGrid: {
      padCount: layout.pads.length,
      rows: layout.rows,
      columns: layout.columns,
      width: layout.bounds.width,
      depth: layout.bounds.depth,
      minPadSpacing: layout.minPadSpacing,
      duplicateCount: layout.duplicatePads.length,
    },
    staging: {
      formationKind: staging.formationKind,
      altitude: staging.config.altitude,
      width: staging.bounds.width,
      height: staging.bounds.height,
      depth: staging.bounds.depth,
      minStaticSpacing: staging.bounds.minStaticSpacing,
      outsideAreaCount: stagingOutside,
    },
    groupCount: plan.groups.length,
    groupMetrics,
    metrics,
    conflicts: report,
    issues,
    errors,
    warnings,
    engineVersion: plan.algorithmVersions.preShowEngine,
  };
}

export interface AnalyzePreShowOptions {
  readonly config?: PreShowConfig;
  readonly sampleRate?: number;
  readonly drones?: readonly DroneDefinition[];
}

/**
 * Standalone pre-show analysis: compose -> sample -> conflicts -> validate.
 * Used by tests, benchmarks and the "Preview Launch" action. The full-show
 * validator analyses the SAME segments inside the composed operational set.
 */
export function analyzePreShow(
  project: ShowProject,
  options: AnalyzePreShowOptions = {},
): {
  plan: PreShowPlan;
  set: TrajectorySet;
  report: PreShowValidationReport;
} {
  const config = options.config ?? resolvePreShowConfig(project.preShow);
  const stagingFormation =
    config.staging.formationKind === "formation"
      ? project.formations.find((f) => f.id === config.staging.formationId)
      : undefined;
  const drones =
    options.drones ??
    buildDroneDefinitions(
      project,
      // Pads are the physical home positions of the fleet.
      launchHomePositions({ droneCount: project.droneCount, config, limits: project.limits }),
    );
  const composed = composePreShow(
    {
      droneCount: project.droneCount,
      config,
      limits: project.limits,
      ...(stagingFormation ? { stagingFormation } : {}),
    },
    drones,
  );
  const set = sampleTrajectorySet(
    {
      schedules: composed.schedules,
      drones,
      duration: 0,
      startTime: -composed.plan.duration,
      algorithmVersion: composed.plan.algorithmVersions.preShowEngine,
    },
    { sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE, duration: composed.plan.duration },
  );
  const report = validatePreShow({ project, plan: composed.plan, set });
  return { plan: composed.plan, set, report };
}

