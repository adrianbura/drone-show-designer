/**
 * EVERYDAY EFFECT STACK (pure).
 *
 * An ordered stack of lighting effects scoped to the current SELECTION. This is
 * composition over the canonical lighting engine (`src/lib/show/lighting`): the
 * stack only creates, orders, enables and time-scopes `LightingEffectInstance`
 * values. There is no second lighting engine, no second evaluator and no
 * physical drone identity anywhere in this module.
 *
 * Stack order == effect `priority` (higher applies later), so reordering is a
 * pure re-priorisation of existing canonical effects.
 */
import type { RGB } from "../show/types";
import {
  createEffectFromPreset,
  findLightingPreset,
  type LightingEffectInstance,
  type LightingEffectParameters,
  type LightingTarget,
} from "../show/lighting";

/** The six everyday stack entries offered to a normal operator. */
export type EffectStackPresetId = "BASE_COLOR" | "FADE" | "PULSE" | "CHASE" | "TWINKLE" | "GRADIENT";

export const EFFECT_STACK_PRESETS: readonly EffectStackPresetId[] = [
  "BASE_COLOR",
  "FADE",
  "PULSE",
  "CHASE",
  "TWINKLE",
  "GRADIENT",
];

/** i18n label keys — presentation only, identity stays language neutral. */
export const EFFECT_STACK_LABEL_KEYS: Readonly<Record<EffectStackPresetId, string>> = {
  BASE_COLOR: "composer.effect.baseColor",
  FADE: "composer.effect.fade",
  PULSE: "composer.effect.pulse",
  CHASE: "composer.effect.chase",
  TWINKLE: "composer.effect.twinkle",
  GRADIENT: "composer.effect.gradient",
};

/** Everyday preset -> canonical lighting preset id. No new effect types. */
const CANONICAL_PRESET: Readonly<Record<EffectStackPresetId, string>> = {
  BASE_COLOR: "COLOR_TRANSITION",
  FADE: "FADE_IN",
  PULSE: "PULSE_2",
  CHASE: "DIRECTIONAL_SWEEP",
  TWINKLE: "PULSE_4",
  GRADIENT: "COLOR_SWEEP",
};

export interface EffectStackEntryInput {
  readonly preset: EffectStackPresetId;
  /** Seconds relative to the selected scene (anchor SCENE_START). */
  readonly start?: number;
  readonly duration?: number;
  readonly color?: RGB;
  readonly parameters?: LightingEffectParameters;
  readonly idSeed?: number;
}

/**
 * Builds one canonical effect per target. Multi-selection therefore produces N
 * effects that the caller commits as ONE history step.
 */
export function buildStackEffects(
  targets: readonly LightingTarget[],
  input: EffectStackEntryInput,
  existing: readonly LightingEffectInstance[] = [],
): LightingEffectInstance[] {
  const preset = findLightingPreset(CANONICAL_PRESET[input.preset]);
  if (!preset) return [];
  const basePriority = nextPriority(existing);
  const seed = input.idSeed ?? Date.now();
  return targets.map((target, i) => {
    const effect = createEffectFromPreset(preset, target, {
      anchor: "SCENE_START",
      start: Math.max(0, input.start ?? 0),
      priority: basePriority + i,
      idSeed: seed + i,
      parameters: {
        ...(input.color ? colorParameters(input.preset, input.color) : {}),
        ...(input.parameters ?? {}),
      },
    });
    return input.duration && input.duration > 0
      ? { ...effect, duration: input.duration }
      : effect;
  });
}

function colorParameters(preset: EffectStackPresetId, color: RGB): LightingEffectParameters {
  switch (preset) {
    case "BASE_COLOR":
      return { toColor: color };
    case "GRADIENT":
      return {
        stops: [
          { position: 0, color },
          { position: 1, color: [255, 255, 255] },
        ],
      };
    default:
      return { color };
  }
}

export function nextPriority(effects: readonly LightingEffectInstance[]): number {
  return effects.reduce((max, e) => Math.max(max, e.priority + 1), 0);
}

/** Stack order of the effects belonging to a set of targets. */
export function stackOrder(
  effects: readonly LightingEffectInstance[],
): readonly LightingEffectInstance[] {
  return [...effects].sort(
    (a, b) => a.priority - b.priority || a.start - b.start || a.id.localeCompare(b.id),
  );
}

export function setEffectEnabled(
  effects: readonly LightingEffectInstance[],
  effectId: string,
  enabled: boolean,
): LightingEffectInstance[] {
  return effects.map((e) => (e.id === effectId ? { ...e, enabled } : e));
}

export function setEffectTimeScope(
  effects: readonly LightingEffectInstance[],
  effectId: string,
  start: number,
  duration: number,
): LightingEffectInstance[] {
  return effects.map((e) =>
    e.id === effectId
      ? {
          ...e,
          anchor: "SCENE_START" as const,
          start: Math.max(0, start),
          duration: Math.max(0.05, duration),
        }
      : e,
  );
}

/**
 * Moves one effect up (-1) or down (+1) inside the stack of its own scope and
 * renumbers priorities densely, so order is stable and never ambiguous.
 */
export function reorderEffect(
  effects: readonly LightingEffectInstance[],
  scopeIds: readonly string[],
  effectId: string,
  direction: -1 | 1,
): LightingEffectInstance[] {
  const scope = new Set(scopeIds);
  const ordered = stackOrder(effects.filter((e) => scope.has(e.id)));
  const index = ordered.findIndex((e) => e.id === effectId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return [...effects];
  const next = [...ordered];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;
  const priorities = new Map(next.map((e, i) => [e.id, i]));
  return effects.map((e) => (priorities.has(e.id) ? { ...e, priority: priorities.get(e.id)! } : e));
}
