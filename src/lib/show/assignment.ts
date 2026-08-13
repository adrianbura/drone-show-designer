/**
 * ASSIGNMENT ENGINE — decides WHICH drone flies to WHICH formation point.
 *
 * This engine answers exactly one question. It does NOT plan paths, does NOT
 * detect conflicts and does NOT validate safety (see trajectory/, conflicts.ts
 * and safety.ts). Optimising assignment cost is not collision avoidance:
 * a globally cost-optimal assignment can still produce crossing paths and
 * dynamic separation conflicts. That is why the pipeline keeps
 * assignment -> planning -> conflict detection strictly separate.
 *
 * COST MODEL
 *   Default geometric cost = SQUARED Euclidean distance between the drone's
 *   source position and the candidate target point (`costMode:
 *   "squaredEuclidean"`). Plain Euclidean distance is available through
 *   `costMode: "euclidean"`. Reported travel-distance metrics are ALWAYS plain
 *   Euclidean metres, independent of the cost mode.
 *
 * DETERMINISM
 *   Every strategy is deterministic. Ties resolve to the lowest target index
 *   (greedy) or to the lowest column index (exact solver, see hungarian.ts).
 *
 * Pure module: no React, no Three.js.
 */
import type { DroneDefinition } from "./drones";
import { solveLinearAssignment } from "./hungarian";
import type { Vector3Tuple } from "./types";

/** Bumped whenever assignment results can change for identical input. */
export const ASSIGNMENT_ALGORITHM_VERSION = "0.2.0";

export interface DroneAssignment {
  readonly droneId: string;
  readonly sourcePointIndex: number;
  readonly targetPointIndex: number;
  /** Geometric cost of this pairing under the active cost mode. */
  readonly cost?: number;
}

export type AssignmentStrategyId =
  | "nearestNeighbor"
  | "optimalDistance"
  | "identity"
  | "hungarian"
  | "auction"
  | "minTotalPath"
  | "continuity"
  | "collisionAware";

export type AssignmentCostMode = "squaredEuclidean" | "euclidean";

export interface AssignmentInput {
  /** Current position of each drone, indexed by DroneDefinition.index. */
  readonly source: readonly Vector3Tuple[];
  readonly target: readonly Vector3Tuple[];
  readonly drones: readonly DroneDefinition[];
  readonly costMode?: AssignmentCostMode;
}

export interface AssignmentStrategy {
  readonly id: AssignmentStrategyId;
  readonly implemented: boolean;
  /** Human label for UI. */
  readonly label: string;
  assign(input: AssignmentInput): DroneAssignment[];
}

export interface AssignmentMetrics {
  readonly droneCount: number;
  /** Sum of the active cost function over all pairings. */
  readonly totalCost: number;
  readonly totalDistance: number;
  readonly averageDistance: number;
  readonly maxDistance: number;
  readonly minDistance: number;
  readonly rmsDistance: number;
}

export interface AssignmentResult {
  readonly strategy: AssignmentStrategyId;
  readonly costMode: AssignmentCostMode;
  readonly assignments: DroneAssignment[];
  readonly metrics: AssignmentMetrics;
  readonly algorithmVersion: string;
  /** Measured solver wall time in milliseconds. */
  readonly solverMs: number;
}

export type AssignmentErrorCode =
  | "INVALID_SOURCE_FORMATION"
  | "INVALID_TARGET_FORMATION"
  | "DRONE_COUNT_MISMATCH"
  | "ASSIGNMENT_FAILED";

export class AssignmentError extends Error {
  readonly code: AssignmentErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(code: AssignmentErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AssignmentError";
    this.code = code;
    this.details = details;
  }
}

const sqDist = (a: Vector3Tuple, b: Vector3Tuple) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const euclid = (a: Vector3Tuple, b: Vector3Tuple) => Math.sqrt(sqDist(a, b));

export function assignmentCost(a: Vector3Tuple, b: Vector3Tuple, mode: AssignmentCostMode): number {
  return mode === "euclidean" ? euclid(a, b) : sqDist(a, b);
}

