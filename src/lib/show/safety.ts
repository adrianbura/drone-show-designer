/**
 * Safety Validation Engine.
 *
 * Checks the sampled show against the fleet's flight envelope: separation,
 * velocity, acceleration, yaw rate (derived from heading change along the
 * path), altitude ceiling, show-area containment, and takeoff/landing sanity.
 *
 * Separation uses a uniform spatial hash so the pass stays near-linear at
 * 200+ drones instead of O(n^2) per frame.
 */
import type { ShowProject, Vec3 } from "./types";
import { sampleTimeline, type ResolvedClip } from "./trajectory";

export type Severity = "critical" | "warning" | "ok";

export interface SafetyIssue {
  id: string;
  severity: Severity;
  category: "separation" | "velocity" | "acceleration" | "yaw" | "altitude" | "area" | "takeoff";
  message: string;
  time: number;
  drones: number[];
  value: number;
  limit: number;
}

export interface SafetyReport {
  issues: SafetyIssue[];
  worst: {
    minSeparation: number;
    maxVelocity: number;
    maxAcceleration: number;
    maxYawRate: number;
    maxAltitude: number;
  };
  frames: number;
  status: Severity;
}

const dist = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function neighbourPairs(positions: Vec3[], cell: number): [number, number][] {
  const buckets = new Map<string, number[]>();
  const key = (p: Vec3) =>
    `${Math.floor(p[0] / cell)}:${Math.floor(p[1] / cell)}:${Math.floor(p[2] / cell)}`;
  positions.forEach((p, i) => {
    const k = key(p);
    const arr = buckets.get(k);
    if (arr) arr.push(i);
    else buckets.set(k, [i]);
  });
  const pairs: [number, number][] = [];
  positions.forEach((p, i) => {
    const cx = Math.floor(p[0] / cell);
    const cy = Math.floor(p[1] / cell);
    const cz = Math.floor(p[2] / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of buckets.get(`${cx + dx}:${cy + dy}:${cz + dz}`) ?? []) {
            if (j > i) pairs.push([i, j]);
          }
        }
  });
  return pairs;
}

