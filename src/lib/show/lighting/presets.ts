/**
 * BUILT-IN LIGHTING PRESETS.
 *
 * A preset is an IMMUTABLE recipe. Applying one CREATES a configured effect
 * instance; editing that instance never mutates the preset. Presets are grouped
 * for the UI (APPEAR / COLOR / RHYTHM / ADVANCED) and are the only thing a
 * normal user has to pick: every vector, origin and softness has a default.
 *
 * Preset ids are machine identity and are NEVER translated; the UI resolves
 * `labelKey` through the i18n dictionary.
 */
import type { RGB } from "../types";
import { defaultBlendMode } from "./evaluate";
import {
  LIGHTING_SCHEMA_VERSION,
  newLightingEffectId,
  type LightingAnchor,
  type LightingEffectInstance,
  type LightingEffectParameters,
  type LightingEffectType,
  type LightingTarget,
} from "./types";

export type LightingPresetGroup = "APPEAR" | "COLOR" | "RHYTHM" | "ADVANCED";

export interface LightingPreset {
  readonly id: string;
  readonly group: LightingPresetGroup;
  /** i18n key of the operator-facing label. */
  readonly labelKey: string;
  readonly type: LightingEffectType;
  readonly duration: number;
  readonly parameters: LightingEffectParameters;
  readonly anchor?: LightingAnchor;
}

const WHITE: RGB = [255, 255, 255];

