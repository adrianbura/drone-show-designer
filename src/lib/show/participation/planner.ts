/**
 * SMART RESERVE PLANNER — deterministic fleet participation.
 *
 * Answers exactly two questions for one scene:
 *   1. WHICH physical drones fly the formation (and to which POINT)?
 *   2. WHAT does every other drone do (role + explicit target)?
 *
 * It does NOT plan paths, does NOT detect conflicts and does NOT validate
 * safety. The trajectory planner, conflict detector and safety validator remain
 * authoritative; this engine only proposes assignments.
 *
 * SUBSET SELECTION
 *   The active subset is chosen by cost, never by "first M" or "lowest ids".
 *   Selection and point assignment are solved TOGETHER as one linear assignment
 *   problem: columns 0..M-1 are the formation points, columns M..N-1 are
 *   "not active" columns priced with the drone's reserve cost (see cost.ts).
 *   The optimum therefore trades current transition cost against look-ahead
 *   usefulness in one bounded step.
 *
 * SOLVER
 *   N <= PARTICIPATION_EXACT_SOLVER_LIMIT  -> exact Hungarian (O(N^3)).
 *   N >  limit                             -> bounded deterministic greedy in
 *                                             O(N*M): rows ordered by their
 *                                             (best active cost - reserve cost)
 *                                             advantage, ties by drone index.
 *   No exponential subset enumeration ever runs.
 *
 * LOOK-AHEAD
 *   Bounded window of the next `settings.lookAheadScenes` artistic scenes
 *   (default 2). The first scene in that window with MORE points than the
 *   current one supplies pre-position targets; if none does, the planner says so
 *   (`NO_FUTURE_TARGET` / `NO_PREPOSITION_BENEFIT`) and falls back to the
 *   reserve zone instead of pretending to prepare for a nonexistent formation.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { DroneDefinition } from "../drones";
import { solveLinearAssignment } from "../hungarian";
import type { SafetyLimits, ShowArea, Vector3Tuple } from "../types";
import {
  DEFAULT_PARTICIPATION_WEIGHTS,
  PARTICIPATION_COST_MODEL_VERSION,
  footprintOf,
  pushOutsideFootprint,
  segmentCrossesFootprint,
  sqDistance,
  type Footprint,
  type ParticipationCostWeights,
} from "./cost";
import { reserveSlotPositions } from "./reserveZone";
import { computeParticipationRevision } from "./revision";
import {
  PARTICIPATION_ALGORITHM_VERSION,
  ParticipationError,
  assertParticipationInvariant,
  clipParticipation,
  participationCounts,
  type ActivePointAssignment,
  type DroneParticipation,
  type FleetParticipationPlan,
  type FormationTargetGroup,
  type ParticipationSettings,
  type ParticipationWarning,
} from "./types";

/** Above this fleet size the bounded solver replaces the cubic exact solver. */
export const PARTICIPATION_EXACT_SOLVER_LIMIT = 256;

/** Single active group id used by this build. Scenes stay group-based. */
export const PRIMARY_GROUP_ID = "primary";

export interface ParticipationScene {
  readonly clipId: string;
  readonly formationId: string | null;
  readonly dynamicFormationId?: string;
  /** Target points of the scene, in formation point order. */
  readonly points: readonly Vector3Tuple[];
  /** Stable point ids (dynamic assets). Index-aligned with `points`. */
  readonly pointIds?: readonly string[];
}

export interface PlanFleetParticipationInput {
  readonly drones: readonly DroneDefinition[];
  /** Current position of every drone, indexed by drone index. */
  readonly current: readonly Vector3Tuple[];
  readonly scene: ParticipationScene;
  /** Bounded, already-ordered future scenes. */
  readonly lookAhead?: readonly ParticipationScene[];
  readonly settings: ParticipationSettings;
  readonly limits: SafetyLimits;
  readonly area?: ShowArea;
  /** Previous scene's plan — used only to avoid unnecessary identity churn. */
  readonly previous?: FleetParticipationPlan | null;
  readonly weights?: ParticipationCostWeights;
}

const positionOf = (input: PlanFleetParticipationInput, i: number): Vector3Tuple =>
  input.current[i] ?? input.drones[i]?.homePosition ?? [0, 0, 0];

/**
 * Deterministic rectangular matching with priced "no column" alternatives.
 * Returns, per row, the chosen column index or -1 when the row took its
 * priced alternative. `cols.length <= rows.length` is required.
 */
