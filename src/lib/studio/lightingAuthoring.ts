/**
 * LIGHTING AUTHORING — PRESENTATION HELPERS (pure, deterministic).
 *
 * This module contains NO lighting evaluation and NO second lighting model. It
 * only prepares what the designer UI has to render:
 *   - which presets belong to the prominent QUICK LIGHTING row,
 *   - how the current scene/scene-object selection maps to canonical
 *     `LightingTarget` values of the EXISTING model,
 *   - human readable target / timing readouts derived from the canonical
 *     `resolveEffectStart` timing authority.
 *
 * LED colours are always computed by the canonical lighting engine
 * (`lightingStatesAt` in the store); nothing here ever produces a colour for a
 * drone.
 */
import {
  LIGHTING_PRESETS,
  resolveEffectStart,
  type LightingEffectInstance,
  type LightingPreset,
  type LightingTarget,
} from "@/lib/show/lighting";
import type { RGB } from "@/lib/show/types";

/** Ordered ids of the prominent quick-lighting workflow. */
export const QUICK_LIGHTING_PRESET_IDS: readonly string[] = [
  "FADE_IN",
  "FADE_OUT",
  "LEFT_TO_RIGHT",
  "RIGHT_TO_LEFT",
  "CENTER_TO_OUTSIDE",
  "OUTSIDE_TO_CENTER",
  "PULSE_1",
  "COLOR_TRANSITION",
  "COLOR_SWEEP",
];

export function quickLightingPresets(): LightingPreset[] {
  return QUICK_LIGHTING_PRESET_IDS.flatMap((id) => {
    const preset = LIGHTING_PRESETS.find((p) => p.id === id);
    return preset ? [preset] : [];
  });
}

/** Presets whose look is driven by a single quick colour. */
export function presetUsesColor(preset: LightingPreset): boolean {
  switch (preset.type) {
    case "COLOR_TRANSITION":
    case "COLOR_SWEEP":
      return false;
    default:
      return true;
  }
}

/**
 * Selection -> canonical targets of the EXISTING target model.
 *
 * An empty selection means the whole scene. Each selected scene object gets one
 * `SCENE_OBJECT` target, which is exactly what the engine's `targetsDrone`
 * resolution consumes; no new resolution logic is introduced here.
 */
export function lightingTargetsForSelection(
  clipId: string,
  selectedObjectIds: readonly string[],
): LightingTarget[] {
  if (selectedObjectIds.length === 0) return [{ kind: "SCENE", clipId }];
  return selectedObjectIds.map((instanceId) => ({
    kind: "SCENE_OBJECT" as const,
    clipId,
    instanceId,
  }));
}

export interface TargetReadout {
  readonly kind: "SCENE" | "OBJECTS";
  /** Localisation-free names of the targeted objects (empty for whole scene). */
  readonly names: readonly string[];
  readonly count: number;
}

export function targetReadout(
  objects: readonly { readonly id: string; readonly name: string }[],
  selectedObjectIds: readonly string[],
): TargetReadout {
  if (selectedObjectIds.length === 0) return { kind: "SCENE", names: [], count: 0 };
  const names = selectedObjectIds.map(
    (id) => objects.find((o) => o.id === id)?.name ?? id,
  );
  return { kind: "OBJECTS", names, count: names.length };
}

/** Label of an effect's own target, for the effect-layer list. */
export function effectTargetLabel(
  effect: LightingEffectInstance,
  objects: readonly { readonly id: string; readonly name: string }[],
): string | null {
  if (effect.target.kind === "SCENE") return null;
  const id = effect.target.instanceId;
  return objects.find((o) => o.id === id)?.name ?? id;
}

/** Colour swatch of an effect, when it has one. */
export function effectSwatch(effect: LightingEffectInstance): RGB | null {
  const p = effect.parameters;
  if (effect.type === "COLOR_TRANSITION") return p.toColor ?? p.fromColor ?? null;
  if (effect.type === "COLOR_SWEEP") return p.stops?.[0]?.color ?? null;
  return p.color ?? null;
}

export interface ResolvedInterval {
  readonly start: number;
  readonly end: number;
}

/**
 * Resolved absolute show-time interval, using the CANONICAL anchor resolver.
 * Returns null when the governing clip is unknown (nothing to resolve against).
 */
export function resolvedEffectInterval(
  effect: LightingEffectInstance,
  clip: { readonly start: number; readonly transition: number; readonly hold: number } | null,
): ResolvedInterval | null {
  if (!clip) return null;
  const start = resolveEffectStart(effect, {
    sceneStart: clip.start,
    formationReady: clip.start + clip.transition,
    sceneEnd: clip.start + clip.transition + clip.hold,
  });
  return { start, end: start + Math.max(0, effect.duration) };
}

export function formatSeconds(t: number): string {
  const sign = t < 0 ? "-" : "";
  const v = Math.abs(t);
  const m = Math.floor(v / 60);
  const s = v - m * 60;
  return `${sign}${m}:${s.toFixed(1).padStart(4, "0")}`;
}
