/**
 * TRANSITION OPTIMIZER — bounded, deterministic deconfliction.
 *
 * PIPELINE (each iteration re-runs the whole chain, nothing is mutated in place)
 *   assignment -> plan -> sample -> detect conflicts -> score
 *   -> try strategy -> accept only if the score improves -> repeat
 *
 * OBJECTIVE PRIORITY (encoded by the default weights in types.ts)
 *   1. eliminate critical separation conflicts
 *   2. satisfy trajectory constraints (velocity / acceleration / jerk / altitude)
 *   3. minimise remaining severe proximity
 *   4. minimise the maximum individual travel distance
 *   5. minimise total travel distance
 *   Staggering and vertical offsets carry small penalties so they are only used
 *   when they buy separation.
 *
 * STRATEGIES (all deterministic, all bounded)
 *   A. local target swaps between conflicting drones
 *   B. bounded start-time staggering per conflict group
 *   C. bounded vertical lane allocation per conflict group
 *
 * HONESTY RULES
 *   - "resolved" is returned ONLY when the final conflict count is exactly 0.
 *   - Increased travel distance after deconfliction is reported, never hidden.
 *   - No randomness anywhere: no jitter, no random delays, no random altitudes.
 */
import {
  assignmentMetrics,
  ASSIGNMENT_ALGORITHM_VERSION,
  runAssignment,
  type AssignmentResult,
  type DroneAssignment,
} from "../assignment";
import {
  buildConflictGroups,
  countPotentialGeometricCrossings,
  detectConflicts,
  type ConflictGroup,
  type ConflictReport,
} from "../conflicts";
import { DEFAULT_SAMPLE_RATE } from "../trajectory/sampler";
import type { Vector3Tuple } from "../types";
import { assessDurationFeasibility } from "./duration";
import { planTransition } from "./plan";
import {
  DEFAULT_OPTIMIZATION_SETTINGS,
  TRANSITION_OPTIMIZER_VERSION,
  TransitionOptimizationError,
  type TransitionAnalysis,
  type TransitionInput,
  type TransitionMetrics,
  type TransitionOptimizationResult,
  type TransitionOptimizationSettings,
  type TransitionOptimizationStatus,
  type TransitionOptimizationWeights,
} from "./types";

