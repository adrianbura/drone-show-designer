/**
 * SELECTION EFFECTS (pure composition helpers).
 *
 * Operator-facing vocabulary for authoring lighting and motion on the CURRENT
 * CANONICAL SELECTION (scene objects, or the selected drone points of one
 * object). This module is presentation composition only:
 *
 *   - Lighting presets map onto EXISTING canonical `LIGHTING_PRESETS` ids; no
 *     new lighting effect type, no second evaluator, no LED maths here.
 *   - Motion presets map onto EXISTING canonical `DynamicPresetId` values and
 *     are applied through the canonical store action
 *     `applyMotionPresetToSceneSelection`; no second motion engine.
 *   - Targets are canonical `LightingTarget` values. An EMPTY selection yields
 *     NO targets, so authoring can never silently fall back to the whole scene.
 *
 * No React, no Three.js, no I/O.
 */
import type { DynamicPresetId } from "../show/dynamic";
import type {
  LightingEffectInstance,
  LightingEffectParameters,
  LightingEffectType,
  LightingTarget,
} from "../show/lighting";
import type { RGB, Vector3Tuple } from "../show/types";

/* ------------------------------------------------------------------ lighting */

/** Everyday lighting entries offered for a selection. */
export type LightingSelectionPresetId =
  "SOLID" | "FADE_IN" | "FADE_OUT" | "PULSE" | "SPARKLE" | "COLOUR_WAVE" | "GRADIENT_SWEEP";

export interface LightingSelectionPreset {
  readonly id: LightingSelectionPresetId;
  readonly label: string;
  readonly description: string;
  /** Canonical `LIGHTING_PRESETS` id backing this entry. */
  readonly canonicalPresetId: string;
  /** Explicit duration override in seconds (otherwise the preset duration). */
  readonly duration?: number;
}

export const LIGHTING_SELECTION_PRESETS: readonly LightingSelectionPreset[] = [
  {
    id: "SOLID",
    label: "Solid colour",
    description: "Sets one colour on the selection from the playhead onwards.",
    canonicalPresetId: "COLOR_TRANSITION",
    duration: 0.05,
  },
  {
    id: "FADE_IN",
    label: "Fade in",
    description: "Brings the selection up from dark.",
    canonicalPresetId: "FADE_IN",
  },
  {
    id: "FADE_OUT",
    label: "Fade out",
    description: "Takes the selection down to dark.",
    canonicalPresetId: "FADE_OUT",
  },
  {
    id: "PULSE",
    label: "Pulse",
    description: "Slow breathing brightness on the selection.",
    canonicalPresetId: "PULSE_2",
  },
  {
    id: "SPARKLE",
    label: "Sparkle",
    description: "Fast repeated blinks on the selection.",
    canonicalPresetId: "PULSE_4",
  },
  {
    id: "COLOUR_WAVE",
    label: "Colour wave",
    description: "A rainbow gradient travelling across the selection.",
    canonicalPresetId: "RAINBOW_SWEEP",
  },
  {
    id: "GRADIENT_SWEEP",
    label: "Gradient sweep",
    description: "Sweeps colour A into colour B along one axis.",
    canonicalPresetId: "COLOR_SWEEP",
  },
];

const LIGHTING_BY_ID: ReadonlyMap<LightingSelectionPresetId, LightingSelectionPreset> = new Map(
  LIGHTING_SELECTION_PRESETS.map((p) => [p.id, p]),
);

const LIGHTING_BY_CANONICAL: ReadonlyMap<string, LightingSelectionPreset> = new Map(
  LIGHTING_SELECTION_PRESETS.map((p) => [p.canonicalPresetId, p]),
);

export function lightingSelectionPreset(id: LightingSelectionPresetId): LightingSelectionPreset {
  return LIGHTING_BY_ID.get(id)!;
}

/* -------------------------------------------------------------------- motion */

/** Everyday motion entries, each backed by ONE canonical dynamic preset. */
export type MotionSelectionPresetId = "WAVE" | "PULSE_SCALE" | "FLOAT" | "ROTATE" | "SWEEP_TWIST";

export interface MotionSelectionPreset {
  readonly id: MotionSelectionPresetId;
  readonly label: string;
  readonly description: string;
  readonly canonicalPresetId: DynamicPresetId;
}

