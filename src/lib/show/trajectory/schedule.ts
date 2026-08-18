/**
 * Show plan construction: Timeline -> Formation resolution -> Assignment ->
 * Trajectory planning. The result is a per-drone piecewise CONTINUOUS schedule;
 * no fixed-rate sampling happens here (see sampler.ts).
 *
 * Pure: no React, no Three.js, usable from Node tests.
 */
import {
  applyAssignment,
  getAssignmentStrategy,
  type AssignmentStrategyId,
  type DroneAssignment,
} from "../assignment";
import { buildDroneDefinitions, type DroneDefinition } from "../drones";
import { composePreShow, launchHomePositions } from "../preshow/plan";
import { resolvePreShowConfig } from "../preshow/config";
import type { PreShowConfig, PreShowPhaseName, PreShowPlan } from "../preshow/types";
import type { ShowPhase, ShowProject, Vector3Tuple } from "../types";
import { clipPhase, resolveDynamicFormation, showDuration, TRAJECTORY_ALGORITHM_VERSION } from "../types";
import { createDynamicEvaluator } from "../dynamic/sampler";
import { planDynamicPoint } from "../dynamic/plan";
import {
  planFleetParticipation,
  participationTargets,
  resolveParticipationSettings,
  type FleetParticipationPlan,
  type ParticipationScene,
  type ParticipationWarningCode,
} from "../participation";

import { withStartOffset, withVerticalLane } from "./offsets";
import { minJerkPlanner, planHold } from "./planner";
import {
  TrajectoryPlanningError,
  type PlannedTrajectory,
  type TrajectorySample,
  type YawPolicy,
} from "./types";

export interface ScheduleSegment {
  readonly start: number;
  readonly end: number;
  readonly clipId: string;
  readonly phase: ShowPhase;
  readonly kind: "transition" | "hold";
  readonly planned: PlannedTrajectory;
  /** Set only on PRE_SHOW segments (see preshow/plan.ts). */
  readonly preShowPhase?: PreShowPhaseName;
  /** Set on holds that play a dynamic (living) formation. */
  readonly dynamicFormationId?: string;

}

export interface DroneSchedule {
  readonly droneId: string;
  readonly index: number;
  readonly segments: ScheduleSegment[];
}

export interface ClipAssignment {
  readonly clipId: string;
  readonly phase: ShowPhase;
  readonly strategy: string;
  readonly assignments: DroneAssignment[];
}

export interface ShowPlan {
  readonly project: ShowProject;
  readonly drones: DroneDefinition[];
  readonly schedules: DroneSchedule[];
  readonly assignments: ClipAssignment[];
  /** Artistic show duration: show time 0 .. duration. */
  readonly duration: number;
  /**
   * First show time covered by the schedules. 0 without a pre-show, and
   * -preShow.duration when a launch plan is composed (pre-show occupies
   * negative show time and SHOW TIME ZERO is always t = 0).
   */
  readonly startTime: number;
  /** Operational time of SHOW TIME ZERO = pre-show duration (0 when absent). */
  readonly showStartOperationalTime: number;
  readonly preShow: PreShowPlan | null;
  readonly algorithmVersion: string;
  /** Assignment strategy used for SHOW clips without an override. */
  readonly assignmentStrategy: AssignmentStrategyId;
  /** Clip ids whose transition came from an optimiser override. */
  readonly optimizedClipIds: string[];
  /** Structured planning failures. Never thrown away silently. */
  readonly errors: TrajectoryPlanningError[];
  /**
   * PARTIAL FLEET PARTICIPATION. One plan per SHOW clip whose formation uses
   * fewer points than the fleet has drones. Every drone appears in every plan:
   * a partial formation never leaves a drone unplanned.
   */
  readonly participation: FleetParticipationPlan[];
  readonly participationWarnings: SchedulingParticipationWarning[];
}

export interface SchedulingParticipationWarning {
  readonly clipId: string;
  readonly code: ParticipationWarningCode;
  readonly message: string;
}