export function validateShow(
  project: ShowProject,
  resolved: ResolvedClip[],
  dt = 0.2,
): SafetyReport {
  const frames = sampleTimeline(project, resolved, dt);
  const { limits, area } = project;
  const issues: SafetyIssue[] = [];
  const worst = {
    minSeparation: Infinity,
    maxVelocity: 0,
    maxAcceleration: 0,
    maxYawRate: 0,
    maxAltitude: 0,
  };
  const seen = new Set<string>();
  const push = (issue: SafetyIssue) => {
    const k = `${issue.category}:${issue.drones.join("-")}`;
    if (seen.has(k)) return;
    seen.add(k);
    issues.push(issue);
  };

  let prevVel: Vec3[] = [];
  let prevHeading: number[] = [];

  frames.forEach((frame, fi) => {
    const prev = frames[fi - 1]?.positions;
    const vel: Vec3[] = [];
    const heading: number[] = [];

    frame.positions.forEach((p, i) => {
      worst.maxAltitude = Math.max(worst.maxAltitude, p[1]);
      if (p[1] > limits.maxAltitude + 0.01) {
        push({
          id: `alt-${i}-${fi}`,
          severity: "critical",
          category: "altitude",
          message: `Drone ${i + 1} exceeds altitude ceiling (${p[1].toFixed(1)} m)`,
          time: frame.t,
          drones: [i],
          value: p[1],
          limit: limits.maxAltitude,
        });
      }
      if (Math.abs(p[0]) > area.width / 2 + 0.01 || Math.abs(p[2]) > area.depth / 2 + 0.01) {
        push({
          id: `area-${i}-${fi}`,
          severity: "critical",
          category: "area",
          message: `Drone ${i + 1} leaves the show area`,
          time: frame.t,
          drones: [i],
          value: Math.max(Math.abs(p[0]), Math.abs(p[2])),
          limit: Math.min(area.width, area.depth) / 2,
        });
      }

      const q = prev?.[i];
      const v: Vec3 = q ? [(p[0] - q[0]) / dt, (p[1] - q[1]) / dt, (p[2] - q[2]) / dt] : [0, 0, 0];
      vel.push(v);
      const speed = Math.hypot(v[0], v[1], v[2]);
      worst.maxVelocity = Math.max(worst.maxVelocity, speed);
      if (speed > limits.maxVelocity) {
        push({
          id: `vel-${i}-${fi}`,
          severity: "critical",
          category: "velocity",
          message: `Drone ${i + 1} exceeds max velocity (${speed.toFixed(1)} m/s)`,
          time: frame.t,
          drones: [i],
          value: speed,
          limit: limits.maxVelocity,
        });
      }

      const pv = prevVel[i];
      if (pv) {
        const acc = Math.hypot((v[0] - pv[0]) / dt, (v[1] - pv[1]) / dt, (v[2] - pv[2]) / dt);
        worst.maxAcceleration = Math.max(worst.maxAcceleration, acc);
        if (acc > limits.maxAcceleration) {
          push({
            id: `acc-${i}-${fi}`,
            severity: "warning",
            category: "acceleration",
            message: `Drone ${i + 1} exceeds max acceleration (${acc.toFixed(1)} m/s²)`,
            time: frame.t,
            drones: [i],
            value: acc,
            limit: limits.maxAcceleration,
          });
        }
      }

      const h = speed > 0.05 ? (Math.atan2(v[2], v[0]) * 180) / Math.PI : (prevHeading[i] ?? 0);
      heading.push(h);
      const ph = prevHeading[i];
      if (ph !== undefined && speed > 0.2) {
        let d = Math.abs(h - ph) % 360;
        if (d > 180) d = 360 - d;
        const rate = d / dt;
        worst.maxYawRate = Math.max(worst.maxYawRate, rate);
        if (rate > limits.maxYawRate) {
          push({
            id: `yaw-${i}-${fi}`,
            severity: "warning",
            category: "yaw",
            message: `Drone ${i + 1} exceeds max yaw rate (${rate.toFixed(0)} °/s)`,
            time: frame.t,
            drones: [i],
            value: rate,
            limit: limits.maxYawRate,
          });
        }
      }
    });

    for (const [i, j] of neighbourPairs(frame.positions, Math.max(1, limits.minSeparation))) {
      const d = dist(frame.positions[i]!, frame.positions[j]!);
      if (frame.positions[i]![1] < 0.5 && frame.positions[j]![1] < 0.5) continue; // parked on ground
      worst.minSeparation = Math.min(worst.minSeparation, d);
      if (d < limits.minSeparation) {
        push({
          id: `sep-${i}-${j}-${fi}`,
          severity: d < limits.minSeparation * 0.5 ? "critical" : "warning",
          category: "separation",
          message: `Drones ${i + 1} & ${j + 1} within ${d.toFixed(2)} m`,
          time: frame.t,
          drones: [i, j],
          value: d,
          limit: limits.minSeparation,
        });
      }
    }

    prevVel = vel;
    prevHeading = heading;
  });

  const last = frames[frames.length - 1]?.positions ?? [];
  if (last.some((p) => p[1] > 0.5)) {
    push({
      id: "landing",
      severity: "warning",
      category: "takeoff",
      message: "Show does not end with all drones landed — add a landing formation",
      time: frames[frames.length - 1]?.t ?? 0,
      drones: [],
      value: 0,
      limit: 0,
    });
  }

  const status: Severity = issues.some((i) => i.severity === "critical")
    ? "critical"
    : issues.length > 0
      ? "warning"
      : "ok";

  return {
    issues: issues.slice(0, 200).sort((a, b) => a.time - b.time),
    worst: { ...worst, minSeparation: Number.isFinite(worst.minSeparation) ? worst.minSeparation : 0 },
    frames: frames.length,
    status,
  };
}
