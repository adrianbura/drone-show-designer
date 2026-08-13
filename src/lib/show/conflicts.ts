/**
 * CONFLICT DETECTOR — dynamic proximity analysis used DURING transition
 * planning and optimisation.
 *
 * This is NOT the SafetyValidator. The validator (safety.ts) is the final
 * authority that checks a complete TrajectorySet against the project's safety
 * profile (velocity, acceleration, jerk, yaw, altitude, area, separation).
 * The detector here answers one narrower planning question: "do two drones come
 * closer than the required separation at any moment of this trajectory set?"
 * Both may share spatial utilities; neither replaces the other.
 *
 * METHOD
 *   1. The set is walked interval by interval: [sample k, sample k+1].
 *   2. Candidate pairs for the interval come from the uniform spatial hash
 *      (neighbourPairs) with a cell size of
 *          requiredDistance + 2 * maxDisplacementInInterval
 *      which provably contains every pair that could violate separation inside
 *      the interval, so 200-drone detection stays near-linear per frame.
 *   3. For each candidate pair the CONTINUOUS closest approach inside the
 *      interval is computed analytically, assuming LINEAR motion between the
 *      two samples (see closestApproachOnInterval). This catches the classic
 *      "safe at t=1.00, safe at t=1.04, too close at t=1.02" case that
 *      frame-only checking misses.
 *
 * APPROXIMATION / LIMITATIONS
 *   Between-sample motion is linearised. For curved motion the true minimum
 *   distance can differ from the linearised one by an amount bounded by the
 *   sagitta of the curve over one sample interval; at 10-100 Hz with the
 *   project's acceleration limits this is small, but it IS an approximation and
 *   raising the sample rate tightens it. No wind, GNSS error, tracking error or
 *   any other real-world uncertainty is modelled.
 *
 * Pure module: no React, no Three.js.
 */
import { neighbourPairs } from "./safety";
import type { TrajectorySet } from "./trajectory/types";
import type { Vector3Tuple } from "./types";

export const CONFLICT_DETECTION_VERSION = "0.1.0";

/** Below this altitude a drone is considered parked on its pad. */
export const GROUNDED_ALTITUDE = 0.5;

export type ConflictSeverity = "warning" | "critical";

export interface TrajectoryConflict {
  readonly id: string;
  readonly droneA: string;
  readonly droneB: string;
  readonly indexA: number;
  readonly indexB: number;
  /** First and last time the pair is closer than the required distance. */
  readonly startTime: number;
  readonly endTime: number;
  readonly timeOfClosestApproach: number;
  readonly minDistance: number;
  readonly requiredDistance: number;
  readonly severity: ConflictSeverity;
  readonly positionA: Vector3Tuple;
  readonly positionB: Vector3Tuple;
}

export interface ConflictMetrics {
  /** Smallest distance observed between any checked pair (metres). */
  readonly minimumSeparation: number;
  readonly uniqueConflictPairs: number;
  readonly firstConflictTime: number | null;
  readonly lastConflictTime: number | null;
  readonly framesChecked: number;
  readonly intervalsChecked: number;
  readonly candidatePairsChecked: number;
  readonly detectorMs: number;
  readonly method: "spatial-hash + analytic interval closest approach";
}

export interface ConflictReport {
  readonly conflictCount: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  /** The required minimum separation this report was produced with. */
  readonly minimumSeparation: number;
  readonly conflicts: TrajectoryConflict[];
  readonly metrics: ConflictMetrics;
  readonly version: string;
}

export interface ConflictDetectionOptions {
  readonly minSeparation: number;
  /** distance < minSeparation * criticalFactor => "critical". Default 0.5. */
  readonly criticalFactor?: number;
  /** Ignore pairs where BOTH drones are parked on the ground. Default true. */
  readonly ignoreGrounded?: boolean;
  /** Safety valve for pathological inputs. Default 2000. */
  readonly maxConflicts?: number;
}

export interface ClosestApproach {
  /** Absolute time of the closest approach, clamped to the interval. */
  readonly t: number;
  readonly distance: number;
}

