/**
 * SAFETY VALIDATION ENGINE
 *
 * IMPORTANT — what this engine does and does NOT mean:
 *   It answers exactly one question: "does this planned trajectory set satisfy
 *   the configured safety profile?" A passing report means
 *   "VALIDATED AGAINST CURRENT SAFETY PROFILE" — it is NOT a statement that the
 *   flight is safe in real-world operation. It models no wind, GPS error,
 *   battery state, hardware failure, airspace, crowd or regulatory constraint,
 *   and it is not flight control.
 *
 * The validator consumes a TrajectorySet and never computes flight behaviour
 * itself: velocity/acceleration/jerk/yaw all come from the trajectory samples
 * produced by the planner + sampler.
 *
 * Separation uses a uniform spatial hash (near-linear at 200+ drones). A
 * brute-force reference implementation lives here too and is used by tests to
 * prove the optimisation agrees with O(N^2) truth.
 */
import type { DroneDefinition } from "./drones";
import { droneIdForIndex } from "./drones";
import type { SafetyLimits, ShowArea, ShowProject, Vector3Tuple } from "./types";
import type { TrajectorySet } from "./trajectory/types";

export type Severity = "critical" | "warning" | "ok";

export type SafetyCategory =
  | "separation"
  | "velocity"
  | "acceleration"
  | "jerk"
  | "yaw"
  | "altitude"
  | "area"
  | "sample"
  | "takeoff";

export interface SafetyIssue {
  id: string;
  severity: Severity;
  category: SafetyCategory;
  metric: string;
  message: string;
  /** Seconds from show start where the violation occurs. */
  time: number;
  /** Drone indices (render/lookup) — identity is `droneIds`. */
  drones: number[];
  droneIds: string[];
  value: number;
  limit: number;
}

export interface SafetyMetrics {
  minSeparation: number;
  maxVelocity: number;
  maxAcceleration: number;
  maxJerk: number;
  maxYawRate: number;
  minAltitude: number;
  maxAltitude: number;
  boundaryViolations: number;
  invalidSamples: number;
}

export interface DroneSafetyReport {
  droneId: string;
  index: number;
  maxVelocity: number;
  maxAcceleration: number;
  maxJerk: number;
  maxYawRate: number;
  minAltitude: number;
  maxAltitude: number;
  issues: number;
}

export interface PairSafetyReport {
  droneIds: [string, string];
  minSeparation: number;
  time: number;
}

export interface SafetyReport {
  status: Severity;
  /** Combined, time-sorted list (errors first by severity). */
  issues: SafetyIssue[];
  errors: SafetyIssue[];
  warnings: SafetyIssue[];
  metrics: SafetyMetrics;
  droneReports: DroneSafetyReport[];
  pairReports: PairSafetyReport[];
  frames: number;
  sampleRate: number;
  /** Legacy field kept so existing UI keeps working. */
  worst: {
    minSeparation: number;
    maxVelocity: number;
    maxAcceleration: number;
    maxYawRate: number;
    maxAltitude: number;
  };
}

const AIRBORNE_ALTITUDE = 0.5;

const dist = (a: Vector3Tuple, b: Vector3Tuple) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Uniform spatial hash: candidate pairs within one cell radius. */
export function neighbourPairs(positions: readonly Vector3Tuple[], cell: number): [number, number][] {
  const size = Math.max(0.05, cell);
  const buckets = new Map<string, number[]>();
  const key = (p: Vector3Tuple) =>
    `${Math.floor(p[0] / size)}:${Math.floor(p[1] / size)}:${Math.floor(p[2] / size)}`;
  positions.forEach((p, i) => {
    const k = key(p);
    const arr = buckets.get(k);
    if (arr) arr.push(i);
    else buckets.set(k, [i]);
  });
  const pairs: [number, number][] = [];
  positions.forEach((p, i) => {
    const cx = Math.floor(p[0] / size);
    const cy = Math.floor(p[1] / size);
    const cz = Math.floor(p[2] / size);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const j of buckets.get(`${cx + dx}:${cy + dy}:${cz + dz}`) ?? []) {
            if (j > i) pairs.push([i, j]);
          }
  });
  return pairs;
}

