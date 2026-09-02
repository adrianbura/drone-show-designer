/**
 * SELECTION EFFECTS — everyday operator vocabulary over the CANONICAL engines.
 *
 * PURE module. It contains NO lighting evaluation, NO animation sampling and NO
 * safety maths. Its only job is to translate what the operator sees — the
 * current scene selection and a small gallery of familiar effect names — into
 * the EXISTING canonical structures:
 *
 *   everyday lighting preset  ->  existing `LIGHTING_PRESETS` id
 *   everyday motion preset    ->  existing `DynamicPresetId`
 *   scene selection           ->  existing `LightingTarget` values
 *
 * Nothing here invents a new effect type, a new parameter field or a second
 * source of truth for LED colour or geometry motion.
 */
import { DYNAMIC_PRESETS, type DynamicPresetId } from "../show/dynamic";
import type {
  LightingEffectInstance,
  LightingEffectParameters,
  LightingEffectType,
  LightingTarget,
} from "../show/lighting";
import type { RGB, Vector3Tuple } from "../show/types";

/* ------------------------------------------------------------------ *
 * SELECTION CONTEXT
 * ------------------------------------------------------------------ */

export type SelectionTargetKind = "OBJECTS" | "DRONES" | "NONE";

export interface SelectionEffectContext {
  readonly kind: SelectionTargetKind;
  /** Human readable name of what the effect will be applied to. */
  readonly label: string;
  readonly droneCount: number;
  readonly objectCount: number;
  readonly empty: boolean;
}

export interface SelectionContextInput {
  readonly mode: "OBJECT" | "POINT";
  readonly objects: readonly { readonly id: string; readonly name: string }[];
  readonly selectedObjectIds: readonly string[];
  readonly primaryObjectId: string | null;
  readonly selectedPointIds: readonly string[];
  /** Canonical scene-budget drone count of one object. */
  readonly droneCountOf: (objectId: string) => number;
}

const isPointSelection = (input: SelectionContextInput): boolean =>
  input.mode === "POINT" && !!input.primaryObjectId && input.selectedPointIds.length > 0;

export function selectionEffectContext(input: SelectionContextInput): SelectionEffectContext {
  const nameOf = (id: string) => input.objects.find((o) => o.id === id)?.name ?? id;

  if (isPointSelection(input)) {
    const count = input.selectedPointIds.length;
    return {
      kind: "DRONES",
      label: `${count} drone point${count === 1 ? "" : "s"} of ${nameOf(input.primaryObjectId!)}`,
      droneCount: count,
      objectCount: 0,
      empty: false,
    };
  }

  if (input.selectedObjectIds.length > 0) {
    return {
      kind: "OBJECTS",
      label:
        input.selectedObjectIds.length === 1
          ? nameOf(input.selectedObjectIds[0]!)
          : `${input.selectedObjectIds.length} objects selected`,
      droneCount: input.selectedObjectIds.reduce((sum, id) => sum + input.droneCountOf(id), 0),
      objectCount: input.selectedObjectIds.length,
      empty: false,
    };
  }

  return { kind: "NONE", label: "Nothing selected", droneCount: 0, objectCount: 0, empty: true };
}

/**
 * Canonical targets of the current selection. An EMPTY selection returns an
 * EMPTY list: an effect is never silently widened to the whole scene.
 */
export function selectionLightingTargets(
  clipId: string,
  input: SelectionContextInput,
): LightingTarget[] {
  if (isPointSelection(input)) {
    return [
      {
        kind: "POINT_GROUP",
        clipId,
        instanceId: input.primaryObjectId!,
        pointIds: [...input.selectedPointIds],
      },
    ];
  }
  return input.selectedObjectIds.map((instanceId) => ({
    kind: "SCENE_OBJECT" as const,
    clipId,
    instanceId,
  }));
}

/* ------------------------------------------------------------------ *
 * AXIS HELPERS
 * ------------------------------------------------------------------ */

export type EffectAxis = "X" | "Y" | "Z";

export function axisVector(axis: EffectAxis): Vector3Tuple {
  return axis === "X" ? [1, 0, 0] : axis === "Y" ? [0, 1, 0] : [0, 0, 1];
}

export function axisOfVector(direction: Vector3Tuple | undefined): EffectAxis {
  if (!direction) return "X";
  const [x, y, z] = direction.map((v) => Math.abs(v)) as [number, number, number];
  if (z > x && z > y) return "Z";
  if (y > x) return "Y";
  return "X";
}

/* ------------------------------------------------------------------ *
 * EVERYDAY LIGHTING PRESETS
 * ------------------------------------------------------------------ */

