/**
 * DETERMINISTIC LAUNCH-SCHEDULE SUGGESTIONS.
 *
 * Everything here is a SIMULATION suggestion under the current model, never a
 * real-world safety guarantee. Nothing is applied automatically: the caller
 * decides whether to adopt a suggestion.
 *
 * Architected so a future LaunchScheduleOptimizer (joint membership / order /
 * timing / lanes optimisation) can replace these bounded searches. No unbounded
 * optimiser exists.
 */
import type { ShowProject } from "../types";
import { resolvePreShowConfig, patchPreShowConfig } from "./config";
import { analyzePreShow } from "./validate";
import type { LaunchGroupOrder, PreShowConfig } from "./types";

export interface LaunchScheduleEstimate {
  readonly groupCount: number;
  readonly droneCount: number;
  readonly groupInterval: number;
  /** Show-time seconds (negative) of the first and last liftoff. */
  readonly firstLaunchShowTime: number;
  readonly lastLaunchShowTime: number;
  readonly allStagedShowTime: number;
  readonly stagingHold: number;
  readonly preShowDuration: number;
}

/** Closed-form schedule estimate — no trajectory sampling needed. */
export function suggestLaunchSchedule(
  project: ShowProject,
  config?: PreShowConfig,
): LaunchScheduleEstimate {
  const cfg = config ?? resolvePreShowConfig(project.preShow);
  const { plan } = analyzePreShow(project, { config: cfg, sampleRate: 10 });
  return {
    groupCount: plan.groups.length,
    droneCount: plan.droneCount,
    groupInterval: cfg.grouping.groupIntervalSeconds,
    firstLaunchShowTime: plan.firstLiftoffTime - plan.duration,
    lastLaunchShowTime: plan.lastLiftoffTime - plan.duration,
    allStagedShowTime: plan.allDronesAtStagingTime - plan.duration,
    stagingHold: cfg.stagingHold,
    preShowDuration: plan.duration,
  };
}

export interface IntervalSearchOptions {
  readonly minInterval?: number;
  readonly maxInterval?: number;
  readonly step?: number;
  readonly sampleRate?: number;
}

export interface IntervalSearchResult {
  readonly suggestedInterval: number | null;
  readonly tried: { interval: number; conflicts: number; minSeparation: number }[];
  readonly bounded: true;
  readonly statement: string;
}

/**
 * Bounded deterministic search for the smallest group interval that yields no
 * pre-show conflict UNDER THIS MODEL. Returns `null` when no tested interval is
 * conflict-free; the caller must not treat a result as a safety clearance.
 */
export function suggestGroupInterval(
  project: ShowProject,
  options: IntervalSearchOptions = {},
): IntervalSearchResult {
  const min = Math.max(0, options.minInterval ?? 0.5);
  const max = Math.max(min, options.maxInterval ?? 10);
  const step = Math.max(0.05, options.step ?? 0.25);
  const base = resolvePreShowConfig(project.preShow);
  const tried: { interval: number; conflicts: number; minSeparation: number }[] = [];
  let suggested: number | null = null;

  for (let interval = min; interval <= max + 1e-9; interval = Number((interval + step).toFixed(6))) {
    const config = patchPreShowConfig(base, { grouping: { groupIntervalSeconds: interval } });
    const { report } = analyzePreShow(project, {
      config,
      ...(options.sampleRate ? { sampleRate: options.sampleRate } : {}),
    });
    tried.push({
      interval,
      conflicts: report.metrics.totalConflicts,
      minSeparation: report.metrics.minimumSeparation,
    });
    if (report.metrics.totalConflicts === 0) {
      suggested = interval;
      break;
    }
  }

  return {
    suggestedInterval: suggested,
    tried,
    bounded: true,
    statement:
      "Bounded deterministic search under the current simulation model. Not a real-world safety guarantee.",
  };
}

export interface GroupOrderComparison {
  readonly order: LaunchGroupOrder;
  readonly preShowDuration: number;
  readonly minimumSeparation: number;
  readonly conflictCount: number;
  readonly totalDistance: number;
}

/**
 * Compares deterministic group orders. No order is universally better: the
 * caller reads the metrics and decides.
 */
export function compareGroupOrders(
  project: ShowProject,
  orders: readonly LaunchGroupOrder[] = ["forward", "reverse"],
  sampleRate = 10,
): GroupOrderComparison[] {
  const base = resolvePreShowConfig(project.preShow);
  return orders.map((order) => {
    const { report } = analyzePreShow(project, {
      config: patchPreShowConfig(base, { grouping: { order } }),
      sampleRate,
    });
    return {
      order,
      preShowDuration: report.metrics.preShowDuration,
      minimumSeparation: report.metrics.minimumSeparation,
      conflictCount: report.metrics.totalConflicts,
      totalDistance: report.metrics.totalDistance,
    };
  });
}
