/**
 * LIGHTING EFFECT EVALUATION + STACK COMPOSITION (pure).
 *
 * One deterministic function turns (effect, time, spatial field value, base
 * state) into a contribution; one deterministic reducer composes an ordered
 * stack of contributions into the final LED sample. Array iteration order NEVER
 * decides output: the stack is sorted by (priority, resolved start, id).
 *
 * COLOUR INTERPOLATION
 *   Component-wise sRGB linear interpolation. It is NOT perceptually uniform and
 *   is not claimed to be: it matches the existing 0-255 LED model exactly.
 *
 * INTENSITY / COLOUR SEPARATION
 *   A colour effect only writes colour, an intensity effect only writes
 *   intensity, so white -> blue never changes brightness by accident.
 */
import type { RGB } from "../types";
import { revealRamp } from "./field";
import {
  clamp01,
  clampByte,
  clampColor,
  sustainsAfterEnd,
  armsTargetDark,
  type DroneLightState,
  type GradientStop,
  type LightingEasing,
  type LightingEffectInstance,
  type LightingEffectType,
} from "./types";

export function ease(u: number, kind: LightingEasing = "LINEAR"): number {
  const x = clamp01(u);
  switch (kind) {
    case "SMOOTH":
      return x * x * (3 - 2 * x);
    case "MIN_JERK":
      return 10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5;
    case "LINEAR":
    default:
      return x;
  }
}

export function lerpColor(a: RGB, b: RGB, u: number): RGB {
  const k = clamp01(u);
  return [
    clampByte(a[0] + (b[0] - a[0]) * k),
    clampByte(a[1] + (b[1] - a[1]) * k),
    clampByte(a[2] + (b[2] - a[2]) * k),
  ];
}

/** Samples an ordered gradient. Unordered input is sorted deterministically. */
export function sampleGradient(stops: readonly GradientStop[], position: number): RGB {
  const list = [...stops]
    .filter((s) => s && Number.isFinite(s.position))
    .sort((a, b) => a.position - b.position || 0);
  if (list.length === 0) return [255, 255, 255];
  const p = clamp01(position);
  if (p <= list[0]!.position) return clampColor(list[0]!.color);
  const last = list[list.length - 1]!;
  if (p >= last.position) return clampColor(last.color);
  for (let i = 1; i < list.length; i++) {
    const hi = list[i]!;
    const lo = list[i - 1]!;
    if (p <= hi.position) {
      const span = hi.position - lo.position;
      return lerpColor(clampColor(lo.color), clampColor(hi.color), span < 1e-9 ? 1 : (p - lo.position) / span);
    }
  }
  return clampColor(last.color);
}

/** What one effect wants to do to one drone at one instant. */
export interface LightingContribution {
  /** Colour the effect writes, or null when it does not touch colour. */
  readonly color: RGB | null;
  /** Intensity the effect writes, or null when it does not touch intensity. */
  readonly intensity: number | null;
}

const NEUTRAL: LightingContribution = { color: null, intensity: null };

export interface EffectEvaluationInput {
  /** Absolute show time. */
  readonly t: number;
  /** Resolved absolute start of the effect (anchors already applied). */
  readonly start: number;
  /** Normalised spatial field value of the drone, 0..1. */
  readonly u: number;
  /** Stage index of the drone for GROUP_SEQUENCE (0-based, -1 = no stage). */
  readonly stageIndex?: number;
  /** Number of stages of a GROUP_SEQUENCE effect. */
  readonly stageCount?: number;
}

/** Local progress of an effect at `t`, clamped to [0,1]. */
export function effectProgress(effect: LightingEffectInstance, t: number, start: number): number {
  const duration = Math.max(1e-6, effect.duration);
  return clamp01((t - start) / duration);
}

/**
 * Deterministic per-drone contribution of ONE effect. Returns NEUTRAL when the
 * effect has nothing to say at this instant.
 */