export type SelectionLightingPresetId =
  | "SOLID_COLOUR"
  | "FADE_IN"
  | "FADE_OUT"
  | "PULSE"
  | "SPARKLE"
  | "COLOUR_WAVE"
  | "GRADIENT_SWEEP";

export interface SelectionLightingPreset {
  readonly id: SelectionLightingPresetId;
  readonly label: string;
  readonly description: string;
  /** EXISTING canonical preset id in `LIGHTING_PRESETS`. */
  readonly canonicalPresetId: string;
  /** Everyday default length in seconds at the playhead. */
  readonly duration: number;
  readonly usesPrimaryColor: boolean;
  readonly usesSecondaryColor: boolean;
  readonly usesAxis: boolean;
}

export const SELECTION_LIGHTING_PRESETS: readonly SelectionLightingPreset[] = [
  {
    id: "SOLID_COLOUR",
    label: "Solid colour",
    description: "Hold one colour on the selection",
    canonicalPresetId: "COLOR_TRANSITION",
    duration: 2,
    usesPrimaryColor: true,
    usesSecondaryColor: false,
    usesAxis: false,
  },
  {
    id: "FADE_IN",
    label: "Fade in",
    description: "Lights rise smoothly from dark",
    canonicalPresetId: "FADE_IN",
    duration: 1.5,
    usesPrimaryColor: false,
    usesSecondaryColor: false,
    usesAxis: false,
  },
  {
    id: "FADE_OUT",
    label: "Fade out",
    description: "Lights fall smoothly to dark",
    canonicalPresetId: "FADE_OUT",
    duration: 1.5,
    usesPrimaryColor: false,
    usesSecondaryColor: false,
    usesAxis: false,
  },
  {
    id: "PULSE",
    label: "Pulse",
    description: "Slow rhythmic breathing of the LEDs",
    canonicalPresetId: "PULSE_2",
    duration: 2,
    usesPrimaryColor: true,
    usesSecondaryColor: false,
    usesAxis: false,
  },
  {
    id: "SPARKLE",
    label: "Sparkle",
    description: "Fast flicker across the selection",
    canonicalPresetId: "PULSE_4",
    duration: 2,
    usesPrimaryColor: true,
    usesSecondaryColor: false,
    usesAxis: false,
  },
  {
    id: "COLOUR_WAVE",
    label: "Colour wave",
    description: "Rainbow travelling along one axis",
    canonicalPresetId: "RAINBOW_SWEEP",
    duration: 4,
    usesPrimaryColor: false,
    usesSecondaryColor: false,
    usesAxis: true,
  },
  {
    id: "GRADIENT_SWEEP",
    label: "Gradient",
    description: "Blend colour A into colour B across the shape",
    canonicalPresetId: "COLOR_SWEEP",
    duration: 3,
    usesPrimaryColor: true,
    usesSecondaryColor: true,
    usesAxis: true,
  },
];