/**
 * Result of a TransitionOptimizer run, applied to one SHOW clip so the 3D
 * preview and the final SafetyValidator see exactly what was analysed.
 * Arrays are indexed by drone index.
 */
export interface ClipTransitionOverride {
  /** Index into the clip's formation point list, per drone. */
  readonly targetPointIndex: readonly number[];
  /** Bounded start stagger in seconds, per drone. */
  readonly startOffsets: readonly number[];
  /** Bounded signed vertical lane offset in metres, per drone. */
  readonly laneOffsets: readonly number[];
  readonly strategy: string;
}

export interface BuildShowPlanOptions {
  /** Strategy for SHOW clips. TAKEOFF uses `identity`, LANDING `optimalDistance`. */
  readonly assignmentStrategy?: AssignmentStrategyId;
  readonly transitionOverrides?: Readonly<Record<string, ClipTransitionOverride>>;
  /** Overrides `project.preShow`. Pass `null` to plan the show without pre-show. */
  readonly preShow?: PreShowConfig | null;
  /** Overrides `project.participation` (fleet participation settings). */
  readonly participation?: import("../participation").ParticipationSettings;
}

function padPoints(points: readonly Vector3Tuple[], count: number, fallback: Vector3Tuple[]): Vector3Tuple[] {
  if (points.length === 0) return fallback.slice(0, count);
  const out: Vector3Tuple[] = [];
  for (let i = 0; i < count; i++) out.push(points[i % points.length]!);
  return out;
}

/**
 * Deterministic vertical layering of crossing morph paths. Not a collision
 * avoidance mechanism — a collision-aware planner replaces it later.
 */
function arcForDrone(index: number): number {
  return 1 + ((index * 5) % 16) * 1.5;
}

/**
 * Layering must never push a drone through the ceiling: the requested arc is
 * clipped to the headroom available above the higher of the two endpoints.
 */
function clampArc(arc: number, startY: number, endY: number, ceiling: number): number {
  const headroom = ceiling - Math.max(startY, endY) - 1;
  return Math.max(0, Math.min(arc, headroom));
}

