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
  type GradientStop,
  type LightingEffectInstance,
  type LightingEffectParameters,
  type LightingTarget,
} from "../show/lighting";

const clampStopPosition = (position: number): number => Math.max(0, Math.min(1, position));

/** Stable, bounded stop order consumed directly by the canonical COLOR_SWEEP evaluator. */
export function normalizeGradientStops(stops: readonly GradientStop[]): GradientStop[] {
  return stops
    .map((stop) => ({ ...stop, position: clampStopPosition(stop.position) }))
    .sort((a, b) => a.position - b.position);
}

/** Inserts a stop in the largest visual gap, interpolating its colour. */
export function addGradientStop(stops: readonly GradientStop[]): GradientStop[] {
  const ordered = normalizeGradientStops(stops);
  if (ordered.length === 0) {
    return [
      { position: 0, color: [255, 255, 255] },
      { position: 1, color: [255, 255, 255] },
    ];
  }
  if (ordered.length === 1) {
    return normalizeGradientStops([
      ordered[0]!,
      { position: ordered[0]!.position < 0.5 ? 1 : 0, color: ordered[0]!.color },
    ]);
  }
  let gapIndex = 0;
  for (let index = 1; index < ordered.length - 1; index += 1) {
    if (
      ordered[index + 1]!.position - ordered[index]!.position >
      ordered[gapIndex + 1]!.position - ordered[gapIndex]!.position
    ) {
      gapIndex = index;
    }
  }
  const from = ordered[gapIndex]!;
  const to = ordered[gapIndex + 1]!;
  const color: RGB = [
    Math.round((from.color[0] + to.color[0]) / 2),
    Math.round((from.color[1] + to.color[1]) / 2),
    Math.round((from.color[2] + to.color[2]) / 2),
  ];
  return normalizeGradientStops([
    ...ordered,
    { position: (from.position + to.position) / 2, color },
  ]);
}

export function updateGradientStop(
  stops: readonly GradientStop[],
  index: number,
  patch: Partial<GradientStop>,
): GradientStop[] {
  return normalizeGradientStops(
    stops.map((stop, candidate) => (candidate === index ? { ...stop, ...patch } : stop)),
  );
}

/** Canonical gradients require at least two stops. */
export function removeGradientStop(stops: readonly GradientStop[], index: number): GradientStop[] {
  if (stops.length <= 2) return normalizeGradientStops(stops);
  return normalizeGradientStops(stops.filter((_, candidate) => candidate !== index));
}

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
