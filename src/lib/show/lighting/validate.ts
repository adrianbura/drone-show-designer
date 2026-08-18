/**
 * LIGHTING VALIDATION + PERSISTENCE SANITISATION.
 *
 * Lighting validation is a SEPARATE, lightweight report: a purely artistic
 * warning is never labelled a flight problem, and lighting edits never make the
 * geometric safety analysis stale (positions/velocities are untouched).
 */
import { clipEnd } from "../timeline";
import type { RGB, ShowProject } from "../types";
import {
  LIGHTING_ALGORITHM_VERSION,
  LIGHTING_BLEND_MODES,
  LIGHTING_ANCHORS,
  LIGHTING_EFFECT_TYPES,
  LIGHTING_SCHEMA_VERSION,
  clampByte,
  type GradientStop,
  type LightingEffectInstance,
  type LightingIssue,
  type LightingProgram,
  type LightingTarget,
  type LightingValidationReport,
} from "./types";

function isColor(value: unknown): value is RGB {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((c) => typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 255)
  );
}

export function validateLightingProgram(project: ShowProject): LightingValidationReport {
  const effects = project.lighting?.effects ?? [];
  const issues: LightingIssue[] = [];
  let n = 0;
  const push = (issue: Omit<LightingIssue, "id">) => issues.push({ id: `lfx-${++n}`, ...issue });

  for (const effect of effects) {
    const clip = project.timeline.find((c) => c.id === effect.target.clipId);
    if (!clip) {
      push({
        severity: "error",
        code: "UNRESOLVED_TARGET",
        message: `Lighting effect ${effect.id} targets a scene that no longer exists.`,
        effectId: effect.id,
      });
      continue;
    }
    if (effect.target.kind !== "SCENE") {
      const scene = project.scenes?.find((s) => s.id === clip.id);
      const instanceId = (effect.target as { instanceId?: string }).instanceId;
      const known = scene?.objects.some((o) => o.id === instanceId);
      if (scene && !known) {
        push({
          severity: "warning",
          code: "UNRESOLVED_TARGET",
          message: `Lighting effect ${effect.id} targets an object that is no longer part of the scene.`,
          effectId: effect.id,
          clipId: clip.id,
        });
      }
    }
    if (!Number.isFinite(effect.start)) {
      push({
        severity: "error",
        code: "INVALID_TIMING",
        message: `Lighting effect ${effect.id} has a non-finite start time.`,
        effectId: effect.id,
        clipId: clip.id,
      });
    }
    if (!Number.isFinite(effect.duration) || effect.duration <= 0) {
      push({
        severity: "error",
        code: "INVALID_DURATION",
        message: `Lighting effect ${effect.id} has an invalid duration.`,
        effectId: effect.id,
        clipId: clip.id,
      });
    }
    const start =
      effect.anchor === "ABSOLUTE"
        ? effect.start
        : effect.anchor === "SCENE_START"
          ? clip.start + effect.start
          : effect.anchor === "FORMATION_READY"
            ? clip.start + clip.transition + effect.start
            : clipEnd(clip) + effect.start;
    if (Number.isFinite(start) && (start < clip.start - 1e-6 || start > clipEnd(clip) + 1e-6)) {
      push({
        severity: "warning",
        code: "OUTSIDE_SCENE_RANGE",
        message: `Lighting effect ${effect.id} starts outside the scene it belongs to.`,
        effectId: effect.id,
        clipId: clip.id,
        time: start,
      });
    }
    const p = effect.parameters;
    for (const [key, value] of Object.entries({ fromColor: p.fromColor, toColor: p.toColor, color: p.color })) {
      if (value !== undefined && !isColor(value)) {
        push({
          severity: "error",
          code: "INVALID_COLOR",
          message: `Lighting effect ${effect.id} has an invalid ${key}.`,
          effectId: effect.id,
          clipId: clip.id,
        });
      }
    }
    for (const stop of p.stops ?? []) {
      if (!isColor(stop.color) || !Number.isFinite(stop.position)) {
        push({
          severity: "error",
          code: "INVALID_COLOR",
          message: `Lighting effect ${effect.id} has an invalid gradient stop.`,
          effectId: effect.id,
          clipId: clip.id,
        });
      }
    }
    for (const [key, value] of Object.entries({
      softness: p.softness,
      intensity: p.intensity,
      minIntensity: p.minIntensity,
      maxIntensity: p.maxIntensity,
    })) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
        push({
          severity: "warning",
          code: "INVALID_PARAMETER",
          message: `Lighting effect ${effect.id} has ${key} outside 0..1 (clamped on evaluation).`,
          effectId: effect.id,
          clipId: clip.id,
        });
      }
    }
    if (effect.type === "PULSE" && p.cycles !== undefined && (!Number.isFinite(p.cycles) || p.cycles < 1)) {
      push({
        severity: "warning",
        code: "INVALID_PARAMETER",
        message: `Lighting effect ${effect.id} has an invalid pulse count.`,
        effectId: effect.id,
        clipId: clip.id,
      });
    }
  }

  return { effectCount: effects.length, issues, algorithmVersion: LIGHTING_ALGORITHM_VERSION };
}

// ---- PERSISTENCE -----------------------------------------------------------
// Projects saved before Sprint 7.4 have no lighting program. Migration never
// invents default effects: absent stays absent (an empty program).