interface TransitionState {
  /** Target point index per drone (bijective over the padded target columns). */
  readonly targets: number[];
  readonly offsets: number[];
  readonly lanes: number[];
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function validate(input: TransitionInput) {
  if (input.drones.length === 0) {
    throw new TransitionOptimizationError("DRONE_COUNT_MISMATCH", "Transition has no drones");
  }
  if (input.source.length < input.drones.length) {
    throw new TransitionOptimizationError(
      "INVALID_SOURCE_FORMATION",
      `Source formation has ${input.source.length} positions for ${input.drones.length} drones`,
    );
  }
  if (input.target.length === 0) {
    throw new TransitionOptimizationError(
      "INVALID_TARGET_FORMATION",
      "Target formation has no points",
    );
  }
  if (!(input.duration > 0)) {
    throw new TransitionOptimizationError("INVALID_CONSTRAINTS", "Transition duration must be > 0");
  }
  const l = input.limits;
  if (!(l.maxVelocity > 0) || !(l.maxAcceleration > 0) || !(l.minSeparation > 0)) {
    throw new TransitionOptimizationError("INVALID_CONSTRAINTS", "Safety limits must be positive");
  }
}

/** Target columns: the formation points padded/repeated to fleet size. */
function targetColumns(input: TransitionInput): Vector3Tuple[] {
  const n = input.drones.length;
  const out: Vector3Tuple[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = input.target[i % input.target.length]!;
  return out;
}

function assignmentFromState(
  input: TransitionInput,
  state: TransitionState,
  columns: readonly Vector3Tuple[],
  base: AssignmentResult,
): AssignmentResult {
  const assignments: DroneAssignment[] = input.drones.map((d, i) => {
    const col = state.targets[i]!;
    const from = input.source[i] ?? d.homePosition;
    const to = columns[col]!;
    return {
      droneId: d.id,
      sourcePointIndex: i,
      targetPointIndex: col % input.target.length,
      cost:
        base.costMode === "euclidean"
          ? Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
          : (to[0] - from[0]) ** 2 + (to[1] - from[1]) ** 2 + (to[2] - from[2]) ** 2,
    };
  });
  return {
    strategy: base.strategy,
    costMode: base.costMode,
    assignments,
    metrics: assignmentMetrics(assignments, {
      source: input.source,
      target: input.target,
      drones: input.drones,
      costMode: base.costMode,
    }),
    algorithmVersion: ASSIGNMENT_ALGORITHM_VERSION,
    solverMs: 0,
  };
}

function scoreOf(
  metrics: Omit<TransitionMetrics, "score">,
  conflicts: ConflictReport,
  constraintViolations: number,
  weights: TransitionOptimizationWeights,
): number {
  let shortfall = 0;
  for (const c of conflicts.conflicts) shortfall += Math.max(0, c.requiredDistance - c.minDistance);
  return (
    weights.criticalConflict * metrics.criticalConflictCount +
    weights.warningConflict * (metrics.conflictCount - metrics.criticalConflictCount) +
    weights.proximityShortfall * shortfall +
    weights.constraintViolation * constraintViolations +
    weights.maxPath * metrics.maximumTravelDistance +
    weights.totalDistance * metrics.totalTravelDistance +
    weights.staggering * metrics.totalStartOffset +
    weights.verticalOffset * metrics.totalVerticalOffset
  );
}

function evaluate(
  input: TransitionInput,
  state: TransitionState,
  columns: readonly Vector3Tuple[],
  baseAssignment: AssignmentResult,
  settings: TransitionOptimizationSettings,
  iterations: number,
): TransitionAnalysis {
  const t0 = now();
  const assignment = assignmentFromState(input, state, columns, baseAssignment);
  const to = state.targets.map((c) => columns[c]!);
  const planStart = now();
  const planned = planTransition({
    drones: input.drones,
    from: input.source,
    to,
    targetPointIndex: assignment.assignments.map((a) => a.targetPointIndex),
    duration: input.duration,
    easing: input.easing ?? "minJerk",
    limits: input.limits,
    startOffsets: state.offsets,
    laneOffsets: state.lanes,
    laneSpacing: settings.verticalLaneSpacing,
    sampleRate: input.sampleRate ?? DEFAULT_SAMPLE_RATE,
  });
  const planningMs = now() - planStart;

  const conflictStart = now();
  const conflicts = detectConflicts(planned.set, { minSeparation: input.limits.minSeparation });
  const conflictMs = now() - conflictStart;

  let maxV = 0;
  let maxA = 0;
  let maxJ = 0;
  let maxYaw = 0;
  let constraintViolations = 0;
  for (const drone of planned.set.drones) {
    for (const s of drone.samples) {
      const v = Math.hypot(s.velocity[0], s.velocity[1], s.velocity[2]);
      const a = Math.hypot(s.acceleration[0], s.acceleration[1], s.acceleration[2]);
      const j = Math.hypot(s.jerk[0], s.jerk[1], s.jerk[2]);
      const y = Math.abs(s.yawRate);
      if (v > maxV) maxV = v;
      if (a > maxA) maxA = a;
      if (j > maxJ) maxJ = j;
      if (y > maxYaw) maxYaw = y;
      if (s.position[1] > input.limits.maxAltitude + 0.01 || s.position[1] < -0.01) {
        constraintViolations++;
      }
    }
  }
  if (maxV > input.limits.maxVelocity) constraintViolations++;
  if (maxA > input.limits.maxAcceleration) constraintViolations++;
  if (maxJ > input.limits.maxJerk) constraintViolations++;

  const distances = planned.dronePlans.map((p) => p.distance);
  const total = distances.reduce((s, d) => s + d, 0);
  const feasibility = assessDurationFeasibility(planned.dronePlans, input.duration, input.limits);
  const partial: Omit<TransitionMetrics, "score"> = {
    droneCount: input.drones.length,
    totalTravelDistance: total,
    averageTravelDistance: distances.length > 0 ? total / distances.length : 0,
    maximumTravelDistance: distances.reduce((m, d) => Math.max(m, d), 0),
    minimumDynamicSeparation: conflicts.metrics.minimumSeparation,
    conflictCount: conflicts.conflictCount,
    criticalConflictCount: conflicts.criticalCount,
    uniqueConflictPairs: conflicts.metrics.uniqueConflictPairs,
    potentialGeometricCrossings: countPotentialGeometricCrossings(input.source, to),
    maximumVelocity: maxV,
    maximumAcceleration: maxA,
    maximumJerk: maxJ,
    maximumYawRate: maxYaw,
    requestedDuration: input.duration,
    estimatedMinimumDuration: feasibility.minimumEstimatedDuration,
    optimizationIterations: iterations,
    assignmentStrategy: assignment.strategy,
    totalStartOffset: state.offsets.reduce((s, v) => s + v, 0),
    totalVerticalOffset: state.lanes.reduce((s, v) => s + Math.abs(v), 0),
  };

  const totalMs = now() - t0;
  return {
    assignment,
    trajectorySet: planned.set,
    conflicts,
    metrics: {
      ...partial,
      score: scoreOf(partial, conflicts, constraintViolations, settings.weights),
    },
    feasibility,
    dronePlans: planned.dronePlans,
    timeBase: "transition-relative",
    timings: {
      assignmentMs: baseAssignment.solverMs,
      planningMs,
      conflictMs,
      totalMs,
    },
  };
}

/** One-shot analysis: assignment + trajectory + conflicts + metrics. */
export function analyzeTransition(
  input: TransitionInput,
  settings: TransitionOptimizationSettings = DEFAULT_OPTIMIZATION_SETTINGS,
): TransitionAnalysis {
  validate(input);
  const columns = targetColumns(input);
  const base = runAssignment(input.strategy, {
    source: input.source,
    target: input.target,
    drones: input.drones,
  });
  const n = input.drones.length;
  const state: TransitionState = {
    targets: initialTargets(base, input, columns),
    offsets: new Array<number>(n).fill(0),
    lanes: new Array<number>(n).fill(0),
  };
  return evaluate(input, state, columns, base, settings, 0);
}

/**
 * Maps the strategy's per-drone target point index onto a bijective column
 * assignment over the padded target columns (columns repeat when the formation
 * supplies fewer points than the fleet size).
 */
function initialTargets(
  base: AssignmentResult,
  input: TransitionInput,
  columns: readonly Vector3Tuple[],
): number[] {
  const n = input.drones.length;
  const taken = new Array<boolean>(columns.length).fill(false);
  const targets = new Array<number>(n).fill(-1);
  base.assignments.forEach((a, i) => {
    for (let k = 0; k < columns.length; k++) {
      const col = a.targetPointIndex + k * input.target.length;
      if (col < columns.length && !taken[col]) {
        taken[col] = true;
        targets[i] = col;
        return;
      }
    }
    void i;
  });
  // Fill any drone left without a column (defensive; keeps bijectivity).
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (targets[i] !== -1) continue;
    while (next < columns.length && taken[next]) next++;
    targets[i] = Math.min(next, columns.length - 1);
    taken[targets[i]!] = true;
  }
  return targets;
}

function clampLane(
  desired: number,
  from: Vector3Tuple,
  to: Vector3Tuple,
  input: TransitionInput,
  settings: TransitionOptimizationSettings,
): number {
  const margin = settings.verticalClearanceMargin;
  const maxY = Math.max(from[1], to[1]);
  const minY = Math.min(from[1], to[1]);
  const upper = Math.min(settings.maxVerticalOffset, input.limits.maxAltitude - margin - maxY);
  const lower = Math.max(-settings.maxVerticalOffset, input.limits.minAltitude + margin - minY);
  if (upper < lower) return 0;
  return Math.max(lower, Math.min(upper, desired));
}

/** Lane index sequence: 0, +1, -1, +2, -2, ... */
function laneIndexForRank(rank: number): number {
  if (rank === 0) return 0;
  const step = Math.ceil(rank / 2);
  return rank % 2 === 1 ? step : -step;
}

function groupsOf(analysis: TransitionAnalysis): ConflictGroup[] {
  return buildConflictGroups(analysis.conflicts.conflicts);
}

function separationShortfall(analysis: TransitionAnalysis): number {
  return analysis.conflicts.conflicts.reduce(
    (sum, conflict) => sum + Math.max(0, conflict.requiredDistance - conflict.minDistance),
    0,
  );
}

/**
 * Selection is lexicographic: eliminating conflict pairs is always preferable
 * to improving an aggregate weighted score. The latter remains the final
 * deterministic tie-breaker once safety outcomes are equal.
 */
function isBetterAnalysis(candidate: TransitionAnalysis, incumbent: TransitionAnalysis): boolean {
  if (candidate.conflicts.criticalCount !== incumbent.conflicts.criticalCount) {
    return candidate.conflicts.criticalCount < incumbent.conflicts.criticalCount;
  }
  if (candidate.conflicts.conflictCount !== incumbent.conflicts.conflictCount) {
    return candidate.conflicts.conflictCount < incumbent.conflicts.conflictCount;
  }
  const candidateShortfall = separationShortfall(candidate);
  const incumbentShortfall = separationShortfall(incumbent);
  if (Math.abs(candidateShortfall - incumbentShortfall) > 1e-9) {
    return candidateShortfall < incumbentShortfall;
  }
  return candidate.metrics.score < incumbent.metrics.score - 1e-9;
}

interface StrategyCandidate {
  readonly name: string;
  readonly state: TransitionState;
}

/**
 * Produces bounded, pair-local mutations. Batch-editing an entire connected
 * component made unrelated drones collapse onto the same capped delay/lane;
 * local candidates let the full trajectory evaluator choose the one concrete
 * move that improves the actual conflict report.
 */
function localCandidates(
  input: TransitionInput,
  analysis: TransitionAnalysis,
  state: TransitionState,
  columns: readonly Vector3Tuple[],
  settings: TransitionOptimizationSettings,
): StrategyCandidate[] {
  const candidates: StrategyCandidate[] = [];
  const endpointEpsilon = 1 / (input.sampleRate ?? DEFAULT_SAMPLE_RATE);
  const conflicts = analysis.conflicts.conflicts
    .filter(
      (conflict) =>
        conflict.timeOfClosestApproach > endpointEpsilon &&
        conflict.timeOfClosestApproach < input.duration - endpointEpsilon,
    )
    .slice(0, Math.min(1, settings.maxSwapsPerIteration));
  for (const conflict of conflicts) {
    const pair = [conflict.indexA, conflict.indexB] as const;
    if (settings.enableSwaps) {
      const targets = state.targets.slice();
      [targets[pair[0]], targets[pair[1]]] = [targets[pair[1]]!, targets[pair[0]]!];
      candidates.push({
        name: `assignmentSwap:${pair[0]}-${pair[1]}`,
        state: { targets, offsets: state.offsets.slice(), lanes: state.lanes.slice() },
      });
    }
    if (settings.enableStagger) {
      for (const droneIndex of pair) {
        const current = state.offsets[droneIndex] ?? 0;
        const desired = Math.min(
          settings.maxStartOffsetSeconds,
          current + settings.startOffsetStep,
        );
        if (desired <= current + 1e-9) continue;
        const offsets = state.offsets.slice();
        offsets[droneIndex] = desired;
        candidates.push({
          name: `temporalStagger:${droneIndex}`,
          state: { targets: state.targets.slice(), offsets, lanes: state.lanes.slice() },
        });
      }
    }
    if (settings.enableVerticalLanes) {
      for (const direction of [-1, 1] as const) {
        const lanes = state.lanes.slice();
        let changed = false;
        pair.forEach((droneIndex, rank) => {
          const from = input.source[droneIndex] ?? [0, 0, 0];
          const to = columns[state.targets[droneIndex]!] ?? from;
          const desired = clampLane(
            (state.lanes[droneIndex] ?? 0) +
              direction * (rank === 0 ? 1 : -1) * settings.verticalLaneSpacing,
            from,
            to,
            input,
            settings,
          );
          if (Math.abs(desired - (state.lanes[droneIndex] ?? 0)) > 1e-9) changed = true;
          lanes[droneIndex] = desired;
        });
        if (changed) {
          candidates.push({
            name: `verticalLanePair:${pair[0]}-${pair[1]}`,
            state: { targets: state.targets.slice(), offsets: state.offsets.slice(), lanes },
          });
        }
      }
      for (const droneIndex of pair) {
        const from = input.source[droneIndex] ?? [0, 0, 0];
        const to = columns[state.targets[droneIndex]!] ?? from;
        for (const direction of [-1, 1] as const) {
          const current = state.lanes[droneIndex] ?? 0;
          const desired = clampLane(
            current + direction * settings.verticalLaneSpacing,
            from,
            to,
            input,
            settings,
          );
          if (Math.abs(desired - current) <= 1e-9) continue;
          const lanes = state.lanes.slice();
          lanes[droneIndex] = desired;
          candidates.push({
            name: `verticalLane:${droneIndex}:${direction > 0 ? "up" : "down"}`,
            state: { targets: state.targets.slice(), offsets: state.offsets.slice(), lanes },
          });
        }
      }
    }
  }
  return candidates;
}

function trySwaps(
  analysis: TransitionAnalysis,
  state: TransitionState,
  settings: TransitionOptimizationSettings,
): TransitionState | null {
  const used = new Set<number>();
  const targets = state.targets.slice();
  let swaps = 0;
  for (const c of analysis.conflicts.conflicts) {
    if (swaps >= settings.maxSwapsPerIteration) break;
    if (used.has(c.indexA) || used.has(c.indexB)) continue;
    used.add(c.indexA);
    used.add(c.indexB);
    const a = targets[c.indexA]!;
    const b = targets[c.indexB]!;
    targets[c.indexA] = b;
    targets[c.indexB] = a;
    swaps++;
  }
  if (swaps === 0) return null;
  return { targets, offsets: state.offsets.slice(), lanes: state.lanes.slice() };
}

function tryStagger(
  analysis: TransitionAnalysis,
  state: TransitionState,
  settings: TransitionOptimizationSettings,
): TransitionState | null {
  const groups = groupsOf(analysis);
  if (groups.length === 0) return null;
  const offsets = state.offsets.slice();
  let changed = false;
  for (const group of groups) {
    group.indices.forEach((droneIndex, rank) => {
      const desired = Math.min(rank * settings.startOffsetStep, settings.maxStartOffsetSeconds);
      if (Math.abs((offsets[droneIndex] ?? 0) - desired) > 1e-9) changed = true;
      offsets[droneIndex] = desired;
    });
  }
  if (!changed) return null;
  return { targets: state.targets.slice(), offsets, lanes: state.lanes.slice() };
}

function tryVerticalLanes(
  input: TransitionInput,
  analysis: TransitionAnalysis,
  state: TransitionState,
  columns: readonly Vector3Tuple[],
  settings: TransitionOptimizationSettings,
): TransitionState | null {
  const groups = groupsOf(analysis);
  if (groups.length === 0) return null;
  const lanes = state.lanes.slice();
  let changed = false;
  for (const group of groups) {
    group.indices.forEach((droneIndex, rank) => {
      const laneIndex = laneIndexForRank(rank);
      const from = input.source[droneIndex] ?? [0, 0, 0];
      const to = columns[state.targets[droneIndex]!] ?? from;
      const desired = clampLane(
        laneIndex * settings.verticalLaneSpacing,
        from,
        to,
        input,
        settings,
      );
      if (Math.abs((lanes[droneIndex] ?? 0) - desired) > 1e-9) changed = true;
      lanes[droneIndex] = desired;
    });
  }
  if (!changed) return null;
  return { targets: state.targets.slice(), offsets: state.offsets.slice(), lanes };
}

export interface OptimizeOptions {
  /** Cooperative cancellation probe, checked once per iteration. */
  readonly isCancelled?: () => boolean;
}

/**
 * Bounded deterministic optimisation loop. Never runs longer than
 * `settings.maxIterations` iterations and never mutates its input.
 */
export function optimizeTransition(
  input: TransitionInput,
  settings: TransitionOptimizationSettings = DEFAULT_OPTIMIZATION_SETTINGS,
  options: OptimizeOptions = {},
): TransitionOptimizationResult {
  validate(input);
  const t0 = now();
  const columns = targetColumns(input);
  const base = runAssignment(input.strategy, {
    source: input.source,
    target: input.target,
    drones: input.drones,
  });
  const n = input.drones.length;
  let state: TransitionState = {
    targets: initialTargets(base, input, columns),
    offsets: new Array<number>(n).fill(0),
    lanes: new Array<number>(n).fill(0),
  };
  const initial = evaluate(input, state, columns, base, settings, 0);
  let best = initial;
  const applied: string[] = [];
  const warnings: string[] = [];
  let iterations = 0;
  let cancelled = false;

  const maxIterations = Math.max(0, Math.min(50, settings.maxIterations));
  while (iterations < maxIterations && best.conflicts.conflictCount > 0) {
    if (options.isCancelled?.()) {
      cancelled = true;
      break;
    }
    iterations++;
    const batchCandidates: { name: string; state: TransitionState | null }[] = [
      {
        name: "assignmentSwap",
        state: settings.enableSwaps ? trySwaps(best, state, settings) : null,
      },
      {
        name: "temporalStagger",
        state: settings.enableStagger ? tryStagger(best, state, settings) : null,
      },
      {
        name: "verticalLane",
        state: settings.enableVerticalLanes
          ? tryVerticalLanes(input, best, state, columns, settings)
          : null,
      },
    ];
    const candidates: StrategyCandidate[] = [
      ...batchCandidates.flatMap((candidate) =>
        candidate.state ? [{ name: candidate.name, state: candidate.state }] : [],
      ),
      ...localCandidates(input, best, state, columns, settings),
    ];
    let selected:
      { name: string; state: TransitionState; analysis: TransitionAnalysis } | undefined;
    for (const candidate of candidates) {
      const evaluated = evaluate(input, candidate.state, columns, base, settings, iterations);
      if (!isBetterAnalysis(evaluated, best)) continue;
      if (selected && !isBetterAnalysis(evaluated, selected.analysis)) continue;
      selected = { name: candidate.name, state: candidate.state, analysis: evaluated };
    }
    if (!selected) {
      warnings.push(
        `No deterministic improvement found at iteration ${iterations}; optimisation stopped early.`,
      );
      break;
    }
    best = selected.analysis;
    state = selected.state;
    applied.push(selected.name);
  }

  const final: TransitionAnalysis = {
    ...best,
    metrics: { ...best.metrics, optimizationIterations: iterations },
  };

  let status: TransitionOptimizationStatus;
  if (cancelled) status = "cancelled";
  else if (final.conflicts.conflictCount === 0) status = "resolved";
  else if (final.metrics.score < initial.metrics.score - 1e-9) status = "improved";
  else if (applied.length === 0)
    status = initial.conflicts.conflictCount === 0 ? "unchanged" : "unresolved";
  else status = "unresolved";

  if (status === "unresolved") {
    warnings.push(
      `${final.conflicts.conflictCount} conflict(s) remain below the required ${input.limits.minSeparation} m separation.`,
    );
  }
  if (!final.feasibility.feasible) {
    warnings.push(
      `Requested duration ${input.duration.toFixed(1)} s is below the estimated minimum ${final.feasibility.minimumEstimatedDuration.toFixed(1)} s (${final.feasibility.limitingMetric} limited).`,
    );
  }

  return {
    status,
    initial,
    final,
    iterations,
    appliedStrategies: applied,
    settings,
    warnings,
    optimizerVersion: TRANSITION_OPTIMIZER_VERSION,
    totalMs: now() - t0,
  };
}
