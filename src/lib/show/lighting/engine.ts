/**
 * LIGHTING ENGINE — per-drone LED sampling (pure, deterministic).
 *
 * CANONICAL LIGHTING PIPELINE (single path, no parallel lighting systems):
 *
 *   BASE FORMATION COLOUR            clip colour + legacy per-index LightEffect
 *          ↓
 *   INSTANCE COLOUR OVERRIDE         scene object `lighting.color`
 *          ↓
 *   LIGHTING EFFECT STACK            this module (ordered, blended)
 *          ↓
 *   RESERVE / PARTICIPATION POLICY   reserve lighting scale (Sprint 7.3)
 *          ↓
 *   FINAL PER-DRONE LED SAMPLE       { r, g, b, intensity }
 *
 * BASE COLOUR PRECEDENCE (most specific wins):
 *   scene object lighting.color  >  clip colour/effect  >  idle colour
 *
 * TARGET SEMANTICS
 *   Artistic effects only reach ACTIVE_FORMATION drones of the targeted scene /
 *   scene object. RESERVE / PREPOSITION / HOLD drones are lit exclusively by the
 *   participation lighting policy (default OFF) and are never illuminated by an
 *   artistic effect.
 *
 * Lighting NEVER reads or writes positions: it consumes positions as input.
 */
import { droneIdForIndex } from "../drones";
import { lightColorAt } from "../lights";
import {
  participationOf,
  reserveLightingScale,
  resolveParticipationSettings,
  type FleetParticipationPlan,
} from "../participation";
import { sceneForClip } from "../scene/migrate";
import { activeClipAt } from "../timeline";
import type { RGB, ShowProject, TimelineClip, Vector3Tuple } from "../types";
import { blendContribution, evaluateLightingEffect, sortEffects } from "./evaluate";
import { directionalField, radialField, resolveDirection, type SpatialField } from "./field";
import {
  EMPTY_LIGHTING_PROGRAM,
  clamp01,
  type DroneLightState,
  type LightingEffectInstance,
  type LightingProgram,
} from "./types";

/** One drone as the lighting engine sees it. Positions are INPUT, never output. */
export interface LightingTargetPoint {
  readonly droneIndex: number;
  readonly droneId: string;
  /** Scene object this drone renders, or null when it is not active. */
  readonly instanceId: string | null;
  readonly groupId: string | null;
  readonly active: boolean;
  /** Deterministic scene target position (REFERENCE_SPACE field input). */
  readonly reference: Vector3Tuple;
  /** Live sampled position (WORLD_SPACE field input). */
  readonly world: Vector3Tuple;
  readonly pointId?: string;
  /** Motion group of the drone's point inside a dynamic formation. */
  readonly motionGroupId?: string | null;
  /** Multiplier from the participation reserve lighting policy. */
  readonly reserveScale: number;
  /** Base LED colour after clip + instance precedence. */
  readonly baseColor: RGB;
}

export interface LightingSceneContext {
  readonly clipId: string;
  readonly sceneStart: number;
  /** Moment the formation is physically ready (start + transition). */
  readonly formationReady: number;
  readonly sceneEnd: number;
  readonly points: readonly LightingTargetPoint[];
}

/** Absolute show time an effect starts at, after applying its anchor. */
export function resolveEffectStart(
  effect: LightingEffectInstance,
  scene: { readonly sceneStart: number; readonly formationReady: number; readonly sceneEnd: number },
): number {
  const offset = Number.isFinite(effect.start) ? effect.start : 0;
  switch (effect.anchor) {
    case "SCENE_START":
      return scene.sceneStart + offset;
    case "FORMATION_READY":
      return scene.formationReady + offset;
    case "SCENE_END":
      return scene.sceneEnd + offset;
    case "ABSOLUTE":
    default:
      return offset;
  }
}

export function effectsForClip(
  program: LightingProgram | undefined,
  clipId: string,
): LightingEffectInstance[] {
  return (program?.effects ?? []).filter((e) => e.target.clipId === clipId);
}

