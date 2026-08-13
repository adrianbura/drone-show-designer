/**
 * PRE-SHOW COMPOSER — launch layout + groups + staging assignment -> canonical
 * per-drone schedules.
 *
 * Output is the SAME continuous schedule structure the artistic show uses
 * (trajectory/schedule.ts), so the pre-show trajectory that is validated is the
 * one that is played and exported. No animation-only approximation exists.
 *
 * Per drone, in show time (pre-show ends exactly at t = 0):
 *   GROUND_WAIT      hold on the pad                (skipped for group 1)
 *   INITIAL_ASCENT   pad -> pad + initialClearance  (vertical only)
 *   STAGING_TRANSIT  clearance point -> staging target
 *   FORM_UP          hold at staging until the whole fleet has arrived
 *   STAGING_HOLD     hold at staging for the configured hold
 */
import { applyAssignment, getAssignmentStrategy, ASSIGNMENT_ALGORITHM_VERSION } from "../assignment";
import type { DroneDefinition } from "../drones";
import { minJerkPlanner, planHold } from "../trajectory/planner";
import type { DroneSchedule, ScheduleSegment } from "../trajectory/schedule";
import type { Formation, SafetyLimits, Vector3Tuple } from "../types";
import { buildLaunchGroups, verifyGroupMembership } from "./groups";
import { buildLaunchLayout, padPositions } from "./launchGrid";
import { buildStagingLayout } from "./staging";
import {
  PRE_SHOW_ENGINE_VERSION,
  PreShowError,
  type PreShowConfig,
  type PreShowPhaseWindow,
  type PreShowPlan,
  type PreShowSegmentInfo,
} from "./types";

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export interface ComposePreShowInput {
  readonly droneCount: number;
  readonly config: PreShowConfig;
  readonly limits: SafetyLimits;
  /** Formation referenced by a `formation`-kind staging configuration. */
  readonly stagingFormation?: Formation;
}

export interface ComposedPreShow {
  readonly plan: PreShowPlan;
  /** Continuous schedules in SHOW time, spanning [-plan.duration, 0]. */
  readonly schedules: DroneSchedule[];
  readonly drones: DroneDefinition[];
}

/** Pads become the physical home positions of the fleet. */
export function launchHomePositions(input: ComposePreShowInput): Vector3Tuple[] {
  return padPositions(buildLaunchLayout(input.droneCount, input.config.launch));
}