/** Spatial-hash separation scan for one frame. */
export function separationViolations(
  positions: readonly Vector3Tuple[],
  minSeparation: number,
): { i: number; j: number; distance: number }[] {
  const out: { i: number; j: number; distance: number }[] = [];
  for (const [i, j] of neighbourPairs(positions, minSeparation)) {
    const a = positions[i]!;
    const b = positions[j]!;
    if (a[1] < AIRBORNE_ALTITUDE && b[1] < AIRBORNE_ALTITUDE) continue; // both parked
    const d = dist(a, b);
    if (d < minSeparation) out.push({ i, j, distance: d });
  }
  return out.sort((x, y) => x.i - y.i || x.j - y.j);
}

/** TEST-ONLY reference implementation: naive O(N^2). Not used in production. */
export function separationViolationsBruteForce(
  positions: readonly Vector3Tuple[],
  minSeparation: number,
): { i: number; j: number; distance: number }[] {
  const out: { i: number; j: number; distance: number }[] = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i]!;
      const b = positions[j]!;
      if (a[1] < AIRBORNE_ALTITUDE && b[1] < AIRBORNE_ALTITUDE) continue;
      const d = dist(a, b);
      if (d < minSeparation) out.push({ i, j, distance: d });
    }
  }
  return out.sort((x, y) => x.i - y.i || x.j - y.j);
}

export interface ValidateOptions {
  limits: SafetyLimits;
  area: ShowArea;
  drones?: readonly DroneDefinition[] | undefined;
}