function sourceOf(input: AssignmentInput, i: number): Vector3Tuple {
  return input.source[i] ?? input.drones[i]?.homePosition ?? [0, 0, 0];
}

/**
 * Greedy nearest-neighbour matching. O(n^2), stable, deterministic: drones are
 * processed in index order and ties resolve to the lowest target index.
 * Kept for comparison and backward compatibility — it is NOT globally optimal.
 */
export const nearestNeighborStrategy: AssignmentStrategy = {
  id: "nearestNeighbor",
  implemented: true,
  label: "Nearest Neighbor",
  assign(input) {
    const { target, drones } = input;
    const mode = input.costMode ?? "squaredEuclidean";
    const n = drones.length;
    const taken = new Array<boolean>(target.length).fill(false);
    const out: DroneAssignment[] = [];
    for (let i = 0; i < n; i++) {
      const a = sourceOf(input, i);
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < target.length; j++) {
        if (taken[j]) continue;
        const d = assignmentCost(a, target[j]!, mode);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best < 0) best = i % Math.max(1, target.length);
      taken[best] = true;
      out.push({
        droneId: drones[i]!.id,
        sourcePointIndex: i,
        targetPointIndex: best,
        cost: assignmentCost(a, target[best] ?? a, mode),
      });
    }
    return out;
  },
};

/**
 * Globally optimal minimum-cost bipartite assignment (Kuhn-Munkres /
 * Jonker-Volgenant). Guarantees exactly one target per drone and exactly one
 * drone per target, and the minimal achievable total cost under the active cost
 * mode. Exposed to the UI as "Optimal Distance (Hungarian)".
 */
export const optimalDistanceStrategy: AssignmentStrategy = {
  id: "optimalDistance",
  implemented: true,
  label: "Optimal Distance",
  assign(input) {
    const { drones, target } = input;
    const mode = input.costMode ?? "squaredEuclidean";
    const n = drones.length;
    if (n === 0) return [];
    if (target.length === 0) {
      throw new AssignmentError("INVALID_TARGET_FORMATION", "Target formation has no points");
    }
    // Pad/repeat target points so the matrix is square (N x N) even when the
    // formation supplies fewer points than the fleet size.
    const cols: Vector3Tuple[] = [];
    const colSource: number[] = [];
    for (let j = 0; j < n; j++) {
      cols.push(target[j % target.length]!);
      colSource.push(j % target.length);
    }
    const matrix: number[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = sourceOf(input, i);
      const row = new Array<number>(n);
      for (let j = 0; j < n; j++) row[j] = assignmentCost(a, cols[j]!, mode);
      matrix[i] = row;
    }
    const solution = solveLinearAssignment(matrix);
    return drones.map((d, i) => {
      const col = solution.assignment[i]!;
      return {
        droneId: d.id,
        sourcePointIndex: i,
        targetPointIndex: colSource[col]!,
        cost: matrix[i]![col]!,
      };
    });
  },
};

/** Keeps drone i on target point i — used by takeoff/landing and tests. */
export const identityStrategy: AssignmentStrategy = {
  id: "identity",
  implemented: true,
  label: "Identity",
  assign(input) {
    const { drones, target } = input;
    const mode = input.costMode ?? "squaredEuclidean";
    return drones.map((d, i) => {
      const j = Math.min(i, Math.max(0, target.length - 1));
      const a = sourceOf(input, i);
      return {
        droneId: d.id,
        sourcePointIndex: i,
        targetPointIndex: j,
        cost: target[j] ? assignmentCost(a, target[j]!, mode) : 0,
      };
    });
  },
};

export const ASSIGNMENT_STRATEGIES: Record<string, AssignmentStrategy> = {
  nearestNeighbor: nearestNeighborStrategy,
  optimalDistance: optimalDistanceStrategy,
  identity: identityStrategy,
};

/** Strategies offered in the UI for SHOW transitions. */
export const SELECTABLE_ASSIGNMENT_STRATEGIES: AssignmentStrategyId[] = [
  "nearestNeighbor",
  "optimalDistance",
];