export const LIGHTING_PRESETS: readonly LightingPreset[] = [
  {
    id: "FADE_IN",
    group: "APPEAR",
    labelKey: "lighting.preset.fadeIn",
    type: "FADE_IN",
    duration: 1.5,
    parameters: { easing: "SMOOTH" },
  },
  {
    id: "FADE_OUT",
    group: "APPEAR",
    labelKey: "lighting.preset.fadeOut",
    type: "FADE_OUT",
    duration: 1.5,
    parameters: { easing: "SMOOTH" },
  },
  {
    id: "LEFT_TO_RIGHT",
    group: "APPEAR",
    labelKey: "lighting.preset.leftToRight",
    type: "DIRECTIONAL_REVEAL",
    duration: 2,
    parameters: { direction: [1, 0, 0], softness: 0.2, easing: "LINEAR" },
  },
  {
    id: "RIGHT_TO_LEFT",
    group: "APPEAR",
    labelKey: "lighting.preset.rightToLeft",
    type: "DIRECTIONAL_REVEAL",
    duration: 2,
    parameters: { direction: [-1, 0, 0], softness: 0.2, easing: "LINEAR" },
  },
  {
    id: "BOTTOM_TO_TOP",
    group: "APPEAR",
    labelKey: "lighting.preset.bottomToTop",
    type: "DIRECTIONAL_REVEAL",
    duration: 2,
    parameters: { direction: [0, 1, 0], softness: 0.2, easing: "LINEAR" },
  },
  {
    id: "TOP_TO_BOTTOM",
    group: "APPEAR",
    labelKey: "lighting.preset.topToBottom",
    type: "DIRECTIONAL_REVEAL",
    duration: 2,
    parameters: { direction: [0, -1, 0], softness: 0.2, easing: "LINEAR" },
  },
  {
    id: "CENTER_TO_OUTSIDE",
    group: "APPEAR",
    labelKey: "lighting.preset.centerToOutside",
    type: "RADIAL_REVEAL",
    duration: 2,
    parameters: { softness: 0.25, distanceMode: "PLANAR", color: WHITE, easing: "LINEAR" },
    anchor: "FORMATION_READY",
  },
  {
    id: "OUTSIDE_TO_CENTER",
    group: "APPEAR",
    labelKey: "lighting.preset.outsideToCenter",
    type: "RADIAL_HIDE",
    duration: 2,
    parameters: { softness: 0.25, distanceMode: "PLANAR", easing: "LINEAR" },
  },
  {
    id: "COLOR_TRANSITION",
    group: "COLOR",
    labelKey: "lighting.preset.colorTransition",
    type: "COLOR_TRANSITION",
    duration: 3,
    parameters: { fromColor: WHITE, toColor: [40, 90, 255], easing: "SMOOTH" },
  },
  {
    id: "COLOR_SWEEP",
    group: "COLOR",
    labelKey: "lighting.preset.colorSweep",
    type: "COLOR_SWEEP",
    duration: 3,
    parameters: {
      direction: [1, 0, 0],
      softness: 1,
      stops: [
        { position: 0, color: WHITE },
        { position: 0.5, color: [60, 110, 255] },
        { position: 1, color: [170, 70, 255] },
      ],
    },
  },
  {
    id: "RAINBOW_SWEEP",
    group: "COLOR",
    labelKey: "lighting.preset.rainbowSweep",
    type: "COLOR_SWEEP",
    duration: 4,
    parameters: {
      direction: [1, 0, 0],
      softness: 1,
      stops: [
        { position: 0, color: [255, 60, 60] },
        { position: 0.25, color: [255, 220, 60] },
        { position: 0.5, color: [60, 255, 130] },
        { position: 0.75, color: [60, 160, 255] },
        { position: 1, color: [180, 80, 255] },
      ],
    },
  },
  {
    id: "PULSE_1",
    group: "RHYTHM",
    labelKey: "lighting.preset.pulse1",
    type: "PULSE",
    duration: 1,
    parameters: { cycles: 1, minIntensity: 0.15, maxIntensity: 1 },
  },
  {
    id: "PULSE_2",
    group: "RHYTHM",
    labelKey: "lighting.preset.pulse2",
    type: "PULSE",
    duration: 2,
    parameters: { cycles: 2, minIntensity: 0.15, maxIntensity: 1 },
  },
  {
    id: "PULSE_4",
    group: "RHYTHM",
    labelKey: "lighting.preset.pulse4",
    type: "PULSE",
    duration: 4,
    parameters: { cycles: 4, minIntensity: 0.15, maxIntensity: 1 },
  },
  {
    id: "DIRECTIONAL_SWEEP",
    group: "ADVANCED",
    labelKey: "lighting.preset.directionalSweep",
    type: "DIRECTIONAL_REVEAL",
    duration: 2.5,
    parameters: { angleDeg: 45, softness: 0.4, easing: "SMOOTH" },
  },
  {
    id: "RADIAL_REVEAL",
    group: "ADVANCED",
    labelKey: "lighting.preset.radialReveal",
    type: "RADIAL_REVEAL",
    duration: 2.5,
    parameters: { softness: 0.3, distanceMode: "SPATIAL" },
  },
  {
    id: "GROUP_SEQUENCE",
    group: "ADVANCED",
    labelKey: "lighting.preset.groupSequence",
    type: "GROUP_SEQUENCE",
    duration: 2.5,
    parameters: { stageOverlap: 0.25, easing: "SMOOTH" },
  },
];

export function findLightingPreset(id: string): LightingPreset | undefined {
  return LIGHTING_PRESETS.find((p) => p.id === id);
}

export interface CreateEffectOptions {
  readonly start?: number;
  readonly anchor?: LightingAnchor;
  readonly priority?: number;
  readonly parameters?: LightingEffectParameters;
  readonly idSeed?: number;
}

/** Applying a preset CREATES an instance; the preset itself stays immutable. */
export function createEffectFromPreset(
  preset: LightingPreset,
  target: LightingTarget,
  options: CreateEffectOptions = {},
): LightingEffectInstance {
  return {
    id: newLightingEffectId(options.idSeed ?? Date.now()),
    target,
    type: preset.type,
    anchor: options.anchor ?? preset.anchor ?? "SCENE_START",
    start: options.start ?? 0,
    duration: preset.duration,
    parameters: { ...preset.parameters, ...(options.parameters ?? {}) },
    blendMode: defaultBlendMode(preset.type),
    priority: options.priority ?? 0,
    enabled: true,
    metadata: { presetId: preset.id },
  };
}

export const LIGHTING_PROGRAM_VERSION = LIGHTING_SCHEMA_VERSION;