export function validateTrajectorySet(set: TrajectorySet, options: ValidateOptions): SafetyReport {
  const { limits, area } = options;
  const idOf = (i: number) => options.drones?.[i]?.id ?? set.drones[i]?.droneId ?? droneIdForIndex(i);

  const issues: SafetyIssue[] = [];
  const seen = new Set<string>();
  const push = (issue: SafetyIssue) => {
    const k = `${issue.category}:${issue.droneIds.join("-")}`;
    if (seen.has(k)) return;
    seen.add(k);
    issues.push(issue);
  };

  const metrics: SafetyMetrics = {
    minSeparation: Infinity,
    maxVelocity: 0,
    maxAcceleration: 0,
    maxJerk: 0,
    maxYawRate: 0,
    minAltitude: Infinity,
    maxAltitude: 0,
    boundaryViolations: 0,
    invalidSamples: 0,
  };

  const droneReports: DroneSafetyReport[] = set.drones.map((d, i) => ({
    droneId: d.droneId,
    index: i,
    maxVelocity: 0,
    maxAcceleration: 0,
    maxJerk: 0,
    maxYawRate: 0,
    minAltitude: Infinity,
    maxAltitude: 0,
    issues: 0,
  }));

  const frames = set.drones[0]?.samples.length ?? 0;

  set.drones.forEach((drone, i) => {
    const report = droneReports[i]!;
    const id = idOf(i);
    for (const s of drone.samples) {
      const finite =
        Number.isFinite(s.position[0]) &&
        Number.isFinite(s.position[1]) &&
        Number.isFinite(s.position[2]) &&
        Number.isFinite(s.velocity[0]) &&
        Number.isFinite(s.acceleration[0]) &&
        Number.isFinite(s.jerk[0]) &&
        Number.isFinite(s.yaw) &&
        Number.isFinite(s.yawRate);
      if (!finite) {
        metrics.invalidSamples++;
        push({
          id: `sample-${i}`,
          severity: "critical",
          category: "sample",
          metric: "sampleValidity",
          message: `${id} has a non-finite trajectory sample`,
          time: s.t,
          drones: [i],
          droneIds: [id],
          value: 0,
          limit: 0,
        });
        report.issues++;
        continue;
      }

      const alt = s.position[1];
      report.maxAltitude = Math.max(report.maxAltitude, alt);
      report.minAltitude = Math.min(report.minAltitude, alt);
      metrics.maxAltitude = Math.max(metrics.maxAltitude, alt);
      metrics.minAltitude = Math.min(metrics.minAltitude, alt);
      if (alt > limits.maxAltitude + 0.01) {
        push({
          id: `alt-${i}`,
          severity: "critical",
          category: "altitude",
          metric: "maxAltitude",
          message: `${id} exceeds altitude ceiling (${alt.toFixed(1)} m)`,
          time: s.t,
          drones: [i],
          droneIds: [id],
          value: alt,
          limit: limits.maxAltitude,
        });
        report.issues++;
      }
      if (alt < -0.01) {
        push({
          id: `below-${i}`,
          severity: "critical",
          category: "altitude",
          metric: "minAltitude",
          message: `${id} goes below ground (${alt.toFixed(2)} m)`,
          time: s.t,
          drones: [i],
          droneIds: [id],
          value: alt,
          limit: 0,
        });
        report.issues++;
      }

      if (Math.abs(s.position[0]) > area.width / 2 + 0.01 || Math.abs(s.position[2]) > area.depth / 2 + 0.01) {
        metrics.boundaryViolations++;
        push({
          id: `area-${i}`,
          severity: "critical",
          category: "area",
          metric: "boundary",
          message: `${id} leaves the show area`,
          time: s.t,
          drones: [i],
          droneIds: [id],
          value: Math.max(Math.abs(s.position[0]), Math.abs(s.position[2])),
          limit: Math.min(area.width, area.depth) / 2,
        });
        report.issues++;
      }

      const speed = Math.hypot(s.velocity[0], s.velocity[1], s.velocity[2]);
      report.maxVelocity = Math.max(report.maxVelocity, speed);
      metrics.maxVelocity = Math.max(metrics.maxVelocity, speed);
      if (speed > limits.maxVelocity) {
        push({
          id: `vel-${i}`,
          severity: "critical",
          category: "velocity",
          metric: "maxVelocity",
          message: `${id} exceeds max velocity (${speed.toFixed(1)} m/s)`,
          time: s.t,
          drones: [i],
          droneIds: [id],
          value: speed,
          limit: limits.maxVelocity,
        });
        report.issues++;
      }

      const acc = Math.hypot(s.acceleration[0], s.acceleration[1], s.acceleration[2]);
      report.maxAcceleration = Math.max(report.maxAcceleration, acc);
      metrics.maxAcceleration = Math.max(metrics.maxAcceleration, acc);
      if (acc > limits.maxAcceleration) {
        push({
          id: `acc-${i}`,
          severity: "warning",
          category: "acceleration",
          metric: "maxAcceleration",
          message: `${id} exceeds max acceleration (${acc.toFixed(1)} m/s²)`,
          time: s.t,
          drones: [i],
          droneIds: [id],
          value: acc,
          limit: limits.maxAcceleration,
        });
        report.issues++;
      }

      const jerk = Math.hypot(s.jerk[0], s.jerk[1], s.jerk[2]);
      report.maxJerk = Math.max(report.maxJerk, jerk);
      metrics.maxJerk = Math.max(metrics.maxJerk, jerk);
      if (jerk > limits.maxJerk) {
        push({
          id: `jerk-${i}`,
          severity: "warning",
          category: "jerk",
          metric: "maxJerk",
          message: `${id} exceeds max jerk (${jerk.toFixed(1)} m/s³)`,
          time: s.t,
          drones: [i],
          droneIds: [id],
          value: jerk,
          limit: limits.maxJerk,
        });
        report.issues++;
      }

      const yawRate = Math.abs(s.yawRate);
      report.maxYawRate = Math.max(report.maxYawRate, yawRate);
      metrics.maxYawRate = Math.max(metrics.maxYawRate, yawRate);
      if (yawRate > limits.maxYawRate) {
        push({
          id: `yaw-${i}`,
          severity: "warning",
          category: "yaw",
          metric: "maxYawRate",
          message: `${id} exceeds max yaw rate (${yawRate.toFixed(0)} °/s)`,
          time: s.t,
          drones: [i],
          droneIds: [id],
          value: yawRate,
          limit: limits.maxYawRate,
        });
        report.issues++;
      }
    }
  });

  // Separation: frame-wise spatial hash across the whole set.
  const pairWorst = new Map<string, PairSafetyReport>();
  for (let k = 0; k < frames; k++) {
    const positions: Vector3Tuple[] = set.drones.map(
      (d) => d.samples[k]?.position ?? ([0, 0, 0] as const),
    );
    const t = set.drones[0]?.samples[k]?.t ?? k / set.sampleRate;
    for (const { i, j, distance } of separationViolations(positions, limits.minSeparation)) {
      metrics.minSeparation = Math.min(metrics.minSeparation, distance);
      const ids: [string, string] = [idOf(i), idOf(j)];
      const key = ids.join("|");
      const existing = pairWorst.get(key);
      if (!existing || distance < existing.minSeparation) {
        pairWorst.set(key, { droneIds: ids, minSeparation: distance, time: t });
      }
      push({
        id: `sep-${i}-${j}`,
        severity: distance < limits.minSeparation * 0.5 ? "critical" : "warning",
        category: "separation",
        metric: "minSeparation",
        message: `${ids[0]} & ${ids[1]} within ${distance.toFixed(2)} m`,
        time: t,
        drones: [i, j],
        droneIds: ids,
        value: distance,
        limit: limits.minSeparation,
      });
      droneReports[i]!.issues++;
      droneReports[j]!.issues++;
    }
    // Track true minimum separation even when no violation occurred.
    if (k % Math.max(1, Math.round(set.sampleRate)) === 0) {
      for (const [i, j] of neighbourPairs(positions, limits.minSeparation)) {
        const a = positions[i]!;
        const b = positions[j]!;
        if (a[1] < AIRBORNE_ALTITUDE && b[1] < AIRBORNE_ALTITUDE) continue;
        metrics.minSeparation = Math.min(metrics.minSeparation, dist(a, b));
      }
    }
  }

  const lastIndex = frames - 1;
  const notLanded = set.drones.filter((d) => (d.samples[lastIndex]?.position[1] ?? 0) > 0.5);
  if (notLanded.length > 0) {
    push({
      id: "landing",
      severity: "warning",
      category: "takeoff",
      metric: "landingAltitude",
      message: `Show does not end with all drones landed (${notLanded.length} airborne) — add a LANDING phase clip`,
      time: set.duration,
      drones: [],
      droneIds: notLanded.map((d) => d.droneId),
      value: notLanded.length,
      limit: 0,
    });
  }

  const errors = issues.filter((i) => i.severity === "critical");
  const warnings = issues.filter((i) => i.severity === "warning");
  const status: Severity = errors.length > 0 ? "critical" : warnings.length > 0 ? "warning" : "ok";

  const finiteMin = (v: number) => (Number.isFinite(v) ? v : 0);

  return {
    status,
    issues: issues.slice(0, 400).sort((a, b) => a.time - b.time),
    errors,
    warnings,
    metrics: {
      ...metrics,
      minSeparation: finiteMin(metrics.minSeparation),
      minAltitude: finiteMin(metrics.minAltitude),
    },
    droneReports: droneReports.map((r) => ({ ...r, minAltitude: finiteMin(r.minAltitude) })),
    pairReports: [...pairWorst.values()].sort((a, b) => a.minSeparation - b.minSeparation).slice(0, 100),
    frames,
    sampleRate: set.sampleRate,
    worst: {
      minSeparation: finiteMin(metrics.minSeparation),
      maxVelocity: metrics.maxVelocity,
      maxAcceleration: metrics.maxAcceleration,
      maxYawRate: metrics.maxYawRate,
      maxAltitude: metrics.maxAltitude,
    },
  };
}

/** Convenience wrapper: validates a set against a project's safety profile. */
export function validateShow(
  project: ShowProject,
  set: TrajectorySet,
  drones?: readonly DroneDefinition[],
): SafetyReport {
  return validateTrajectorySet(set, { limits: project.limits, area: project.area, drones });
}
