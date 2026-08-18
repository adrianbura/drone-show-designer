/**
 * FULL SHOW METRICS — aggregation only. Every number here is derived from the
 * composed TrajectorySet and the conflict report; nothing is estimated,
 * extrapolated or invented.
 */
import type { ConflictReport, TrajectoryConflict } from "../conflicts";
import type { TrajectorySet } from "../trajectory/types";
import type { ShowArea, ShowPhase, Vector3Tuple } from "../types";
import type {
  DroneShowMetrics,
  FullShowPlan,
  PhaseMetrics,
  TransitionAggregate,
  TransitionReport,
} from "./types";

const mag = (v: Vector3Tuple) => Math.hypot(v[0], v[1], v[2]);

interface WindowStats {
  maxVelocity: number;
  maxAcceleration: number;
  maxJerk: number;
  maxYawRate: number;
  minSeparation: number;
  totalDistance: number;
  maxDroneDistance: number;
  boundaryViolations: number;
}

/** Per-sample maxima and per-drone travel over an absolute time window. */
export function windowStats(
  set: TrajectorySet,
  start: number,
  end: number,
  area?: ShowArea,
): WindowStats {
  const rate = set.sampleRate;
  // The canonical set may begin at NEGATIVE show time (PRE_SHOW). Absolute show
  // time must therefore be mapped through the set's own origin, never assumed 0.
  const origin = set.startTime ?? 0;
  const from = Math.max(0, Math.floor((start - origin) * rate));
  const to = Math.min((set.drones[0]?.samples.length ?? 1) - 1, Math.ceil((end - origin) * rate));
  let maxVelocity = 0;
  let maxAcceleration = 0;
  let maxJerk = 0;
  let maxYawRate = 0;
  let totalDistance = 0;
  let maxDroneDistance = 0;
  let boundaryViolations = 0;
  const halfW = area ? area.width / 2 : Infinity;
  const halfD = area ? area.depth / 2 : Infinity;

  for (const drone of set.drones) {
    let travelled = 0;
    for (let k = from; k <= to; k++) {
      const s = drone.samples[k];
      if (!s) continue;
      maxVelocity = Math.max(maxVelocity, mag(s.velocity));
      maxAcceleration = Math.max(maxAcceleration, mag(s.acceleration));
      maxJerk = Math.max(maxJerk, mag(s.jerk));
      maxYawRate = Math.max(maxYawRate, Math.abs(s.yawRate));
      if (area && (Math.abs(s.position[0]) > halfW || Math.abs(s.position[2]) > halfD)) {
        boundaryViolations++;
      }
      if (k > from) {
        const prev = drone.samples[k - 1];
        if (prev) {
          travelled += Math.hypot(
            s.position[0] - prev.position[0],
            s.position[1] - prev.position[1],
            s.position[2] - prev.position[2],
          );
        }
      }
    }
    totalDistance += travelled;
    maxDroneDistance = Math.max(maxDroneDistance, travelled);
  }

  return {
    maxVelocity,
    maxAcceleration,
    maxJerk,
    maxYawRate,
    minSeparation: Infinity,
    totalDistance,
    maxDroneDistance,
    boundaryViolations,
  };
}

function minSeparationInWindow(
  conflicts: readonly TrajectoryConflict[],
  fallback: number,
  start: number,
  end: number,
): { min: number; count: number } {
  let min = Infinity;
  let count = 0;
  for (const c of conflicts) {
    if (c.timeOfClosestApproach < start - 1e-9 || c.timeOfClosestApproach > end + 1e-9) continue;
    count++;
    if (c.minDistance < min) min = c.minDistance;
  }
  return { min: Number.isFinite(min) ? min : fallback, count };
}