export function evaluateLightingEffect(
  effect: LightingEffectInstance,
  input: EffectEvaluationInput,
): LightingContribution {
  if (!effect.enabled) return NEUTRAL;
  const p = effect.parameters;
  const easing = p.easing ?? "SMOOTH";
  const ceiling = clamp01(p.intensity ?? 1);
  const end = input.start + Math.max(0, effect.duration);
  const before = input.t < input.start;
  const after = input.t > end;

  if (before) {
    // An armed reveal keeps its target dark until it starts, which is exactly
    // the "formation is already flying but still invisible" behaviour.
    return armsTargetDark(effect.type) ? { color: null, intensity: 0 } : NEUTRAL;
  }
  if (after && !sustainsAfterEnd(effect.type)) return NEUTRAL;

  const progress = after ? 1 : effectProgress(effect, input.t, input.start);
  const eased = ease(progress, easing);

  switch (effect.type) {
    case "FADE_IN":
      return { color: p.color ? clampColor(p.color) : null, intensity: eased * ceiling };
    case "FADE_OUT":
      return { color: p.color ? clampColor(p.color) : null, intensity: (1 - eased) * ceiling };
    case "DIRECTIONAL_REVEAL":
    case "RADIAL_REVEAL": {
      const lit = revealRamp(eased, input.u, p.softness ?? 0.15);
      return { color: p.color ? clampColor(p.color) : null, intensity: lit * ceiling };
    }
    case "RADIAL_HIDE": {
      const lit = 1 - revealRamp(eased, input.u, p.softness ?? 0.15);
      return { color: p.color ? clampColor(p.color) : null, intensity: lit * ceiling };
    }
    case "PULSE": {
      const min = clamp01(p.minIntensity ?? 0.15);
      const max = clamp01(p.maxIntensity ?? 1);
      const cycles = Math.max(1, Math.round(p.cycles ?? 1));
      const cycleDuration =
        Number.isFinite(p.cycleDuration) && (p.cycleDuration ?? 0) > 0
          ? (p.cycleDuration as number)
          : Math.max(1e-6, effect.duration) / cycles;
      const local = input.t - input.start;
      if (local > cycles * cycleDuration + 1e-9) return NEUTRAL;
      const phase = (local / cycleDuration + (p.phase ?? 0)) % 1;
      const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
      return { color: null, intensity: (min + (max - min) * wave) * ceiling };
    }
    case "COLOR_TRANSITION": {
      const from = clampColor(p.fromColor ?? [255, 255, 255]);
      const to = clampColor(p.toColor ?? [0, 96, 255]);
      return { color: lerpColor(from, to, eased), intensity: null };
    }
    case "COLOR_SWEEP": {
      // Colour depends on effect progress AND normalised spatial position: the
      // gradient front travels across the target over the effect duration.
      const local = revealRamp(eased, input.u, p.softness ?? 1);
      const stops =
        p.stops && p.stops.length >= 2
          ? p.stops
          : ([
              { position: 0, color: p.fromColor ?? ([255, 255, 255] as RGB) },
              { position: 1, color: p.toColor ?? ([0, 96, 255] as RGB) },
            ] as GradientStop[]);
      return { color: sampleGradient(stops, local), intensity: null };
    }
    case "GROUP_SEQUENCE": {
      const stages = Math.max(1, input.stageCount ?? 1);
      const index = input.stageIndex ?? -1;
      if (index < 0) return NEUTRAL;
      const overlap = clamp01(p.stageOverlap ?? 0.25);
      // Stage windows tile the duration with a configurable overlap.
      const stageSpan = 1 / (stages - (stages - 1) * overlap || 1);
      const stageStart = index * stageSpan * (1 - overlap);
      const localProgress = clamp01((progress - stageStart) / Math.max(1e-6, stageSpan));
      return {
        color: p.color ? clampColor(p.color) : null,
        intensity: ease(localProgress, easing) * ceiling,
      };
    }
  }
}

/** Applies one contribution to the running LED state per the blend mode. */
export function blendContribution(
  state: DroneLightState,
  contribution: LightingContribution,
  mode: LightingEffectInstance["blendMode"],
): DroneLightState {
  const color = contribution.color;
  const intensity = contribution.intensity;
  switch (mode) {
    case "MULTIPLY_INTENSITY":
      return {
        r: color ? color[0] : state.r,
        g: color ? color[1] : state.g,
        b: color ? color[2] : state.b,
        intensity: clamp01(state.intensity * (intensity ?? 1)),
      };
    case "ADD":
      return {
        r: color ? clampByte(state.r + color[0]) : state.r,
        g: color ? clampByte(state.g + color[1]) : state.g,
        b: color ? clampByte(state.b + color[2]) : state.b,
        intensity: clamp01(state.intensity + (intensity ?? 0)),
      };
    case "REPLACE":
    default:
      return {
        r: color ? color[0] : state.r,
        g: color ? color[1] : state.g,
        b: color ? color[2] : state.b,
        intensity: intensity === null ? state.intensity : clamp01(intensity),
      };
  }
}

/** Deterministic stack order: priority, then resolved start, then id. */
export function sortEffects<T extends { effect: LightingEffectInstance; start: number }>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(
    (a, b) =>
      a.effect.priority - b.effect.priority ||
      a.start - b.start ||
      (a.effect.id < b.effect.id ? -1 : a.effect.id > b.effect.id ? 1 : 0),
  );
}

/** Default blend mode of an effect type (kept simple for normal users). */
export function defaultBlendMode(type: LightingEffectType): LightingEffectInstance["blendMode"] {
  return type === "COLOR_TRANSITION" || type === "COLOR_SWEEP" ? "REPLACE" : "MULTIPLY_INTENSITY";
}