export const MOTION_SELECTION_PRESETS: readonly MotionSelectionPreset[] = [
  {
    id: "WAVE",
    label: "Wave",
    description: "Phase-shifted bands ripple through the selection.",
    canonicalPresetId: "WAVE",
  },
  {
    id: "PULSE_SCALE",
    label: "Pulse / scale",
    description: "The selection breathes larger and smaller.",
    canonicalPresetId: "PULSE",
  },
  {
    id: "FLOAT",
    label: "Float / drift",
    description: "Slow drifting translation loop.",
    canonicalPresetId: "DRIFT",
  },
  {
    id: "ROTATE",
    label: "Rotate / orbit",
    description: "Full yaw rotation about the pivot.",
    canonicalPresetId: "ORBIT",
  },
  {
    id: "SWEEP_TWIST",
    label: "Sweep / twist",
    description: "Bands counter-rotate around the vertical axis.",
    canonicalPresetId: "TWIST",
  },
];

/**
 * Requested motion entries with NO canonical representation. Listed explicitly
 * so the gap is visible instead of being faked by a second motion engine.
 */
export const UNSUPPORTED_MOTION_REQUESTS: readonly string[] = ["RIPPLE"];

/* ----------------------------------------------------------------- selection */

export type SelectionEffectTargetKind = "OBJECTS" | "DRONES" | "NONE";

export interface SelectionEffectContext {
  readonly kind: SelectionEffectTargetKind;
  /** Operator-facing name of the selection. */
  readonly name: string;
  /** Drones covered by the selection (points, or the objects' budgets). */
  readonly droneCount: number;
  readonly objectIds: readonly string[];
  readonly pointIds: readonly string[];
  readonly primaryObjectId: string | null;
  /** Canonical lighting targets. EMPTY when nothing is selected. */
  readonly targets: readonly LightingTarget[];
  /** False when there is nothing to author on. */
  readonly canApply: boolean;
}

export interface SelectionEffectInput {
  readonly clipId: string | null;
  readonly selectionMode: "OBJECT" | "POINT";
  readonly objectIds: readonly string[];
  readonly primaryObjectId: string | null;
  readonly pointIds: readonly string[];
  /** instanceId -> operator-facing object name. */
  readonly objectNames: ReadonlyMap<string, string>;
  /** instanceId -> drones the object currently uses. */
  readonly objectDroneCounts: ReadonlyMap<string, number>;
}

const EMPTY_CONTEXT: SelectionEffectContext = {
  kind: "NONE",
  name: "Nothing selected",
  droneCount: 0,
  objectIds: [],
  pointIds: [],
  primaryObjectId: null,
  targets: [],
  canApply: false,
};

/** Resolves the canonical effect target of the current selection. */
export function selectionEffectContext(input: SelectionEffectInput): SelectionEffectContext {
  const clipId = input.clipId;
  if (!clipId) return EMPTY_CONTEXT;

  const primaryId = input.primaryObjectId;
  if (input.selectionMode === "POINT" && primaryId && input.pointIds.length > 0) {
    const owner = input.objectNames.get(primaryId) ?? "Object";
    return {
      kind: "DRONES",
      name: `${input.pointIds.length} drone${input.pointIds.length === 1 ? "" : "s"} of ${owner}`,
      droneCount: input.pointIds.length,
      objectIds: [primaryId],
      pointIds: [...input.pointIds],
      primaryObjectId: primaryId,
      targets: [
        { kind: "POINT_GROUP", clipId, instanceId: primaryId, pointIds: [...input.pointIds] },
      ],
      canApply: true,
    };
  }

  if (input.objectIds.length > 0) {
    const names = input.objectIds.map((id) => input.objectNames.get(id) ?? "Object");
    const droneCount = input.objectIds.reduce(
      (sum, id) => sum + (input.objectDroneCounts.get(id) ?? 0),
      0,
    );
    return {
      kind: "OBJECTS",
      name:
        names.length === 1
          ? names[0]!
          : `${names.length} objects (${names.slice(0, 2).join(", ")}${names.length > 2 ? "…" : ""})`,
      droneCount,
      objectIds: [...input.objectIds],
      pointIds: [],
      primaryObjectId: primaryId,
      targets: input.objectIds.map((instanceId) => ({
        kind: "SCENE_OBJECT" as const,
        clipId,
        instanceId,
      })),
      canApply: true,
    };
  }

  return EMPTY_CONTEXT;
}

