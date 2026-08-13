/**
 * Trajectory Sampler — converts continuous planned schedules into a discrete
 * TrajectorySet at a configurable rate. The data model is rate agnostic: 10, 20,
 * 25, 50 and 100 Hz all work without any type change.
 */
import type { ShowPlan } from "./schedule";
import { sampleScheduleAt } from "./schedule";
import type { DroneTrajectory, TrajectorySample, TrajectorySet } from "./types";

export const DEFAULT_SAMPLE_RATE = 10;
export const SUPPORTED_SAMPLE_RATES = [10, 20, 25, 50, 100] as const;

export interface SampleOptions {
  sampleRate?: number;
  /** Overrides plan duration (seconds). */
  duration?: number;
}

export function sampleTrajectorySet(plan: ShowPlan, options: SampleOptions = {}): TrajectorySet {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid sampleRate: ${sampleRate}`);
  }
  const duration = Math.max(0, options.duration ?? plan.duration);
  const stepCount = Math.floor(duration * sampleRate) + 1;

  const drones: DroneTrajectory[] = plan.schedules.map((schedule, i) => {
    const home = plan.drones[i]?.homePosition ?? ([0, 0, 0] as const);
    const samples: TrajectorySample[] = new Array(stepCount);
    for (let k = 0; k < stepCount; k++) {
      // t derived from the index (no accumulation) to avoid float drift.
      const t = k / sampleRate;
      samples[k] = sampleScheduleAt(schedule, home, t);
    }
    return { droneId: schedule.droneId, samples };
  });

  return {
    droneCount: plan.drones.length,
    duration,
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
  const k = Math.max(0, Math.min(samples.length - 1, Math.round(t * set.sampleRate)));
  return samples[k];
}