function targetsDrone(effect: LightingEffectInstance, point: LightingTargetPoint): boolean {
  if (!point.active) return false;
  switch (effect.target.kind) {
    case "SCENE":
      return true;
    case "SCENE_OBJECT":
      return point.instanceId === effect.target.instanceId;
    case "MOTION_GROUP":
      return (
        point.instanceId === effect.target.instanceId &&
        !!point.motionGroupId &&
        point.motionGroupId === effect.target.groupId
      );
    case "POINT_GROUP":
      return (
        point.instanceId === effect.target.instanceId &&
        !!point.pointId &&
        effect.target.pointIds.includes(point.pointId)
      );
  }
}

function fieldPosition(effect: LightingEffectInstance, point: LightingTargetPoint): Vector3Tuple {
  return (effect.parameters.space ?? "REFERENCE_SPACE") === "WORLD_SPACE"
    ? point.world
    : point.reference;
}

interface PreparedEffect {
  readonly effect: LightingEffectInstance;
  readonly start: number;
  readonly members: readonly LightingTargetPoint[];
  readonly field: SpatialField | null;
  readonly stages: readonly string[][];
}

/**
 * Field bounds are computed over the WHOLE target set, so a scene-level
 * Left -> Right sweep progresses across the combined composition instead of
 * restarting inside every object.
 */
function prepareEffect(
  effect: LightingEffectInstance,
  context: LightingSceneContext,
): PreparedEffect {
  const members = context.points.filter((p) => targetsDrone(effect, p));
  const positions = members.map((p) => fieldPosition(effect, p));
  const params = effect.parameters;
  let field: SpatialField | null = null;
  if (effect.type === "DIRECTIONAL_REVEAL" || effect.type === "COLOR_SWEEP") {
    field = directionalField(positions, resolveDirection(params), params.origin ?? null);
  } else if (effect.type === "RADIAL_REVEAL" || effect.type === "RADIAL_HIDE") {
    field = radialField(positions, params.distanceMode ?? "PLANAR", params.origin ?? null);
  }
  const stages = (params.stages ?? []).map((s) => [...s.groupIds]);
  return { effect, start: resolveEffectStart(effect, context), members, field, stages };
}

/**
 * FINAL PER-DRONE LED SAMPLING. Deterministic: identical project + identical
 * time always yields identical output, and it never mutates its inputs.
 */
export function lightingStatesAt(
  effects: readonly LightingEffectInstance[],
  context: LightingSceneContext,
  t: number,
): DroneLightState[] {
  const prepared = sortEffects(effects.filter((e) => e.enabled).map((e) => prepareEffect(e, context)));
  const memberIndex = prepared.map((p) => new Set(p.members.map((m) => m.droneIndex)));

  return context.points.map((point) => {
    let state: DroneLightState = {
      r: point.baseColor[0],
      g: point.baseColor[1],
      b: point.baseColor[2],
      intensity: 1,
    };
    for (let i = 0; i < prepared.length; i++) {
      const entry = prepared[i]!;
      if (!memberIndex[i]!.has(point.droneIndex)) continue;
      const u = entry.field ? entry.field.valueAt(fieldPosition(entry.effect, point)) : 0;
      const stageIndex = entry.stages.findIndex((ids) => !!point.motionGroupId && ids.includes(point.motionGroupId));
      const contribution = evaluateLightingEffect(entry.effect, {
        t,
        start: entry.start,
        u,
        stageIndex,
        stageCount: entry.stages.length,
      });
      state = blendContribution(state, contribution, entry.effect.blendMode);
    }
    // Participation lighting policy is applied LAST and is independent of the
    // artistic stack (Sprint 7.3 semantics are preserved unchanged).
    return { ...state, intensity: clamp01(state.intensity * point.reserveScale) };
  });
}

export interface ProjectLightingInput {
  readonly project: ShowProject;
  /** Participation plans of the composed show, one per clip. */
  readonly participation?: readonly FleetParticipationPlan[];
  /** Live sampled positions by drone index (optional; reference used if absent). */
  readonly positions?: readonly Vector3Tuple[];
}