function solveMatching(
  rows: readonly number[],
  colCost: (row: number, col: number) => number,
  alternativeCost: (row: number) => number,
  colCount: number,
  exact: boolean,
): number[] {
  const n = rows.length;
  const out = new Array<number>(n).fill(-1);
  if (n === 0 || colCount === 0) return out;

  if (exact) {
    const matrix: number[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n);
      const alt = alternativeCost(rows[i]!);
      for (let j = 0; j < n; j++) row[j] = j < colCount ? colCost(rows[i]!, j) : alt;
      matrix[i] = row;
    }
    const solution = solveLinearAssignment(matrix);
    for (let i = 0; i < n; i++) {
      const col = solution.assignment[i]!;
      out[i] = col < colCount ? col : -1;
    }
    return out;
  }

  // Bounded fallback: order rows by how much they gain from taking a column,
  // then take the cheapest free column. Deterministic, O(n * colCount).
  const advantage = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < colCount; j++) {
      const c = colCost(rows[i]!, j);
      if (c < best) best = c;
    }
    advantage[i] = best - alternativeCost(rows[i]!);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => advantage[a]! - advantage[b]! || rows[a]! - rows[b]!,
  );
  const taken = new Uint8Array(colCount);
  let remaining = colCount;
  for (const i of order) {
    if (remaining === 0) break;
    let bestCol = -1;
    let bestCost = Infinity;
    for (let j = 0; j < colCount; j++) {
      if (taken[j]) continue;
      const c = colCost(rows[i]!, j);
      if (c < bestCost) {
        bestCost = c;
        bestCol = j;
      }
    }
    if (bestCol >= 0) {
      taken[bestCol] = 1;
      remaining--;
      out[i] = bestCol;
    }
  }
  return out;
}

/** Scene of the bounded look-ahead window that can absorb reserve drones. */
function pickPrepositionScene(
  lookAhead: readonly ParticipationScene[],
  currentPointCount: number,
): ParticipationScene | null {
  for (const scene of lookAhead) {
    if (scene.points.length > currentPointCount) return scene;
  }
  return null;
}