export function phaseMetrics(
  plan: FullShowPlan,
  conflicts: ConflictReport,
  area: ShowArea,
): PhaseMetrics[] {
  return plan.phases.map((w) => {
    const stats = windowStats(plan.trajectorySet, w.start, w.end, area);
    const sep = minSeparationInWindow(conflicts.conflicts, Infinity, w.start, w.end);
    return {
      phase: w.phase,
      start: w.start,
      end: w.end,
      duration: w.end - w.start,
      minSeparation: sep.min,
      maxVelocity: stats.maxVelocity,
      maxAcceleration: stats.maxAcceleration,
      maxJerk: stats.maxJerk,
      maxYawRate: stats.maxYawRate,
      conflictCount: sep.count,
      boundaryViolations: stats.boundaryViolations,
    };
  });
}

export function transitionReports(
  plan: FullShowPlan,
  conflicts: ConflictReport,
): TransitionReport[] {
  return plan.transitions.map((t) => {
    const stats = windowStats(plan.trajectorySet, t.start, t.end);
    const sep = minSeparationInWindow(conflicts.conflicts, Infinity, t.start, t.end);
    return {
      clipId: t.clipId,
      phase: t.phase,
      formationName: t.formationName,
      start: t.start,
      end: t.end,
      status: t.status,
      totalTravelDistance: stats.totalDistance,
      maxTravelDistance: stats.maxDroneDistance,
      minSeparation: sep.min,
      maxVelocity: stats.maxVelocity,
      maxAcceleration: stats.maxAcceleration,
      maxJerk: stats.maxJerk,
      conflictCount: sep.count,
    };
  });
}

export function transitionAggregate(reports: readonly TransitionReport[]): TransitionAggregate {
  const pick = (
    better: (a: TransitionReport, b: TransitionReport) => boolean,
  ): string | null => {
    let best: TransitionReport | null = null;
    for (const r of reports) if (!best || better(r, best)) best = r;
    return best?.clipId ?? null;
  };
  return {
    worstByMinSeparation: pick((a, b) => a.minSeparation < b.minSeparation),
    longestTravel: pick((a, b) => a.maxTravelDistance > b.maxTravelDistance),
    highestVelocity: pick((a, b) => a.maxVelocity > b.maxVelocity),
    highestAcceleration: pick((a, b) => a.maxAcceleration > b.maxAcceleration),
    highestJerk: pick((a, b) => a.maxJerk > b.maxJerk),
    mostConflicts: pick((a, b) => a.conflictCount > b.conflictCount),
  };
}

export function droneMetrics(plan: FullShowPlan, conflicts: ConflictReport): DroneShowMetrics[] {
  const set = plan.trajectorySet;
  const perDroneSep = new Map<number, { min: number; count: number }>();
  for (const c of conflicts.conflicts) {
    for (const idx of [c.indexA, c.indexB]) {
      const cur = perDroneSep.get(idx) ?? { min: Infinity, count: 0 };
      perDroneSep.set(idx, {
        min: Math.min(cur.min, c.minDistance),
        count: cur.count + 1,
      });
    }
  }

  return set.drones.map((drone, index) => {
    let totalDistance = 0;
    let maxVelocity = 0;
    let maxAcceleration = 0;
    let maxJerk = 0;
    let maxYawRate = 0;
    let maxAltitude = 0;
    for (let k = 0; k < drone.samples.length; k++) {
      const s = drone.samples[k]!;
      maxVelocity = Math.max(maxVelocity, mag(s.velocity));
      maxAcceleration = Math.max(maxAcceleration, mag(s.acceleration));
      maxJerk = Math.max(maxJerk, mag(s.jerk));
      maxYawRate = Math.max(maxYawRate, Math.abs(s.yawRate));
      maxAltitude = Math.max(maxAltitude, s.position[1]);
      if (k > 0) {
        const p = drone.samples[k - 1]!.position;
        totalDistance += Math.hypot(
          s.position[0] - p[0],
          s.position[1] - p[1],
          s.position[2] - p[2],
        );
      }
    }
    const sep = perDroneSep.get(index);
    return {
      droneId: drone.droneId,
      index,
      totalDistance,
      maxVelocity,
      maxAcceleration,
      maxJerk,
      maxYawRate,
      minSeparation: sep?.min ?? Infinity,
      conflictCount: sep?.count ?? 0,
      maxAltitude,
    };
  });
}