/** Builds the lighting context of the clip governing show time `t`. */
export function lightingContextAt(input: ProjectLightingInput, t: number): LightingSceneContext | null {
  const { project } = input;
  const clip: TimelineClip | undefined = activeClipAt(project, t);
  if (!clip) return null;
  const scene = sceneForClip(project, clip);
  const plan = input.participation?.find((p) => p.clipId === clip.id) ?? null;
  const policy = resolveParticipationSettings(project.participation).reserveLighting;
  const instanceByGroup = new Map<string, string>();
  for (const group of plan?.activeGroups ?? []) {
    if (group.instanceId) instanceByGroup.set(group.groupId, group.instanceId);
    else instanceByGroup.set(group.groupId, scene.objects[0]?.id ?? group.groupId);
  }
  // Motion group membership per stable point id, for GROUP_SEQUENCE effects.
  const motionGroupByPoint = new Map<string, string>();
  for (const object of scene.objects) {
    if (object.source.kind !== "DYNAMIC") continue;
    const dynamic = project.dynamicFormations?.find((d) => d.id === object.source.dynamicFormationId);
    for (const group of dynamic?.groups ?? []) {
      for (const id of group.pointIds) motionGroupByPoint.set(id, group.id);
    }
  }

  const points: LightingTargetPoint[] = [];
  for (let index = 0; index < project.droneCount; index++) {
    const participation = plan ? participationOf(plan, index) : undefined;
    const role = participation?.role ?? "ACTIVE_FORMATION";
    const groupId = participation?.groupId ?? null;
    const instanceId = groupId ? (instanceByGroup.get(groupId) ?? null) : (scene.objects[0]?.id ?? null);
    const instance = scene.objects.find((o) => o.id === instanceId);
    const clipColor = lightColorAt(clip, index, project.droneCount, t);
    const baseColor: RGB = instance?.lighting?.color ?? clipColor;
    const reference = participation?.target ?? input.positions?.[index] ?? [0, 0, 0];
    points.push({
      droneIndex: index,
      droneId: droneIdForIndex(index),
      instanceId: role === "ACTIVE_FORMATION" ? instanceId : null,
      groupId,
      active: role === "ACTIVE_FORMATION",
      reference,
      world: input.positions?.[index] ?? reference,
      ...(participation?.formationPointId ? { pointId: participation.formationPointId } : {}),
      motionGroupId: participation?.formationPointId
        ? (motionGroupByPoint.get(participation.formationPointId) ?? null)
        : null,
      reserveScale: reserveLightingScale(role, policy),
      baseColor,
    });
  }

  return {
    clipId: clip.id,
    sceneStart: clip.start,
    formationReady: clip.start + clip.transition,
    sceneEnd: clip.start + clip.transition + clip.hold,
    points,
  };
}

/**
 * Convenience: per-drone LED state of the whole fleet at show time `t`.
 * Drones outside any clip fall back to the idle colour at full intensity, which
 * preserves the pre-7.4 preview behaviour exactly.
 */
export function projectLightingAt(input: ProjectLightingInput, t: number): DroneLightState[] {
  const context = lightingContextAt(input, t);
  const program = input.project.lighting ?? EMPTY_LIGHTING_PROGRAM;
  if (!context) {
    const idle = lightColorAt(undefined, 0, input.project.droneCount, t);
    return Array.from({ length: input.project.droneCount }, () => ({
      r: idle[0],
      g: idle[1],
      b: idle[2],
      intensity: 1,
    }));
  }
  return lightingStatesAt(effectsForClip(program, context.clipId), context, t);
}

/** Final RGB actually emitted by a drone: colour scaled by intensity. */
export function emittedColor(state: DroneLightState): RGB {
  const k = clamp01(state.intensity);
  return [Math.round(state.r * k), Math.round(state.g * k), Math.round(state.b * k)];
}
