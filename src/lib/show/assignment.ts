/**
 * Assignment Engine — decides which drone flies to which formation point.
 *
 * Pure and strategy-based so future solvers (Hungarian, auction, minimum total
 * path length, continuity- or collision-aware) can be dropped in without
 * touching the trajectory layer. Only `nearestNeighbor` is implemented today.
 */
import type { DroneDefinition } from "./drones";
import type { Vector3Tuple } from "./types";

export interface DroneAssignment {
  readonly droneId: string;
  readonly sourcePointIndex: number;
  readonly targetPointIndex: number;
}

export type AssignmentStrategyId =
  | "nearestNeighbor"
  | "identity"
  | "hungarian"
  | "auction"
  | "minTotalPath"
  | "continuity"
  | "collisionAware";

export interface AssignmentInput {
  /** Current position of each drone, indexed by DroneDefinition.index. */
  readonly source: readonly Vector3Tuple[];
  readonly target: readonly Vector3Tuple[];
  readonly drones: readonly DroneDefinition[];
}

export interface AssignmentStrategy {
  readonly id: AssignmentStrategyId;
  readonly implemented: boolean;
  assign(input: AssignmentInput): DroneAssignment[];
}

const sqDist = (a: Vector3Tuple, b: Vector3Tuple) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * Greedy nearest-neighbour matching. O(n^2), stable, deterministic: drones are
 * processed in index order and ties resolve to the lowest target index.
 */
export const nearestNeighborStrategy: AssignmentStrategy = {
  id: "nearestNeighbor",
  implemented: true,
  assign({ source, target, drones }) {
    const n = drones.length;
    const taken = new Array<boolean>(target.length).fill(false);
    const out: DroneAssignment[] = [];
    for (let i = 0; i < n; i++) {
      const a = source[i] ?? drones[i]!.homePosition;
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < target.length; j++) {
        if (taken[j]) continue;
        const d = sqDist(a, target[j]!);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best < 0) best = i % Math.max(1, target.length);
      taken[best] = true;
      out.push({ droneId: drones[i]!.id, sourcePointIndex: i, targetPointIndex: best });
    }
    return out;
  },
};

/** Keeps drone i on target point i — used by takeoff/landing and tests. */
export const identityStrategy: AssignmentStrategy = {
  id: "identity",
  implemented: true,
  assign({ drones, target }) {
    return drones.map((d, i) => ({
      droneId: d.id,
      sourcePointIndex: i,
      targetPointIndex: Math.min(i, Math.max(0, target.length - 1)),
    }));
  },
};

export const ASSIGNMENT_STRATEGIES: Record<string, AssignmentStrategy> = {
  nearestNeighbor: nearestNeighborStrategy,
  identity: identityStrategy,
};

export function getAssignmentStrategy(id: AssignmentStrategyId): AssignmentStrategy {
  const s = ASSIGNMENT_STRATEGIES[id];
  if (!s) throw new Error(`Assignment strategy not implemented: ${id}`);
  return s;
}

/** Resolves an assignment into concrete target positions in drone index order. */
export function applyAssignment(
  assignments: readonly DroneAssignment[],
  target: readonly Vector3Tuple[],
): Vector3Tuple[] {
  return assignments.map((a) => target[a.targetPointIndex] ?? [0, 0, 0]);
}
