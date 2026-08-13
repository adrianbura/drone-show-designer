/**
 * Show plan construction: Timeline -> Formation resolution -> Assignment ->
 * Trajectory planning. The result is a per-drone piecewise CONTINUOUS schedule;
 * no fixed-rate sampling happens here (see sampler.ts).
 *
 * Pure: no React, no Three.js, usable from Node tests.
 */
import { applyAssignment, getAssignmentStrategy, type DroneAssignment } from "../assignment";
import { buildDroneDefinitions, type DroneDefinition } from "../drones";
import type { ShowPhase, ShowProject, Vector3Tuple } from "../types";
import { clipPhase, showDuration, TRAJECTORY_ALGORITHM_VERSION } from "../types";
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
  readonly duration: number;
  readonly algorithmVersion: string;
  /** Structured planning failures. Never thrown away silently. */
  readonly errors: TrajectoryPlanningError[];
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

export function buildShowPlan(project: ShowProject): ShowPlan {
  const drones = buildDroneDefinitions(project);
  const home = drones.map((d) => d.homePosition);
  const clips = [...project.timeline].sort((a, b) => a.start - b.start);
  const errors: TrajectoryPlanningError[] = [];
  const assignments: ClipAssignment[] = [];
  const schedules: DroneSchedule[] = drones.map((d) => ({
    droneId: d.id,
    index: d.index,
    segments: [],
  }));

  let current: Vector3Tuple[] = home.slice();

  for (const clip of clips) {
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
    const rawTarget =
      phase === "LANDING" ? home : padPoints(formation?.points ?? [], project.droneCount, home);
    const strategy = getAssignmentStrategy(phase === "LANDING" ? "identity" : "nearestNeighbor");
    const clipAssignments = strategy.assign({ source: current, target: rawTarget, drones });
    assignments.push({ clipId: clip.id, phase, strategy: strategy.id, assignments: clipAssignments });
    const target = applyAssignment(clipAssignments, rawTarget);

    const transition = Math.max(0.01, clip.transition);
    for (const drone of drones) {
      const i = drone.index;
      const from = current[i] ?? drone.homePosition;
      const to = target[i] ?? drone.homePosition;
      const yawPolicy: YawPolicy =
        phase === "SHOW" ? { kind: "faceDirectionOfTravel", fallbackYaw: 0 } : { kind: "fixed", yaw: 0 };
      let planned: PlannedTrajectory;
      try {
        planned = minJerkPlanner.plan({
          start: from,
          end: to,
          duration: transition,
          maxVelocity: project.limits.maxVelocity,
          maxAcceleration: project.limits.maxAcceleration,
          maxJerk: project.limits.maxJerk,
          yawPolicy,
          easing: clip.easing,
          verticalArc:
            phase === "SHOW"
              ? clampArc(arcForDrone(i), from[1], to[1], project.limits.maxAltitude)
              : 0,
        });
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
        segs.push({
          start: clip.start + transition,
          end: clip.start + transition + clip.hold,
          clipId: clip.id,
          phase,
          kind: "hold",
          planned: planHold(to, clip.hold),
        });
      }
    }
    current = target;
  }

  return {
    project,
    drones,
    schedules,
    assignments,
    duration: showDuration(project),
    algorithmVersion: TRAJECTORY_ALGORITHM_VERSION,
    errors,
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