export function planFleetParticipation(
  input: PlanFleetParticipationInput,
): FleetParticipationPlan {
  const { drones, scene, settings, limits } = input;
  const fleetSize = drones.length;
  if (fleetSize <= 0) {
    throw new ParticipationError("INVALID_FLEET", "The fleet is empty: nothing to plan.");
  }
  const points = scene.points;
  const m = points.length;
  if (m > fleetSize) {
    throw new ParticipationError(
      "FORMATION_TOO_LARGE",
      `This formation requires ${m} drones, but the current fleet has ${fleetSize}.`,
      { required: m, fleetSize, clipId: scene.clipId, formationId: scene.formationId },
    );
  }

  const weights = input.weights ?? DEFAULT_PARTICIPATION_WEIGHTS;
  const resolved = clipParticipation(settings, scene.clipId);
  const policy = resolved.policy;
  const reserveZone = resolved.reserveZone;
  const lookAheadScenes = (input.lookAhead ?? []).slice(0, Math.max(0, settings.lookAheadScenes));
  const warnings: ParticipationWarning[] = [];
  const exact = fleetSize <= PARTICIPATION_EXACT_SOLVER_LIMIT;
  const footprint: Footprint = footprintOf(points);

  const previousActive = new Set(
    (input.previous?.drones ?? [])
      .filter((d) => d.role === "ACTIVE_FORMATION")
      .map((d) => d.droneId),
  );
  const sameFormation =
    !!input.previous &&
    input.previous.activeGroups[0]?.formationId === scene.formationId &&
    scene.formationId !== null;

  const activeCost = (drone: number, col: number): number => {
    const base = sqDistance(positionOf(input, drone), points[col]!) * weights.active;
    return sameFormation && previousActive.has(drones[drone]!.id)
      ? base * weights.stabilityDiscount
      : base;
  };

  // ---------------------------------------------------------------- scale
  // Mean cheapest active cost: keeps constant cost terms scale-consistent.
  let scale = 0;
  if (m > 0) {
    for (let i = 0; i < fleetSize; i++) {
      let best = Infinity;
      for (let j = 0; j < m; j++) {
        const c = sqDistance(positionOf(input, i), points[j]!);
        if (c < best) best = c;
      }
      scale += Number.isFinite(best) ? best : 0;
    }
    scale /= fleetSize;
  }
  if (!(scale > 0)) scale = 1;

  // ------------------------------------------------------------ look-ahead
  const prepositionScene = pickPrepositionScene(lookAheadScenes, m);
  const futurePoints = prepositionScene?.points ?? [];
  const futureCost = (drone: number): number => {
    if (futurePoints.length === 0) return scale;
    let best = Infinity;
    const p = positionOf(input, drone);
    for (const q of futurePoints) {
      const c = sqDistance(p, q);
      if (c < best) best = c;
    }
    return best;
  };
  const reserveCost = (drone: number): number =>
    weights.reserveBase * scale + weights.future * futureCost(drone);

  // -------------------------------------------------------- active subset
  const allRows = Array.from({ length: fleetSize }, (_, i) => i);
  let activeCol: number[];
  if (policy === "MANUAL") {
    const manual = resolved.manual;
    const ids = manual?.activeDroneIds ?? [];
    if (ids.length !== m) {
      throw new ParticipationError(
        "MANUAL_ACTIVE_COUNT_MISMATCH",
        `Manual participation selects ${ids.length} drones but the formation has ${m} points.`,
        { selected: ids.length, required: m, clipId: scene.clipId },
      );
    }
    const byId = new Map(drones.map((d) => [d.id, d.index] as const));
    const activeRows: number[] = [];
    for (const id of ids) {
      const index = byId.get(id);
      if (index === undefined) {
        throw new ParticipationError("UNKNOWN_DRONE", `${id} is not part of this fleet.`, {
          droneId: id,
          clipId: scene.clipId,
        });
      }
      if (activeRows.includes(index)) {
        throw new ParticipationError("DUPLICATE_DRONE", `${id} is selected twice.`, {
          droneId: id,
          clipId: scene.clipId,
        });
      }
      activeRows.push(index);
    }
    activeRows.sort((a, b) => a - b);
    // The USER chooses the drones; the engine still assigns the POINTS optimally.
    const cols = solveMatching(activeRows, activeCost, () => Infinity, m, activeRows.length <= PARTICIPATION_EXACT_SOLVER_LIMIT);
    activeCol = new Array<number>(fleetSize).fill(-1);
    activeRows.forEach((row, k) => {
      activeCol[row] = cols[k]!;
    });
  } else {
    activeCol = solveMatching(allRows, activeCost, reserveCost, m, exact);
  }

  const activeAssignments: ActivePointAssignment[] = [];
  const participation = new Array<DroneParticipation | null>(fleetSize).fill(null);
  const nonActive: number[] = [];
  for (let i = 0; i < fleetSize; i++) {
    const col = activeCol[i] ?? -1;
    if (col >= 0) {
      const pointId = scene.pointIds?.[col];
      activeAssignments.push({
        droneId: drones[i]!.id,
        droneIndex: i,
        formationPointIndex: col,
        ...(pointId ? { formationPointId: pointId } : {}),
        cost: activeCost(i, col),
      });
      participation[i] = {
        droneId: drones[i]!.id,
        droneIndex: i,
        role: "ACTIVE_FORMATION",
        groupId: PRIMARY_GROUP_ID,
        formationPointIndex: col,
        ...(pointId ? { formationPointId: pointId } : {}),
        target: points[col]!,
      };
    } else {
      nonActive.push(i);
    }
  }
  activeAssignments.sort((a, b) => a.droneIndex - b.droneIndex);

  // ------------------------------------------------------ non-active roles
  const manualHold = new Set(resolved.manual?.holdDroneIds ?? []);
  const manualReserve = new Set(resolved.manual?.reserveDroneIds ?? []);
  const holdRows: number[] = [];
  const placeableRows: number[] = [];

  if (policy === "HOLD_CURRENT") {
    holdRows.push(...nonActive);
  } else if (policy === "MANUAL") {
    for (const i of nonActive) {
      if (manualHold.has(drones[i]!.id)) holdRows.push(i);
      else placeableRows.push(i);
    }
  } else {
    placeableRows.push(...nonActive);
  }

  for (const i of holdRows) {
    participation[i] = {
      droneId: drones[i]!.id,
      droneIndex: i,
      role: policy === "MANUAL" ? "USER_ASSIGNED" : "HOLD_CURRENT",
      target: positionOf(input, i),
    };
  }

  const k = placeableRows.length;
  let prepositionCount = 0;
  let prepositionTargets: Vector3Tuple[] = [];
  if (policy === "SMART_PREPARE" && k > 0) {
    if (!prepositionScene) {
      warnings.push({
        code: lookAheadScenes.length === 0 ? "NO_FUTURE_TARGET" : "NO_PREPOSITION_BENEFIT",
        message:
          lookAheadScenes.length === 0
            ? "No future scene is available: reserve drones hold the reserve zone instead of pre-positioning."
            : "No look-ahead scene needs more drones than this one: reserve drones hold the reserve zone.",
      });
    } else {
      prepositionCount = Math.min(k, prepositionScene.points.length - m);
      // Prefer the future points FURTHEST from the current artistic centroid so
      // preparing drones stay away from the visible image.
      const margin = Math.max(reserveZone.spacing, limits.minSeparation * 2);
      const ranked = prepositionScene.points
        .map((p, index) => ({ p, index, d: sqDistance(p, footprint.centroid) }))
        .sort((a, b) => b.d - a.d || a.index - b.index)
        .slice(0, prepositionCount);
      prepositionTargets = ranked.map((r) => pushOutsideFootprint(r.p, footprint, margin));
    }
  }

  const reserveSlots = reserveSlotPositions(Math.max(0, k - prepositionCount), reserveZone, {
    ...(input.area ? { area: input.area } : {}),
    limits,
  });
  const cols: Vector3Tuple[] = [...prepositionTargets, ...reserveSlots];
  const footprintMargin = Math.max(reserveZone.spacing, limits.minSeparation * 2);
  const placementCost = (drone: number, col: number): number => {
    const from = positionOf(input, drone);
    const to = cols[col]!;
    const travel = sqDistance(from, to);
    let cost = travel + weights.movement * travel;
    if (col < prepositionCount && segmentCrossesFootprint(from, to, footprint, footprintMargin)) {
      cost += weights.footprint * scale;
    }
    return cost;
  };
  const placement = solveMatching(
    placeableRows,
    placementCost,
    () => Infinity,
    cols.length,
    k <= PARTICIPATION_EXACT_SOLVER_LIMIT,
  );
  placeableRows.forEach((row, idx) => {
    const col = placement[idx] ?? -1;
    const manualRole = policy === "MANUAL" && manualReserve.has(drones[row]!.id);
    if (col < 0) {
      // Defensive: every placeable row always has a column (cols.length === k).
      participation[row] = {
        droneId: drones[row]!.id,
        droneIndex: row,
        role: "HOLD_CURRENT",
        target: positionOf(input, row),
      };
      return;
    }
    if (col < prepositionCount && prepositionScene) {
      participation[row] = {
        droneId: drones[row]!.id,
        droneIndex: row,
        role: "PREPOSITION_NEXT",
        target: cols[col]!,
        ...(prepositionScene.formationId ? { prepositionFormationId: prepositionScene.formationId } : {}),
        prepositionClipId: prepositionScene.clipId,
      };
    } else {
      participation[row] = {
        droneId: drones[row]!.id,
        droneIndex: row,
        role: manualRole ? "USER_ASSIGNED" : "RESERVE_FORMATION",
        target: cols[col]!,
        reserveSlotIndex: col - prepositionCount,
      };
    }
  });

  const droneParticipation = participation.map((p, i) => {
    if (p) return p;
    // Unreachable by construction; kept so the invariant can never silently fail.
    return {
      droneId: drones[i]!.id,
      droneIndex: i,
      role: "HOLD_CURRENT" as const,
      target: positionOf(input, i),
    };
  });

  const group: FormationTargetGroup = {
    groupId: PRIMARY_GROUP_ID,
    formationId: scene.formationId,
    ...(scene.dynamicFormationId ? { dynamicFormationId: scene.dynamicFormationId } : {}),
    pointCount: m,
    assignments: activeAssignments,
  };

  const plan: FleetParticipationPlan = {
    clipId: scene.clipId,
    fleetSize,
    policy,
    activeGroups: [group],
    drones: droneParticipation,
    counts: participationCounts(droneParticipation, fleetSize),
    reserveZone,
    reserveLighting: settings.reserveLighting,
    lookAhead: {
      clipIds: lookAheadScenes.map((s) => s.clipId),
      formationIds: lookAheadScenes.map((s) => s.formationId ?? ""),
      usedPointCount: prepositionScene?.points.length ?? 0,
      usedClipId: prepositionScene?.clipId ?? null,
    },
    provenance: {
      algorithmVersion: PARTICIPATION_ALGORITHM_VERSION,
      costModelVersion: PARTICIPATION_COST_MODEL_VERSION,
      solver: exact ? "exact" : "bounded",
      revision: computeParticipationRevision({
        clipId: scene.clipId,
        fleetSize,
        policy,
        current: drones.map((_, i) => positionOf(input, i)),
        scenePoints: points,
        lookAhead: lookAheadScenes.map((s) => ({ clipId: s.clipId, points: s.points })),
        reserveZone,
        reserveLighting: settings.reserveLighting,
        weights,
        manual: resolved.manual,
        previousActiveIds: sameFormation ? [...previousActive] : undefined,
        algorithmVersion: PARTICIPATION_ALGORITHM_VERSION,
        costModelVersion: PARTICIPATION_COST_MODEL_VERSION,
      }),
    },
    warnings,
  };

  assertParticipationInvariant(plan);
  return plan;
}
