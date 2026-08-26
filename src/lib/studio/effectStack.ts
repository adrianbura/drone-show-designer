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
  type LightingEffectInstance,
  type LightingEffectParameters,
  type LightingTarget,
} from "../show/lighting";

/** The six everyday stack entries offered to a normal operator. */
export type EffectStackPresetId =
  "BASE_COLOR" | "FADE" | "PULSE" | "CHASE" | "TWINKLE" | "GRADIENT";

export const EFFECT_STACK_PRESETS: readonly EffectStackPresetId[] = [
  "BASE_COLOR",
  "FADE",
  "PULSE",
  "CHASE",
  "TWINKLE",
  "GRADIENT",
];

/** Everyday preset -> canonical lighting preset id. No new effect types. */
const CANONICAL_PRESET: Readonly<Record<EffectStackPresetId, string>> = {
  BASE_COLOR: "COLOR_TRANSITION",
  FADE: "COLOR_TRANSITION",
  PULSE: "PULSE_2",
  CHASE: "DIRECTIONAL_SWEEP",
  TWINKLE: "PULSE_4",
  GRADIENT: "COLOR_SWEEP",
};

function colorParameters(preset: EffectStackPresetId, color: RGB): LightingEffectParameters {
  switch (preset) {
    case "BASE_COLOR":
    case "FADE":
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

/** Stack order of the effects belonging to a set of targets. */
export function stackOrder(
  effects: readonly LightingEffectInstance[],
): readonly LightingEffectInstance[] {
  return [...effects].sort(
    (a, b) => a.priority - b.priority || a.start - b.start || a.id.localeCompare(b.id),
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

/** Canonical lighting preset id backing an everyday stack entry. */
export function canonicalStackPresetId(preset: EffectStackPresetId): string {
  return CANONICAL_PRESET[preset];
}

/** Everyday colour parameters for a stack entry (empty when not colour driven). */
export function stackColorParameters(
  preset: EffectStackPresetId,
  color: RGB,
): LightingEffectParameters {
  return colorParameters(preset, color);
}