export function composePreShow(
  input: ComposePreShowInput,
  drones: readonly DroneDefinition[],
): ComposedPreShow {
  const t0 = nowMs();
  const { config, droneCount } = input;
  const errors: PreShowError[] = [];

  const layout = buildLaunchLayout(droneCount, config.launch);
  const staging = buildStagingLayout(droneCount, config.staging, layout, input.stagingFormation);
  const groups = buildLaunchGroups(layout, config.grouping);
  verifyGroupMembership(groups, droneCount);

  // Launch -> staging matching always goes through the AssignmentEngine.
  const strategy = getAssignmentStrategy(config.assignmentStrategy);
  const sources = padPositions(layout);
  const assignments = strategy.assign({ source: sources, target: staging.targets, drones });
  const targetByDrone = applyAssignment(assignments, staging.targets);

  const ascent = Math.max(0.01, config.ascentDuration);
  const transit = Math.max(0.01, config.transitDuration);
  const hold = Math.max(0, config.stagingHold);
  const clearance = Math.max(0, config.initialClearance);

  const groupIdByDrone: string[] = new Array(droneCount).fill(groups[0]?.id ?? "GROUP-001");
  const startByDrone: number[] = new Array(droneCount).fill(0);
  for (const g of groups) {
    for (const i of g.droneIndices) {
      groupIdByDrone[i] = g.id;
      startByDrone[i] = g.startTime;
    }
  }

  const firstLiftoff = groups.reduce((m, g) => Math.min(m, g.startTime), Infinity);
  const lastLiftoff = groups.reduce((m, g) => Math.max(m, g.startTime), 0);
  const allAtStaging = lastLiftoff + ascent + transit;
  const showReady = allAtStaging + hold;
  const duration = showReady;
  // Show time zero sits at the end of the pre-show: showTime = operational - D.
  const offset = -duration;

  const schedules: DroneSchedule[] = drones.map((d) => ({
    droneId: d.id,
    index: d.index,
    segments: [] as ScheduleSegment[],
  }));
  const segments: PreShowSegmentInfo[] = [];

  drones.forEach((drone) => {
    const i = drone.index;
    const pad = sources[i] ?? [0, 0, 0];
    const target = targetByDrone[i] ?? pad;
    const clearancePoint: Vector3Tuple = [pad[0], pad[1] + clearance, pad[2]];
    const groupId = groupIdByDrone[i]!;
    const launch = startByDrone[i]!;
    const segs = schedules[i]!.segments as ScheduleSegment[];

    const push = (
      phase: PreShowSegmentInfo["phase"],
      startOp: number,
      endOp: number,
      kind: "transition" | "hold",
      planned: ScheduleSegment["planned"],
    ) => {
      if (endOp - startOp <= 1e-9) return;
      segs.push({
        start: offset + startOp,
        end: offset + endOp,
        clipId: `preshow:${groupId}:${phase}`,
        phase: "PRE_SHOW",
        preShowPhase: phase,
        kind,
        planned,
      });
      segments.push({
        droneIndex: i,
        droneId: drone.id,
        groupId,
        phase,
        start: offset + startOp,
        end: offset + endOp,
      });
    };

    // GROUND_WAIT — parked on the pad, all derivatives exactly zero.
    push("GROUND_WAIT", 0, launch, "hold", planHold(pad, Math.max(0, launch)));

    try {
      // INITIAL_ASCENT — vertical only, so no low-altitude lateral mixing.
      const ascentPlan =
        config.transitMode === "direct" || clearance <= 0
          ? planHold(pad, ascent)
          : minJerkPlanner.plan({
              start: pad,
              end: clearancePoint,
              duration: ascent,
              maxVelocity: input.limits.maxVelocity,
              maxAcceleration: input.limits.maxAcceleration,
              maxJerk: input.limits.maxJerk,
              yawPolicy: { kind: "fixed", yaw: 0 },
              easing: "minJerk",
            });
      push("INITIAL_ASCENT", launch, launch + ascent, "transition", ascentPlan);

      // STAGING_TRANSIT — from the clearance altitude to the staging target.
      const transitStart = config.transitMode === "direct" ? pad : clearancePoint;
      const transitPlan = minJerkPlanner.plan({
        start: transitStart,
        end: target,
        duration: transit,
        maxVelocity: input.limits.maxVelocity,
        maxAcceleration: input.limits.maxAcceleration,
        maxJerk: input.limits.maxJerk,
        yawPolicy: { kind: "faceDirectionOfTravel", fallbackYaw: 0 },
        easing: "minJerk",
      });
      push("STAGING_TRANSIT", launch + ascent, launch + ascent + transit, "transition", transitPlan);
    } catch (err) {
      errors.push(
        err instanceof PreShowError
          ? err
          : new PreShowError("INFEASIBLE_DURATION", String(err), { droneId: drone.id }),
      );
      push("STAGING_TRANSIT", launch, launch + ascent + transit, "hold", planHold(pad, ascent + transit));
    }

    // FORM_UP — early groups wait at staging until the whole fleet arrives.
    const arrival = launch + ascent + transit;
    push("FORM_UP", arrival, allAtStaging, "hold", planHold(target, Math.max(0, allAtStaging - arrival)));
    // STAGING_HOLD — the explicit pre-show stabilisation segment.
    push("STAGING_HOLD", allAtStaging, showReady, "hold", planHold(target, hold));
  });

  const phases: PreShowPhaseWindow[] = [
    { phase: "GROUND_WAIT", start: 0, end: Math.max(0, lastLiftoff) },
    { phase: "LIFTOFF", start: firstLiftoff, end: lastLiftoff },
    { phase: "INITIAL_ASCENT", start: firstLiftoff, end: lastLiftoff + ascent },
    { phase: "STAGING_TRANSIT", start: firstLiftoff + ascent, end: allAtStaging },
    { phase: "FORM_UP", start: firstLiftoff + ascent + transit, end: allAtStaging },
    { phase: "STAGING_HOLD", start: allAtStaging, end: showReady },
    { phase: "SHOW_READY", start: showReady, end: showReady },
  ];

  const plan: PreShowPlan = {
    droneCount,
    layout,
    staging,
    groups,
    phases,
    segments,
    duration,
    showStartOperationalTime: duration,
    firstLiftoffTime: Number.isFinite(firstLiftoff) ? firstLiftoff : 0,
    lastLiftoffTime: lastLiftoff,
    allDronesAtStagingTime: allAtStaging,
    showReadyTime: showReady,
    assignments,
    assignmentStrategy: strategy.id,
    targetByDrone,
    groupIdByDrone,
    config,
    algorithmVersions: {
      preShowEngine: PRE_SHOW_ENGINE_VERSION,
      launch: layout.algorithmVersion,
      staging: staging.algorithmVersion,
      assignment: ASSIGNMENT_ALGORITHM_VERSION,
    },
    errors,
    planningMs: nowMs() - t0,
  };

  return { plan, schedules, drones: [...drones] };
}

/** Operational <-> show time mapping (single deterministic relationship). */
export function toShowTime(plan: PreShowPlan, operationalTime: number): number {
  return operationalTime - plan.showStartOperationalTime;
}

export function toOperationalTime(plan: PreShowPlan, showTime: number): number {
  return showTime + plan.showStartOperationalTime;
}
