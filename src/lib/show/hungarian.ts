/**
 * EXACT LINEAR ASSIGNMENT SOLVER — Jonker-Volgenant style shortest augmenting
 * path formulation of the Kuhn-Munkres (Hungarian) algorithm.
 *
 * Solves: given a square N x N cost matrix, choose exactly one column for every
 * row (and therefore exactly one row for every column) so the total cost is
 * MINIMAL. This is a globally optimal solver, not a greedy heuristic.
 *
 * Complexity: O(N^3) time, O(N^2) memory. N = 200 (40 000 costs) runs in a few
 * tens of milliseconds on a normal development machine — see the benchmark test.
 *
 * DETERMINISM / TIE-BREAKING
 *   - Rows are processed in ascending index order.
 *   - Inside the augmenting-path search the candidate column is chosen with a
 *     STRICT `<` comparison scanning columns in ascending index order, so on
 *     equal reduced cost the LOWEST column index always wins.
 *   - No randomness, no hashing, no floating-point-order dependence beyond the
 *     deterministic scan order above.
 *   Identical input therefore always yields an identical assignment.
 *
 * This module is pure: no React, no Three.js, no I/O.
 */

export const LINEAR_ASSIGNMENT_SOLVER_ID = "jonker-volgenant";

export interface LinearAssignmentSolution {
  /** assignment[row] = column. Always a permutation of 0..n-1. */
  readonly assignment: number[];
  readonly totalCost: number;
  readonly solverId: string;
}

/**
 * @param cost square matrix, cost[row][col]. Must be finite.
 * @throws Error when the matrix is not square or contains non-finite values.
 */
export function solveLinearAssignment(cost: readonly (readonly number[])[]): LinearAssignmentSolution {
  const n = cost.length;
  if (n === 0) return { assignment: [], totalCost: 0, solverId: LINEAR_ASSIGNMENT_SOLVER_ID };
  for (let i = 0; i < n; i++) {
    const row = cost[i]!;
    if (row.length !== n) throw new Error(`Cost matrix must be square (row ${i} has ${row.length} of ${n})`);
    for (let j = 0; j < n; j++) {
      if (!Number.isFinite(row[j]!)) throw new Error(`Cost matrix contains a non-finite value at [${i}][${j}]`);
    }
  }

  const INF = Infinity;
  // 1-indexed potentials/matching arrays (classic formulation).
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1).fill(0); // p[col] = row matched to col
  const way = new Int32Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        // Strict `<` + ascending scan => lowest column index wins ties.
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) {
    const row = p[j]!;
    if (row >= 1) assignment[row - 1] = j - 1;
  }
  let totalCost = 0;
  for (let i = 0; i < n; i++) totalCost += cost[i]![assignment[i]!]!;
  return { assignment, totalCost, solverId: LINEAR_ASSIGNMENT_SOLVER_ID };
}