/**
 * Analytic closest approach of two points moving LINEARLY from (a0,b0) at t0 to
 * (a1,b1) at t0+dt.
 *
 *   r(s)   = r0 + vRel * s,  s in [0, dt],  r0 = a0 - b0
 *   s*     = -dot(r0, vRel) / |vRel|^2      (clamped to [0, dt])
 */
export function closestApproachOnInterval(
  a0: Vector3Tuple,
  a1: Vector3Tuple,
  b0: Vector3Tuple,
  b1: Vector3Tuple,
  t0: number,
  dt: number,
): ClosestApproach {
  const r0: [number, number, number] = [a0[0] - b0[0], a0[1] - b0[1], a0[2] - b0[2]];
  const r1: [number, number, number] = [a1[0] - b1[0], a1[1] - b1[1], a1[2] - b1[2]];
  const dv: [number, number, number] = [r1[0] - r0[0], r1[1] - r0[1], r1[2] - r0[2]];
  const vv = dv[0] * dv[0] + dv[1] * dv[1] + dv[2] * dv[2];
  let s = 0;
  if (vv > 1e-12 && dt > 0) {
    const rv = r0[0] * dv[0] + r0[1] * dv[1] + r0[2] * dv[2];
    // dv is expressed over the whole interval, so the normalised optimum is
    // u* = -rv / vv in [0,1] and s* = u* * dt.
    const u = Math.max(0, Math.min(1, -rv / vv));
    s = u * dt;
    const rx = r0[0] + dv[0] * u;
    const ry = r0[1] + dv[1] * u;
    const rz = r0[2] + dv[2] * u;
    return { t: t0 + s, distance: Math.hypot(rx, ry, rz) };
  }
  return { t: t0, distance: Math.hypot(r0[0], r0[1], r0[2]) };
}

interface PairState {
  indexA: number;
  indexB: number;
  minDistance: number;
  tClosest: number;
  positionA: Vector3Tuple;
  positionB: Vector3Tuple;
  startTime: number;
  endTime: number;
}

function frameData(set: TrajectorySet, k: number): { positions: Vector3Tuple[]; t: number } {
  const positions: Vector3Tuple[] = set.drones.map(
    (d) => d.samples[k]?.position ?? ([0, 0, 0] as const),
  );
  const t = set.drones[0]?.samples[k]?.t ?? k / set.sampleRate;
  return { positions, t };
}

function grounded(p: Vector3Tuple): boolean {
  return p[1] < GROUNDED_ALTITUDE;
}

function buildReport(
  pairs: Map<string, PairState>,
  set: TrajectorySet,
  options: ConflictDetectionOptions,
  stats: { minimumSeparation: number; frames: number; intervals: number; candidates: number; ms: number },
): ConflictReport {
  const required = options.minSeparation;
  const criticalFactor = options.criticalFactor ?? 0.5;
  const max = options.maxConflicts ?? 2000;
  const idOf = (i: number) => set.drones[i]?.droneId ?? `#${i}`;

  const conflicts: TrajectoryConflict[] = [...pairs.values()]
    .filter((p) => p.minDistance < required)
    .sort((a, b) => a.minDistance - b.minDistance || a.indexA - b.indexA || a.indexB - b.indexB)
    .slice(0, max)
    .map((p) => ({
      id: `cf-${p.indexA}-${p.indexB}`,
      droneA: idOf(p.indexA),
      droneB: idOf(p.indexB),
      indexA: p.indexA,
      indexB: p.indexB,
      startTime: p.startTime,
      endTime: p.endTime,
      timeOfClosestApproach: p.tClosest,
      minDistance: p.minDistance,
      requiredDistance: required,
      severity: p.minDistance < required * criticalFactor ? "critical" : "warning",
      positionA: p.positionA,
      positionB: p.positionB,
    }));

  const times = conflicts.map((c) => c.timeOfClosestApproach);
  return {
    conflictCount: conflicts.length,
    criticalCount: conflicts.filter((c) => c.severity === "critical").length,
    warningCount: conflicts.filter((c) => c.severity === "warning").length,
    minimumSeparation: required,
    conflicts,
    metrics: {
      minimumSeparation: Number.isFinite(stats.minimumSeparation) ? stats.minimumSeparation : 0,
      uniqueConflictPairs: conflicts.length,
      firstConflictTime: times.length > 0 ? Math.min(...times) : null,
      lastConflictTime: times.length > 0 ? Math.max(...times) : null,
      framesChecked: stats.frames,
      intervalsChecked: stats.intervals,
      candidatePairsChecked: stats.candidates,
      detectorMs: stats.ms,
      method: "spatial-hash + analytic interval closest approach",
    },
    version: CONFLICT_DETECTION_VERSION,
  };
}