export function buildShowPlan(project: ShowProject, options: BuildShowPlanOptions = {}): ShowPlan {
  const preShowConfig =
    options.preShow === null
      ? null
      : options.preShow ?? (project.preShow?.enabled ? resolvePreShowConfig(project.preShow) : null);
  const usePreShow = !!preShowConfig?.enabled;

  // With a launch plan the physical home positions are the LAUNCH PADS, so
  // LANDING also returns every drone to its own pad.
  const padHome = usePreShow
    ? launchHomePositions({
        droneCount: project.droneCount,
        config: preShowConfig!,
        limits: project.limits,
      })
    : null;
  const drones = buildDroneDefinitions(project, padHome ?? undefined);
  const home = drones.map((d) => d.homePosition);
  const clips = [...project.timeline].sort((a, b) => a.start - b.start);
  const errors: TrajectoryPlanningError[] = [];
  const assignments: ClipAssignment[] = [];
  const showStrategy: AssignmentStrategyId = options.assignmentStrategy ?? "nearestNeighbor";
  const participationSettings = resolveParticipationSettings(
    options.participation ?? project.participation,
  );
  const participation: FleetParticipationPlan[] = [];
  const participationWarnings: SchedulingParticipationWarning[] = [];
  const overrides = options.transitionOverrides ?? {};
  const optimizedClipIds: string[] = [];
  const schedules: DroneSchedule[] = drones.map((d) => ({
    droneId: d.id,
    index: d.index,
    segments: [],
  }));

  // PRE-SHOW: launch grid -> grouped takeoff -> staging, in negative show time.
  let preShow: PreShowPlan | null = null;
  if (usePreShow) {
    const stagingFormation =
      preShowConfig!.staging.formationKind === "formation"
        ? project.formations.find((f) => f.id === preShowConfig!.staging.formationId)
        : undefined;
    const composed = composePreShow(
      {
        droneCount: project.droneCount,
        config: preShowConfig!,
        limits: project.limits,
        ...(stagingFormation ? { stagingFormation } : {}),
      },
      drones,
    );
    preShow = composed.plan;
    composed.schedules.forEach((s, i) => {
      schedules[i]!.segments.push(...s.segments);
    });
  }

  // The artistic timeline starts from the staging formation when a pre-show
  // exists, otherwise from the home pads.
  let current: Vector3Tuple[] = usePreShow && preShow ? preShow.targetByDrone.slice() : home.slice();

  // Bounded look-ahead scene list for the participation planner. Only artistic
  // SHOW clips with resolvable geometry can absorb pre-positioning drones.
  const sceneFor = (clip: (typeof clips)[number]): ParticipationScene | null => {
    if (clipPhase(clip) !== "SHOW") return null;
    const dynamic = resolveDynamicFormation(project, clip);
    if (dynamic) {
      const evaluator = createDynamicEvaluator(dynamic, {
        playbackRate: clip.playbackRate ?? 1,
        startOffset: clip.dynamicStartOffset ?? 0,
      });
      return {
        clipId: clip.id,
        formationId: clip.formationId,
        dynamicFormationId: dynamic.id,
        points: evaluator.positionsAt(0),
        pointIds: dynamic.points.map((p) => p.id),
      };
    }
    const formation = project.formations.find((f) => f.id === clip.formationId);
    if (!formation || formation.points.length === 0) return null;
    return { clipId: clip.id, formationId: formation.id, points: formation.points };
  };

  let previousParticipation: FleetParticipationPlan | null = null;

  for (const [clipIndex, clip] of clips.entries()) {
    const phase = clipPhase(clip);
    const formation = project.formations.find((f) => f.id === clip.formationId);
    if (!formation && phase !== "LANDING") {
      errors.push(
        new TrajectoryPlanningError(
          "INVALID_FORMATION",
          `Clip ${clip.id} references a missing formation`,
          { clipId: clip.id, phase },
        ),
      );
    }
    // A dynamic clip animates during its HOLD. The transition still morphs to
    // the animation state the hold starts at, so continuity is exact.
    const dynamicFormation = phase === "LANDING" ? undefined : resolveDynamicFormation(project, clip);
    const dynamicEvaluator = dynamicFormation
      ? createDynamicEvaluator(dynamicFormation, {
          playbackRate: clip.playbackRate ?? 1,
          startOffset: clip.dynamicStartOffset ?? 0,
        })
      : null;
    const scenePoints: readonly Vector3Tuple[] =
      phase === "LANDING"
        ? home
        : dynamicEvaluator
          ? dynamicEvaluator.positionsAt(0)
          : (formation?.points ?? []);

    /**
     * PARTIAL FLEET PARTICIPATION. When a formation supplies FEWER points than
     * the fleet has drones, the participation planner decides which drones fly
     * the image and gives every remaining drone an explicit role and target.
     * Full-fleet formations keep the historical assignment path unchanged.
     */
    const partial =
      phase === "SHOW" && scenePoints.length > 0 && scenePoints.length < project.droneCount;
    let participationPlan: FleetParticipationPlan | null = null;
    if (partial) {
      const lookAhead: ParticipationScene[] = [];
      for (let k = clipIndex + 1; k < clips.length && lookAhead.length < participationSettings.lookAheadScenes; k++) {
        const scene = sceneFor(clips[k]!);
        if (scene) lookAhead.push(scene);
      }
      try {
        participationPlan = planFleetParticipation({
          drones,
          current,
          scene: {
            clipId: clip.id,
            formationId: formation?.id ?? null,
            ...(dynamicFormation ? { dynamicFormationId: dynamicFormation.id } : {}),
            points: scenePoints,
            ...(dynamicFormation ? { pointIds: dynamicFormation.points.map((p) => p.id) } : {}),
          },
          lookAhead,
          settings: participationSettings,
          limits: project.limits,
          area: project.area,
          previous: previousParticipation,
        });
      } catch (err) {
        // A rejected MANUAL selection must never silently drop drones: the
        // deterministic SMART_PREPARE default takes over and says so.
        participationPlan = planFleetParticipation({
          drones,
          current,
          scene: {
            clipId: clip.id,
            formationId: formation?.id ?? null,
            ...(dynamicFormation ? { dynamicFormationId: dynamicFormation.id } : {}),
            points: scenePoints,
            ...(dynamicFormation ? { pointIds: dynamicFormation.points.map((p) => p.id) } : {}),
          },
          lookAhead,
          settings: { ...participationSettings, defaultPolicy: "SMART_PREPARE", clips: {} },
          limits: project.limits,
          area: project.area,
          previous: previousParticipation,
        });
        participationWarnings.push({
          clipId: clip.id,
          code: "MANUAL_FALLBACK",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      participation.push(participationPlan);
      previousParticipation = participationPlan;
    }

    const rawTarget = participationPlan
      ? participationTargets(participationPlan)
      : padPoints(scenePoints, project.droneCount, home);

    // An optimiser override replaces both the assignment and the deconfliction
    // decorators for this clip; otherwise the configured strategy runs.
    const override =
      phase === "SHOW" && overrides[clip.id]?.targetPointIndex.length === drones.length
        ? overrides[clip.id]!
        : undefined;
    let clipAssignments: DroneAssignment[];
    let strategyId: string;
    if (participationPlan && !override) {
      // The participation planner already solved drone -> target; the scheduler
      // must not reshuffle it, so the mapping is applied as-is.
      clipAssignments = drones.map((d, i) => ({
        droneId: d.id,
        sourcePointIndex: i,
        targetPointIndex: i,
      }));
      strategyId = "fleetParticipation";
    } else if (override) {
      const points = formation?.points ?? [];
      clipAssignments = drones.map((d, i) => ({
        droneId: d.id,
        sourcePointIndex: i,
        targetPointIndex: Math.min(
          Math.max(0, override.targetPointIndex[i] ?? i),
          Math.max(0, (points.length || rawTarget.length) - 1),
        ),
      }));
      strategyId = override.strategy;
      optimizedClipIds.push(clip.id);
    } else {
      // LANDING: pads are interchangeable, so the globally optimal (minimum
      // total distance) pad assignment is used. On straight-line descents this
      // removes the path crossings that an index-identity mapping produces.
      const strategy = getAssignmentStrategy(phase === "LANDING" ? "optimalDistance" : showStrategy);
      clipAssignments = strategy.assign({ source: current, target: rawTarget, drones });
      strategyId = strategy.id;
    }
    assignments.push({ clipId: clip.id, phase, strategy: strategyId, assignments: clipAssignments });
    const target = applyAssignment(clipAssignments, rawTarget);


    const transition = Math.max(0.01, clip.transition);
    for (const drone of drones) {
      const i = drone.index;
      const from = current[i] ?? drone.homePosition;
      const to = target[i] ?? drone.homePosition;
      const yawPolicy: YawPolicy =
        phase === "SHOW" ? { kind: "faceDirectionOfTravel", fallbackYaw: 0 } : { kind: "fixed", yaw: 0 };
      const startOffset = override
        ? Math.max(0, Math.min(override.startOffsets[i] ?? 0, transition * 0.5))
        : 0;
      let planned: PlannedTrajectory;
      try {
        planned = minJerkPlanner.plan({
          start: from,
          end: to,
          duration: Math.max(0.01, transition - startOffset),
          maxVelocity: project.limits.maxVelocity,
          maxAcceleration: project.limits.maxAcceleration,
          maxJerk: project.limits.maxJerk,
          yawPolicy,
          easing: clip.easing,
          // Optimised clips use explicit lane offsets instead of the legacy
          // index-derived layering arc.
          verticalArc:
            phase === "SHOW" && !override
              ? clampArc(arcForDrone(i), from[1], to[1], project.limits.maxAltitude)
              : 0,
        });
        if (override) {
          planned = withStartOffset(
            withVerticalLane(planned, override.laneOffsets[i] ?? 0),
            startOffset,
            from,
            transition,
          );
        }
      } catch (err) {
        const planningError =
          err instanceof TrajectoryPlanningError
            ? err
            : new TrajectoryPlanningError("INVALID_POSITION", String(err), {
                droneId: drone.id,
                phase,
                clipId: clip.id,
              });
        errors.push(planningError);
        planned = planHold(from, transition);
      }
      const segs = schedules[i]!.segments;
      segs.push({
        start: clip.start,
        end: clip.start + transition,
        clipId: clip.id,
        phase,
        kind: "transition",
        planned,
      });
      if (clip.hold > 0) {
        // With partial participation the animated point index comes from the
        // participation plan; a non-participating drone holds its reserve or
        // pre-position target instead of animating the living formation.
        const participationEntry = participationPlan?.drones[i];
        const pointIndex = participationPlan
          ? (participationEntry?.formationPointIndex ?? -1)
          : (clipAssignments[i]?.targetPointIndex ?? i);
        segs.push({
          start: clip.start + transition,
          end: clip.start + transition + clip.hold,
          clipId: clip.id,
          phase,
          kind: "hold",
          planned:
            dynamicEvaluator && dynamicFormation && pointIndex >= 0
              ? planDynamicPoint(dynamicEvaluator, pointIndex % dynamicFormation.points.length, clip.hold, {
                  faceDirectionOfTravel: phase === "SHOW",
                })
              : planHold(to, clip.hold),
          ...(dynamicFormation ? { dynamicFormationId: dynamicFormation.id } : {}),
        });
      }

    }
    // After a dynamic hold the swarm sits wherever the animation ended, so the
    // NEXT clip's assignment starts from the true end state.
    if (dynamicEvaluator && dynamicFormation && clip.hold > 0) {
      const end = dynamicEvaluator.positionsAt(clip.hold);
      current = drones.map((d, i) => {
        const active = participationPlan
          ? (participationPlan.drones[i]?.formationPointIndex ?? -1)
          : (clipAssignments[i]?.targetPointIndex ?? i);
        // Non-participating drones stay where the participation plan put them.
        if (active < 0) return target[i] ?? d.homePosition;
        return end[active % dynamicFormation.points.length] ?? target[i] ?? d.homePosition;
      });
    } else {
      current = target;
    }

  }

  return {
    project,
    drones,
    schedules,
    assignments,
    duration: showDuration(project),
    startTime: preShow ? -preShow.duration : 0,
    showStartOperationalTime: preShow ? preShow.showStartOperationalTime : 0,
    preShow,
    algorithmVersion: TRAJECTORY_ALGORITHM_VERSION,
    assignmentStrategy: showStrategy,
    optimizedClipIds,
    errors,
    participation,
    participationWarnings,
  };
}

const STATIC = (t: number, position: Vector3Tuple): TrajectorySample => ({
  t,
  position,
  velocity: [0, 0, 0],
  acceleration: [0, 0, 0],
  jerk: [0, 0, 0],
  yaw: 0,
  yawRate: 0,
});

/** Samples one drone's schedule at absolute show time t. */
export function sampleScheduleAt(
  schedule: DroneSchedule,
  home: Vector3Tuple,
  t: number,
): TrajectorySample {
  const segments = schedule.segments;
  if (segments.length === 0) return STATIC(t, home);
  const first = segments[0]!;
  if (t <= first.start) return { ...STATIC(t, first.planned.sample(0).position) };
  for (const seg of segments) {
    if (t <= seg.end) {
      const local = seg.planned.sample(t - seg.start);
      return { ...local, t };
    }
  }
  const last = segments[segments.length - 1]!;
  return { ...STATIC(t, last.planned.sample(last.planned.duration).position) };
}

/** Positions of every drone at absolute show time t — O(drones). */
export function positionsAt(plan: ShowPlan, t: number): Vector3Tuple[] {
  return plan.schedules.map((s, i) =>
    sampleScheduleAt(s, plan.drones[i]?.homePosition ?? [0, 0, 0], t).position,
  );
}

/** Full sample of every drone at absolute show time t. */
export function samplesAt(plan: ShowPlan, t: number): TrajectorySample[] {
  return plan.schedules.map((s, i) =>
    sampleScheduleAt(s, plan.drones[i]?.homePosition ?? [0, 0, 0], t),
  );
}
