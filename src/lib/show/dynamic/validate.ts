/**
 * DESIGN-TIME validation of a dynamic formation.
 *
 * These are QUALITY metrics for the animation itself (spacing, implied speed,
 * envelope, loop continuity), evaluated on the formation point cloud only. They
 * are NOT a safety statement: the SafetyValidator, running on the composed
 * TrajectorySet, remains the only authority on flight limits.
 */
import { neighbourPairs } from "../safety";
import type { SafetyLimits, ShowArea, Vector3Tuple } from "../types";
import { sampleDynamicFormation } from "./sampler";
import {
  DYNAMIC_FORMATION_ALGORITHM_VERSION,
  type DynamicFormation,
  type DynamicFormationIssue,
  type DynamicFormationReport,
} from "./types";

export interface ValidateDynamicOptions {
  readonly limits: SafetyLimits;
  readonly area?: ShowArea;
  /** Samples per second used for the analysis (default 10). */
  readonly sampleRate?: number;
  /** Expected point count (fleet size) — mismatches are reported. */
  readonly expectedPointCount?: number;
}

export function validateDynamicFormation(
  formation: DynamicFormation,
  options: ValidateDynamicOptions,
): DynamicFormationReport {
  const issues: DynamicFormationIssue[] = [];
  const rate = options.sampleRate && options.sampleRate > 0 ? options.sampleRate : 10;
  const duration = formation.duration > 0 ? formation.duration : 0;
  const limits = options.limits;

  if (formation.points.length === 0) {
    issues.push({
      id: "dyn-empty",
      severity: "error",
      code: "EMPTY_POINTS",
      message: "Dynamic formation has no points.",
    });
  }
  if (duration <= 0) {
    issues.push({
      id: "dyn-duration",
      severity: "error",
      code: "INVALID_DURATION",
      message: "Animation duration must be greater than zero.",
    });
  }
  if (
    options.expectedPointCount !== undefined &&
    formation.points.length !== options.expectedPointCount
  ) {
    issues.push({
      id: "dyn-count",
      severity: "error",
      code: "POINT_COUNT_MISMATCH",
      message: `Formation has ${formation.points.length} points but the fleet is ${options.expectedPointCount}.`,
    });
  }

  const known = new Set(formation.points.map((p) => p.id));
  for (const group of formation.groups) {
    if (group.pointIds.length === 0) {
      issues.push({
        id: `dyn-group-empty-${group.id}`,
        severity: "warning",
        code: "GROUP_EMPTY",
        message: `Motion group "${group.name}" has no points.`,
      });
    }
    const unknown = group.pointIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      issues.push({
        id: `dyn-group-unknown-${group.id}`,
        severity: "warning",
        code: "GROUP_UNKNOWN_POINT",
        message: `Motion group "${group.name}" references ${unknown.length} point(s) that no longer exist.`,
        pointIds: unknown.slice(0, 8),
      });
    }
  }

  if (formation.points.length === 0 || duration <= 0) {
    return {
      formationId: formation.id,
      status: "error",
      metrics: {
        pointCount: formation.points.length,
        groupCount: formation.groups.length,
        duration,
        sampledFrames: 0,
        minSpacing: 0,
        maxDisplacement: 0,
        maxPointSpeed: 0,
        maxPointAcceleration: 0,
        minAltitude: 0,
        maxAltitude: 0,
        loopSeamGap: 0,
      },
      issues,
      algorithmVersion: DYNAMIC_FORMATION_ALGORITHM_VERSION,
    };
  }

  const step = 1 / rate;
  const frames = Math.floor(duration * rate) + 1;
  let minSpacing = Number.POSITIVE_INFINITY;
  let minSpacingTime = 0;
  let maxDisplacement = 0;
  let maxSpeed = 0;
  let maxAccel = 0;
  let minAltitude = Number.POSITIVE_INFINITY;
  let maxAltitude = Number.NEGATIVE_INFINITY;
  let previous: Vector3Tuple[] | null = null;
  let previousVelocity: Vector3Tuple[] | null = null;
  const cell = Math.max(0.5, limits.minSeparation);

  for (let k = 0; k < frames; k++) {
    const t = Math.min(duration, k * step);
    const points = sampleDynamicFormation(formation, t);

    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      if (p[1] < minAltitude) minAltitude = p[1];
      if (p[1] > maxAltitude) maxAltitude = p[1];
      const base = formation.points[i]!.base;
      const disp = Math.hypot(p[0] - base[0], p[1] - base[1], p[2] - base[2]);
      if (disp > maxDisplacement) maxDisplacement = disp;
    }

    for (const [a, b] of neighbourPairs(points, cell)) {
      const p = points[a]!;
      const q = points[b]!;
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (d < minSpacing) {
        minSpacing = d;
        minSpacingTime = t;
      }
    }

    const velocity: Vector3Tuple[] = [];
    if (previous) {
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        const q = previous[i]!;
        const v: Vector3Tuple = [(p[0] - q[0]) / step, (p[1] - q[1]) / step, (p[2] - q[2]) / step];
        velocity.push(v);
        const speed = Math.hypot(v[0], v[1], v[2]);
        if (speed > maxSpeed) maxSpeed = speed;
      }
      if (previousVelocity) {
        for (let i = 0; i < velocity.length; i++) {
          const v = velocity[i]!;
          const w = previousVelocity[i]!;
          const acc = Math.hypot((v[0] - w[0]) / step, (v[1] - w[1]) / step, (v[2] - w[2]) / step);
          if (acc > maxAccel) maxAccel = acc;
        }
      }
      previousVelocity = velocity;
    }
    previous = points.slice();
  }

  if (!Number.isFinite(minSpacing)) minSpacing = Number.POSITIVE_INFINITY;

  // Loop seam: with REPEAT the animation jumps from t=duration back to t=0.
  const first = sampleDynamicFormation(formation, 0);
  const last = sampleDynamicFormation(formation, duration);
  let loopSeamGap = 0;
  for (let i = 0; i < first.length; i++) {
    const a = first[i]!;
    const b = last[i]!;
    loopSeamGap = Math.max(loopSeamGap, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }

  if (Number.isFinite(minSpacing) && minSpacing < limits.minSeparation) {
    issues.push({
      id: "dyn-spacing",
      severity: "error",
      code: "SPACING",
      message: `Animated spacing drops to ${minSpacing.toFixed(2)} m (minimum separation ${limits.minSeparation} m).`,
      time: minSpacingTime,
    });
  }
  if (maxSpeed > limits.maxVelocity) {
    issues.push({
      id: "dyn-speed",
      severity: "warning",
      code: "SPEED",
      message: `Animation implies ${maxSpeed.toFixed(1)} m/s, above the ${limits.maxVelocity} m/s envelope. Slow the animation or lower the amplitude.`,
    });
  }
  if (maxAccel > limits.maxAcceleration) {
    issues.push({
      id: "dyn-accel",
      severity: "warning",
      code: "SPEED",
      message: `Animation implies ${maxAccel.toFixed(1)} m/s², above the ${limits.maxAcceleration} m/s² envelope.`,
    });
  }
  if (minAltitude < limits.minAltitude) {
    issues.push({
      id: "dyn-alt-min",
      severity: "error",
      code: "ALTITUDE",
      message: `Animation descends to ${minAltitude.toFixed(1)} m, below the ${limits.minAltitude} m floor.`,
    });
  }
  if (maxAltitude > limits.maxAltitude) {
    issues.push({
      id: "dyn-alt-max",
      severity: "error",
      code: "ALTITUDE",
      message: `Animation reaches ${maxAltitude.toFixed(1)} m, above the ${limits.maxAltitude} m ceiling.`,
    });
  }
  if (options.area) {
    const halfW = options.area.width / 2;
    const halfD = options.area.depth / 2;
    const outside = sampleDynamicFormation(formation, duration / 2).some(
      (p) => Math.abs(p[0]) > halfW || Math.abs(p[2]) > halfD,
    );
    if (outside) {
      issues.push({
        id: "dyn-area",
        severity: "warning",
        code: "AREA",
        message: "Animation leaves the configured show area footprint.",
      });
    }
  }
  if (formation.loop === "REPEAT" && loopSeamGap > 0.5) {
    issues.push({
      id: "dyn-loop-seam",
      severity: "warning",
      code: "LOOP_DISCONTINUITY",
      message: `Loop seam jumps ${loopSeamGap.toFixed(2)} m. Match the last keyframe to the first, or use PING_PONG.`,
    });
  }

  const status: DynamicFormationReport["status"] = issues.some((i) => i.severity === "error")
    ? "error"
    : issues.some((i) => i.severity === "warning")
      ? "warning"
      : "ok";

  return {
    formationId: formation.id,
    status,
    metrics: {
      pointCount: formation.points.length,
      groupCount: formation.groups.length,
      duration,
      sampledFrames: frames,
      minSpacing: Number.isFinite(minSpacing) ? minSpacing : 0,
      maxDisplacement,
      maxPointSpeed: maxSpeed,
      maxPointAcceleration: maxAccel,
      minAltitude: Number.isFinite(minAltitude) ? minAltitude : 0,
      maxAltitude: Number.isFinite(maxAltitude) ? maxAltitude : 0,
      loopSeamGap,
    },
    issues,
    algorithmVersion: DYNAMIC_FORMATION_ALGORITHM_VERSION,
  };
}