/** Effects belonging to the current selection scope, in stack order. */
export function effectsForSelection(
  effects: readonly LightingEffectInstance[],
  context: SelectionEffectContext,
): readonly LightingEffectInstance[] {
  if (!context.canApply) return [];
  const scope = new Set(context.objectIds);
  const selectedPoints = new Set(context.pointIds);
  return effects.filter((effect) => {
    if (effect.target.kind === "SCENE" || !scope.has(effect.target.instanceId)) return false;
    if (context.kind === "OBJECTS") return effect.target.kind === "SCENE_OBJECT";
    if (effect.target.kind !== "POINT_GROUP") return false;
    return (
      effect.target.pointIds.length === selectedPoints.size &&
      effect.target.pointIds.every((id) => selectedPoints.has(id))
    );
  });
}

/* --------------------------------------------------------------- parameters */

export type EffectAxis = "X" | "Y" | "Z";

export function axisDirection(axis: EffectAxis): Vector3Tuple {
  return axis === "X" ? [1, 0, 0] : axis === "Y" ? [0, 1, 0] : [0, 0, 1];
}

export function directionAxis(direction: Vector3Tuple | undefined): EffectAxis {
  if (!direction) return "X";
  const [x, y, z] = direction;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (az > ax && az > ay) return "Z";
  if (ay > ax) return "Y";
  return "X";
}

export interface LightingPresetOptions {
  readonly primary: RGB;
  readonly secondary: RGB;
  readonly axis: EffectAxis;
}

/** Everyday parameters for one preset. Never invents a new parameter name. */
export function lightingPresetParameters(
  id: LightingSelectionPresetId,
  options: LightingPresetOptions,
): LightingEffectParameters {
  switch (id) {
    case "SOLID":
      return { fromColor: options.primary, toColor: options.primary };
    case "FADE_IN":
    case "FADE_OUT":
      return { color: options.primary };
    case "PULSE":
    case "SPARKLE":
      return { color: options.primary };
    case "COLOUR_WAVE":
      return { direction: axisDirection(options.axis) };
    case "GRADIENT_SWEEP":
      return {
        direction: axisDirection(options.axis),
        stops: [
          { position: 0, color: options.primary },
          { position: 1, color: options.secondary },
        ],
      };
  }
}

/** Absolute timing at the playhead. */
export function lightingPresetTiming(
  id: LightingSelectionPresetId,
  playhead: number,
): { readonly anchor: "ABSOLUTE"; readonly start: number; readonly duration?: number } {
  const preset = lightingSelectionPreset(id);
  const start = Math.max(0, playhead);
  return preset.duration === undefined
    ? { anchor: "ABSOLUTE", start }
    : { anchor: "ABSOLUTE", start, duration: preset.duration };
}

/* ---------------------------------------------------------------- inspector */

export type EffectControlId =
  | "enabled"
  | "start"
  | "duration"
  | "intensity"
  | "speed"
  | "axis"
  | "easing"
  | "primaryColor"
  | "secondaryColor";

const ALWAYS: readonly EffectControlId[] = ["enabled", "start", "duration", "intensity"];

/**
 * Only the parameters the SELECTED CANONICAL effect actually supports. Nothing
 * is exposed that the canonical evaluator would ignore.
 */
export function relevantInspectorControls(type: LightingEffectType): readonly EffectControlId[] {
  switch (type) {
    case "FADE_IN":
    case "FADE_OUT":
      return [...ALWAYS, "easing", "primaryColor"];
    case "PULSE":
      return [...ALWAYS, "speed", "primaryColor"];
    case "COLOR_TRANSITION":
      return [...ALWAYS, "easing", "primaryColor", "secondaryColor"];
    case "COLOR_SWEEP":
      return [...ALWAYS, "axis", "primaryColor", "secondaryColor"];
    case "DIRECTIONAL_REVEAL":
      return [...ALWAYS, "axis", "easing", "primaryColor"];
    case "RADIAL_REVEAL":
    case "RADIAL_HIDE":
      return [...ALWAYS, "easing", "primaryColor"];
    case "GROUP_SEQUENCE":
      return [...ALWAYS, "easing"];
  }
}

/** Operator-readable label of an authored effect (timeline + inspector). */
export function effectPresetLabel(effect: LightingEffectInstance): string {
  const presetId = effect.metadata?.presetId;
  const preset = presetId ? LIGHTING_BY_CANONICAL.get(presetId) : undefined;
  return preset?.label ?? effect.type.replaceAll("_", " ").toLowerCase();
}

/** PULSE speed is authored as cycles inside the duration. */
export function pulseCycles(effect: LightingEffectInstance): number {
  const cycles = effect.parameters.cycles;
  return typeof cycles === "number" && cycles > 0 ? cycles : 1;
}