function record(
  pairs: Map<string, PairState>,
  i: number,
  j: number,
  approach: ClosestApproach,
  pa: Vector3Tuple,
  pb: Vector3Tuple,
  required: number,
) {
  const key = `${i}|${j}`;
  const existing = pairs.get(key);
  if (!existing) {
    pairs.set(key, {
      indexA: i,
      indexB: j,
      minDistance: approach.distance,
      tClosest: approach.t,
      positionA: pa,
      positionB: pb,
      startTime: approach.distance < required ? approach.t : Infinity,
      endTime: approach.distance < required ? approach.t : -Infinity,
    });
    return;
  }
  if (approach.distance < existing.minDistance) {
    existing.minDistance = approach.distance;
    existing.tClosest = approach.t;
    existing.positionA = pa;
    existing.positionB = pb;
  }
  if (approach.distance < required) {
    existing.startTime = Math.min(existing.startTime, approach.t);
    existing.endTime = Math.max(existing.endTime, approach.t);
  }
}

/** Spatial-hash accelerated detector. Primary implementation. */
export function detectConflicts(
  set: TrajectorySet,
  options: ConflictDetectionOptions,
): ConflictReport {
  const t0 = now();
  const required = options.minSeparation;
  const ignoreGrounded = options.ignoreGrounded ?? true;
  const frames = set.drones[0]?.samples.length ?? 0;
  const pairs = new Map<string, PairState>();
  let minimumSeparation = Infinity;
  let candidates = 0;
  let intervals = 0;

  for (let k = 0; k + 1 < frames; k++) {
    const a = frameData(set, k);
    const b = frameData(set, k + 1);
    const dt = Math.max(1e-9, b.t - a.t);
    let maxStep = 0;
    for (let i = 0; i < a.positions.length; i++) {
      const p = a.positions[i]!;
      const q = b.positions[i]!;
      const step = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (step > maxStep) maxStep = step;
    }
    const cell = required + 2 * maxStep;
    intervals++;
    for (const [i, j] of neighbourPairs(a.positions, cell)) {
      const a0 = a.positions[i]!;
      const b0 = a.positions[j]!;
      const a1 = b.positions[i]!;
      const b1 = b.positions[j]!;
      if (ignoreGrounded && grounded(a0) && grounded(b0) && grounded(a1) && grounded(b1)) continue;
      candidates++;
      const approach = closestApproachOnInterval(a0, a1, b0, b1, a.t, dt);
      if (approach.distance < minimumSeparation) minimumSeparation = approach.distance;
      record(pairs, i, j, approach, a0, b0, required);
    }
  }

  return buildReport(pairs, set, options, {
    minimumSeparation,
    frames,
    intervals,
    candidates,
    ms: now() - t0,
  });
}

/**
 * TEST-ONLY reference implementation: all pairs, every interval, same analytic
 * closest-approach maths. Used to prove the spatial-hash detector agrees.
 */