function sanitizeTarget(raw: unknown): LightingTarget | null {
  const value = raw as Partial<LightingTarget> & Record<string, unknown>;
  const clipId = typeof value?.clipId === "string" ? value.clipId : null;
  if (!clipId) return null;
  switch (value.kind) {
    case "SCENE":
      return { kind: "SCENE", clipId };
    case "SCENE_OBJECT":
      return typeof value.instanceId === "string"
        ? { kind: "SCENE_OBJECT", clipId, instanceId: value.instanceId }
        : null;
    case "MOTION_GROUP":
      return typeof value.instanceId === "string" && typeof value.groupId === "string"
        ? { kind: "MOTION_GROUP", clipId, instanceId: value.instanceId, groupId: value.groupId }
        : null;
    case "POINT_GROUP":
      return typeof value.instanceId === "string" && Array.isArray(value.pointIds)
        ? {
            kind: "POINT_GROUP",
            clipId,
            instanceId: value.instanceId,
            pointIds: value.pointIds.filter((id): id is string => typeof id === "string"),
          }
        : null;
    default:
      return null;
  }
}

function sanitizeColor(raw: unknown): RGB | undefined {
  return isColor(raw) ? [clampByte(raw[0]), clampByte(raw[1]), clampByte(raw[2])] : undefined;
}

function sanitizeStops(raw: unknown): GradientStop[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const stops = raw
    .map((s) => {
      const color = sanitizeColor((s as GradientStop)?.color);
      const position = (s as GradientStop)?.position;
      return color && Number.isFinite(position) ? { position: Number(position), color } : null;
    })
    .filter((s): s is GradientStop => !!s);
  return stops.length > 0 ? stops : undefined;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Defensive read of a persisted lighting program. Unknown fields are dropped. */
export function sanitizeLightingProgram(raw: unknown): LightingProgram | undefined {
  const value = raw as Partial<LightingProgram> | undefined;
  if (!value || !Array.isArray(value.effects)) return undefined;
  const effects: LightingEffectInstance[] = [];
  for (const item of value.effects) {
    const effect = item as Partial<LightingEffectInstance> & Record<string, unknown>;
    const target = sanitizeTarget(effect?.target);
    if (!target || typeof effect.id !== "string") continue;
    if (!LIGHTING_EFFECT_TYPES.includes(effect.type as LightingEffectInstance["type"])) continue;
    const raw = (effect.parameters ?? {}) as Record<string, unknown>;
    const g = (key: string): unknown => raw[key];
    const dir = g("direction");
    const org = g("origin");
    const easing = g("easing");
    const distanceMode = g("distanceMode");
    const space = g("space");
    const stages = g("stages");
    const parameters: Record<string, unknown> = {};
    if (easing === "LINEAR" || easing === "SMOOTH" || easing === "MIN_JERK") parameters["easing"] = easing;
    if (Array.isArray(dir) && dir.length === 3) {
      parameters["direction"] = [num(dir[0], 1), num(dir[1], 0), num(dir[2], 0)] as const;
    }
    if (Array.isArray(org) && org.length === 3) {
      parameters["origin"] = [num(org[0], 0), num(org[1], 0), num(org[2], 0)] as const;
    }
    if (distanceMode === "PLANAR" || distanceMode === "SPATIAL") parameters["distanceMode"] = distanceMode;
    if (space === "REFERENCE_SPACE" || space === "WORLD_SPACE") parameters["space"] = space;
    for (const key of [
      "angleDeg",
      "softness",
      "cycles",
      "cycleDuration",
      "minIntensity",
      "maxIntensity",
      "phase",
      "intensity",
      "stageOverlap",
    ]) {
      const value = g(key);
      if (typeof value === "number") parameters[key] = num(value, 0);
    }
    for (const key of ["fromColor", "toColor", "color"]) {
      const color = sanitizeColor(g(key));
      if (color) parameters[key] = color;
    }
    const stops = sanitizeStops(g("stops"));
    if (stops) parameters["stops"] = stops;
    if (Array.isArray(stages)) {
      const clean = (stages as { groupIds?: unknown }[])
        .map((s) => ({
          groupIds: Array.isArray(s?.groupIds)
            ? s.groupIds.filter((id): id is string => typeof id === "string")
            : [],
        }))
        .filter((s) => s.groupIds.length > 0);
      if (clean.length > 0) parameters["stages"] = clean;
    }

    const instance = {
      id: effect.id,
      target,
      type: effect.type as LightingEffectInstance["type"],
      anchor: LIGHTING_ANCHORS.includes(effect.anchor as LightingEffectInstance["anchor"])
        ? (effect.anchor as LightingEffectInstance["anchor"])
        : "SCENE_START",
      start: num(effect.start, 0),
      duration: Math.max(0.01, num(effect.duration, 1)),
      blendMode: LIGHTING_BLEND_MODES.includes(effect.blendMode as LightingEffectInstance["blendMode"])
        ? (effect.blendMode as LightingEffectInstance["blendMode"])
        : "MULTIPLY_INTENSITY",
      priority: num(effect.priority, 0),
      enabled: effect.enabled !== false,
      parameters,
    } as LightingEffectInstance;
    if (effect.metadata && typeof effect.metadata === "object") {
      effects.push({
        ...instance,
        metadata: effect.metadata as NonNullable<LightingEffectInstance["metadata"]>,
      });
    } else {
      effects.push(instance);
    }
  }
  return { schemaVersion: LIGHTING_SCHEMA_VERSION, effects };
}