export function findSelectionLightingPreset(
  id: SelectionLightingPresetId,
): SelectionLightingPreset {
  const preset = SELECTION_LIGHTING_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown selection lighting preset: ${id}`);
  return preset;
}

export interface SelectionColorChoice {
  readonly primary: RGB | readonly [number, number, number];
  readonly secondary: RGB | readonly [number, number, number];
  readonly axis: EffectAxis;
}

const rgb = (value: RGB | readonly [number, number, number]): RGB => [value[0], value[1], value[2]];

/**
 * Parameter overrides for a preset. Only CANONICAL parameter fields are ever
 * produced; unspecified fields keep the canonical preset default.
 */
export function selectionLightingParameters(
  preset: SelectionLightingPreset,
  choice: SelectionColorChoice,
): LightingEffectParameters {
  switch (preset.id) {
    case "SOLID_COLOUR":
      return { fromColor: rgb(choice.primary), toColor: rgb(choice.primary) };
    case "PULSE":
    case "SPARKLE":
      return { color: rgb(choice.primary) };
    case "COLOUR_WAVE":
      return { direction: axisVector(choice.axis) };
    case "GRADIENT_SWEEP":
      return {
        direction: axisVector(choice.axis),
        stops: [
          { position: 0, color: rgb(choice.primary) },
          { position: 1, color: rgb(choice.secondary) },
        ],
      };
    default:
      return {};
  }
}

/* ------------------------------------------------------------------ *
 * EVERYDAY MOTION PRESETS
 * ------------------------------------------------------------------ */

export interface SelectionMotionPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** EXISTING canonical dynamic preset. */
  readonly canonicalPreset: DynamicPresetId;
}

export const SELECTION_MOTION_PRESETS: readonly SelectionMotionPreset[] = [
  {
    id: "WAVE",
    label: "Wave",
    description: "Bands ripple vertically through the shape",
    canonicalPreset: "WAVE",
  },
  {
    id: "RIPPLE",
    label: "Ripple",
    description: "Bands counter-rotate for a twisting ripple",
    canonicalPreset: "TWIST",
  },
  {
    id: "SCALE_PULSE",
    label: "Pulse / scale",
    description: "The whole shape breathes in and out",
    canonicalPreset: "PULSE",
  },
  {
    id: "FLOAT",
    label: "Float",
    description: "Slow drifting translation loop",
    canonicalPreset: "DRIFT",
  },
  {
    id: "ROTATE",
    label: "Rotate",
    description: "Full yaw rotation about the pivot",
    canonicalPreset: "ORBIT",
  },
  {
    id: "FLAP",
    label: "Flap",
    description: "Left and right sides rotate in opposition",
    canonicalPreset: "FLAP",
  },
];

/** Canonical dynamic-preset descriptions, for tooltips that need them. */
export function canonicalMotionDescription(preset: DynamicPresetId): string {
  return DYNAMIC_PRESETS.find((p) => p.id === preset)?.description ?? preset;
}

/* ------------------------------------------------------------------ *
 * EFFECT PRESENTATION + INSPECTOR RELEVANCE
 * ------------------------------------------------------------------ */

export function effectDisplayLabel(effect: LightingEffectInstance): string {
  const presetId = effect.metadata?.presetId;
  if (presetId) {
    const everyday = SELECTION_LIGHTING_PRESETS.find((p) => p.canonicalPresetId === presetId);
    if (everyday) return everyday.label;
  }
  return effect.type.replace(/_/g, " ").toLowerCase();
}

export type EffectControl =
  | "INTENSITY"
  | "SPEED"
  | "DIRECTION"
  | "EASING"
  | "PRIMARY_COLOR"
  | "SECONDARY_COLOR";

/** Only the controls the CANONICAL effect type actually consumes. */
export function relevantEffectControls(type: LightingEffectType): readonly EffectControl[] {
  switch (type) {
    case "PULSE":
      return ["INTENSITY", "SPEED", "PRIMARY_COLOR"];
    case "COLOR_TRANSITION":
      return ["INTENSITY", "EASING", "PRIMARY_COLOR", "SECONDARY_COLOR"];
    case "COLOR_SWEEP":
      return ["INTENSITY", "DIRECTION", "PRIMARY_COLOR", "SECONDARY_COLOR"];
    case "DIRECTIONAL_REVEAL":
      return ["INTENSITY", "DIRECTION", "EASING", "PRIMARY_COLOR"];
    case "RADIAL_REVEAL":
    case "RADIAL_HIDE":
      return ["INTENSITY", "EASING", "PRIMARY_COLOR"];
    case "FADE_IN":
    case "FADE_OUT":
      return ["INTENSITY", "EASING"];
    default:
      return ["INTENSITY", "EASING"];
  }
}

export interface EffectColors {
  readonly primary: RGB | null;
  readonly secondary: RGB | null;
}

/** Reads the effect's colours out of their CANONICAL parameter fields. */
export function effectColors(effect: LightingEffectInstance): EffectColors {
  const p = effect.parameters;
  if (effect.type === "COLOR_TRANSITION") {
    return { primary: p.fromColor ?? null, secondary: p.toColor ?? null };
  }
  if (effect.type === "COLOR_SWEEP") {
    const stops = p.stops ?? [];
    return {
      primary: stops[0]?.color ?? null,
      secondary: stops[stops.length - 1]?.color ?? null,
    };
  }
  return { primary: p.color ?? null, secondary: null };
}

/** Patch that writes one colour back into the CANONICAL parameter field. */
export function colorPatchFor(
  effect: LightingEffectInstance,
  slot: "primary" | "secondary",
  color: RGB,
): LightingEffectParameters {
  if (effect.type === "COLOR_TRANSITION") {
    return slot === "primary" ? { fromColor: color } : { toColor: color };
  }
  if (effect.type === "COLOR_SWEEP") {
    const stops = [...(effect.parameters.stops ?? [])];
    if (stops.length === 0) return { stops: [{ position: slot === "primary" ? 0 : 1, color }] };
    const index = slot === "primary" ? 0 : stops.length - 1;
    stops[index] = { position: stops[index]!.position, color };
    return { stops };
  }
  return { color };
}

/** Everyday "speed" of a PULSE, in Hz, derived from canonical cycles. */
export function pulseSpeed(effect: LightingEffectInstance): number {
  const duration = effect.duration > 0 ? effect.duration : 1;
  if (effect.parameters.cycleDuration && effect.parameters.cycleDuration > 0) {
    return 1 / effect.parameters.cycleDuration;
  }
  return (effect.parameters.cycles ?? 1) / duration;
}