export function detectConflictsBruteForce(
  set: TrajectorySet,
  options: ConflictDetectionOptions,
): ConflictReport {
  const t0 = now();
  const required = options.minSeparation;
  const ignoreGrounded = options.ignoreGrounded ?? true;
  const frames = set.drones[0]?.samples.length ?? 0;
  const n = set.drones.length;
  const pairs = new Map<string, PairState>();
  let minimumSeparation = Infinity;
  let candidates = 0;
  let intervals = 0;

  for (let k = 0; k + 1 < frames; k++) {
    const a = frameData(set, k);
    const b = frameData(set, k + 1);
    const dt = Math.max(1e-9, b.t - a.t);
    intervals++;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a0 = a.positions[i]!;
        const b0 = a.positions[j]!;
        const a1 = b.positions[i]!;
        const b1 = b.positions[j]!;
        if (ignoreGrounded && grounded(a0) && grounded(b0) && grounded(a1) && grounded(b1)) continue;
        candidates++;
        const approach = closestApproachOnInterval(a0, a1, b0, b1, a.t, dt);
        if (approach.distance < minimumSeparation) minimumSeparation = approach.distance;
        record(pairs, i, j, approach, a0, b0, required);
      }
    }
  }

  return buildReport(pairs, set, options, {
    minimumSeparation,
    frames,
    intervals,
    candidates,
    ms: now() - t0,
  });
}

export interface ConflictGroup {
  readonly id: number;
  /** Drone indices, ascending. */
  readonly indices: number[];
  readonly droneIds: string[];
}

/**
 * Connected components of the conflict graph: if A conflicts with B and B with
 * C, then {A,B,C} form one group. Deterministic: groups and members are sorted
 * by ascending drone index.
 */
export function buildConflictGroups(
  conflicts: readonly TrajectoryConflict[],
): ConflictGroup[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = parent.get(x) ?? x;
    if (r !== x) {
      r = find(r);
      parent.set(x, r);
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  const ids = new Map<number, string>();
  for (const c of conflicts) {
    parent.set(c.indexA, parent.get(c.indexA) ?? c.indexA);
    parent.set(c.indexB, parent.get(c.indexB) ?? c.indexB);
    ids.set(c.indexA, c.droneA);
    ids.set(c.indexB, c.droneB);
    union(c.indexA, c.indexB);
  }
  const buckets = new Map<number, number[]>();
  for (const key of [...parent.keys()].sort((a, b) => a - b)) {
    const root = find(key);
    const arr = buckets.get(root);
    if (arr) arr.push(key);
    else buckets.set(root, [key]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([root, indices], i) => ({
      id: i,
      indices: indices.sort((a, b) => a - b),
      droneIds: indices.map((idx) => ids.get(idx) ?? `#${idx}`),
      _root: root,
    }))
    .map(({ id, indices, droneIds }) => ({ id, indices, droneIds }));
}

/** 2D segment intersection test in the horizontal (XZ) plane. */
function segmentsIntersectXZ(
  p1: Vector3Tuple,
  p2: Vector3Tuple,
  p3: Vector3Tuple,
  p4: Vector3Tuple,
): boolean {
  const d = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  const r = [p2[0] - p1[0], p2[2] - p1[2]] as const;
  const s = [p4[0] - p3[0], p4[2] - p3[2]] as const;
  const denom = d(r[0], r[1], s[0], s[1]);
  if (Math.abs(denom) < 1e-12) return false; // parallel / degenerate
  const qp = [p3[0] - p1[0], p3[2] - p1[2]] as const;
  const t = d(qp[0], qp[1], s[0], s[1]) / denom;
  const u = d(qp[0], qp[1], r[0], r[1]) / denom;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

/**
 * DESIGN METRIC — approximate number of "potential geometric crossings":
 * straight source->target segment pairs whose horizontal projections intersect.
 *
 * A geometric crossing is NOT a collision and NOT a conflict: two paths can
 * cross the same point at different times, or at different altitudes, entirely
 * safely. Always label this as "potential geometric crossings".
 */
export function countPotentialGeometricCrossings(
  from: readonly Vector3Tuple[],
  to: readonly Vector3Tuple[],
): number {
  const n = Math.min(from.length, to.length);
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (segmentsIntersectXZ(from[i]!, to[i]!, from[j]!, to[j]!)) count++;
    }
  }
  return count;
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