export function getAssignmentStrategy(id: AssignmentStrategyId): AssignmentStrategy {
  const s = ASSIGNMENT_STRATEGIES[id];
  if (!s) throw new AssignmentError("ASSIGNMENT_FAILED", `Assignment strategy not implemented: ${id}`);
  return s;
}

export function assignmentStrategyLabel(id: AssignmentStrategyId): string {
  return ASSIGNMENT_STRATEGIES[id]?.label ?? id;
}

/** Travel-distance metrics in metres, plus total cost under the active mode. */
export function assignmentMetrics(
  assignments: readonly DroneAssignment[],
  input: AssignmentInput,
): AssignmentMetrics {
  const mode = input.costMode ?? "squaredEuclidean";
  let totalCost = 0;
  let total = 0;
  let max = 0;
  let min = Infinity;
  let sumSq = 0;
  assignments.forEach((a, i) => {
    const from = sourceOf(input, a.sourcePointIndex);
    const to = input.target[a.targetPointIndex] ?? from;
    const d = euclid(from, to);
    total += d;
    sumSq += d * d;
    if (d > max) max = d;
    if (d < min) min = d;
    totalCost += a.cost ?? assignmentCost(from, to, mode);
    void i;
  });
  const n = assignments.length;
  return {
    droneCount: n,
    totalCost,
    totalDistance: total,
    averageDistance: n > 0 ? total / n : 0,
    maxDistance: max,
    minDistance: n > 0 && Number.isFinite(min) ? min : 0,
    rmsDistance: n > 0 ? Math.sqrt(sumSq / n) : 0,
  };
}

/** Runs a strategy and wraps the result with metrics + measured solver time. */
export function runAssignment(
  strategyId: AssignmentStrategyId,
  input: AssignmentInput,
): AssignmentResult {
  if (input.drones.length === 0) {
    throw new AssignmentError("DRONE_COUNT_MISMATCH", "No drones to assign");
  }
  if (input.source.length > 0 && input.source.length < input.drones.length) {
    throw new AssignmentError(
      "INVALID_SOURCE_FORMATION",
      `Source has ${input.source.length} positions for ${input.drones.length} drones`,
      { source: input.source.length, drones: input.drones.length },
    );
  }
  const strategy = getAssignmentStrategy(strategyId);
  const mode = input.costMode ?? "squaredEuclidean";
  const t0 = performanceNow();
  const assignments = strategy.assign(input);
  const solverMs = performanceNow() - t0;
  return {
    strategy: strategy.id,
    costMode: mode,
    assignments,
    metrics: assignmentMetrics(assignments, input),
    algorithmVersion: ASSIGNMENT_ALGORITHM_VERSION,
    solverMs,
  };
}

export interface AssignmentComparison {
  readonly nearestNeighbor: AssignmentResult;
  readonly optimalDistance: AssignmentResult;
  /** Relative reduction of total travel distance, 0..1 (can be 0). */
  readonly totalDistanceImprovement: number;
  readonly maxDistanceImprovement: number;
  readonly costImprovement: number;
}

/**
 * Programmatic comparison of the greedy and the exact strategy.
 * A lower total distance does NOT imply a safer transition.
 */
export function compareAssignmentStrategies(input: AssignmentInput): AssignmentComparison {
  const greedy = runAssignment("nearestNeighbor", input);
  const optimal = runAssignment("optimalDistance", input);
  const rel = (a: number, b: number) => (a > 0 ? Math.max(0, (a - b) / a) : 0);
  return {
    nearestNeighbor: greedy,
    optimalDistance: optimal,
    totalDistanceImprovement: rel(greedy.metrics.totalDistance, optimal.metrics.totalDistance),
    maxDistanceImprovement: rel(greedy.metrics.maxDistance, optimal.metrics.maxDistance),
    costImprovement: rel(greedy.metrics.totalCost, optimal.metrics.totalCost),
  };
}

function performanceNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Resolves an assignment into concrete target positions in drone index order. */
export function applyAssignment(
  assignments: readonly DroneAssignment[],
  target: readonly Vector3Tuple[],
): Vector3Tuple[] {
  return assignments.map((a) => target[a.targetPointIndex] ?? [0, 0, 0]);
}
