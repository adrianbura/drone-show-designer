/**
 * Trajectory Sampler — converts continuous planned schedules into a discrete
 * TrajectorySet at a configurable rate. The data model is rate agnostic: 10, 20,
 * 25, 50 and 100 Hz all work without any type change.
 */
import type { DroneDefinition } from "../drones";
import type { DroneSchedule } from "./schedule";
import { sampleScheduleAt } from "./schedule";
import type { DroneTrajectory, TrajectorySample, TrajectorySet } from "./types";

/**
 * Minimal structural contract the sampler needs. `ShowPlan` satisfies it, and so
 * does a standalone pre-show plan, so both sample through the SAME code path.
 */
export interface SamplablePlan {
  readonly schedules: readonly DroneSchedule[];
  readonly drones: readonly DroneDefinition[];
  readonly duration: number;
  readonly startTime?: number;
  readonly algorithmVersion: string;
}

export const DEFAULT_SAMPLE_RATE = 10;
export const SUPPORTED_SAMPLE_RATES = [10, 20, 25, 50, 100] as const;

export interface SampleOptions {
  sampleRate?: number;
  /** Overrides the sampled SPAN in seconds (defaults to the plan duration). */
  duration?: number;
  /**
   * First sampled show time. Defaults to `plan.startTime` (negative when the
   * plan contains a pre-show) so pre-show samples are part of the canonical set.
   */
  startTime?: number;
}

export function sampleTrajectorySet(plan: ShowPlan, options: SampleOptions = {}): TrajectorySet {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid sampleRate: ${sampleRate}`);
  }
  const startTime = options.startTime ?? plan.startTime ?? 0;
  const span = Math.max(0, options.duration ?? plan.duration - startTime);
  const stepCount = Math.floor(span * sampleRate) + 1;

  const drones: DroneTrajectory[] = plan.schedules.map((schedule, i) => {
    const home = plan.drones[i]?.homePosition ?? ([0, 0, 0] as const);
    const samples: TrajectorySample[] = new Array(stepCount);
    for (let k = 0; k < stepCount; k++) {
      // t derived from the index (no accumulation) to avoid float drift.
      const t = startTime + k / sampleRate;
      samples[k] = sampleScheduleAt(schedule, home, t);
    }
    return { droneId: schedule.droneId, samples };
  });

  return {
    droneCount: plan.drones.length,
    duration: span,
    startTime,
    sampleRate,
    drones,
    algorithmVersion: plan.algorithmVersion,
  };
}

/** Nearest stored sample for a drone at time t (no interpolation). */
export function sampleAtTime(
  set: TrajectorySet,
  droneIndex: number,
  t: number,
): TrajectorySample | undefined {
  const samples = set.drones[droneIndex]?.samples;
  if (!samples || samples.length === 0) return undefined;
  const k = Math.max(
    0,
    Math.min(samples.length - 1, Math.round((t - (set.startTime ?? 0)) * set.sampleRate)),
  );
  return samples[k];
}
