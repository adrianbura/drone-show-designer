/**
 * LIGHTING, REVEAL & COLOR EFFECTS — canonical domain model (Sprint 7.4).
 *
 * ARCHITECTURAL SEPARATION (non-negotiable)
 *   FORMATION          where drones are
 *   DYNAMIC FORMATION  how geometry moves
 *   LIGHTING EFFECT    how drone LEDs behave
 *
 * Lighting effects are PROJECT-OWNED artistic data. They never contain physical
 * drone identity, never touch geometry, assignment or trajectories, and applying
 * one never mutates a Formation Library asset: an effect targets a SCENE or a
 * SCENE OBJECT INSTANCE of the open project.
 *
 * Machine-readable identity (types, enums, ids, versions) is language-neutral
 * and is NEVER translated. Localisation is presentation only.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { RGB, Vector3Tuple } from "../types";

/** Persisted schema version of the lighting structures. */
export const LIGHTING_SCHEMA_VERSION = 1;
/** Bumped whenever identical input can evaluate to different LED output. */
export const LIGHTING_ALGORITHM_VERSION = "0.1.0";

export type LightingEffectType =
  | "FADE_IN"
  | "FADE_OUT"
  | "DIRECTIONAL_REVEAL"
  | "RADIAL_REVEAL"
  | "RADIAL_HIDE"
  | "PULSE"
  | "COLOR_TRANSITION"
  | "COLOR_SWEEP"
  | "GROUP_SEQUENCE";

export const LIGHTING_EFFECT_TYPES: readonly LightingEffectType[] = [
  "FADE_IN",
  "FADE_OUT",
  "DIRECTIONAL_REVEAL",
  "RADIAL_REVEAL",
  "RADIAL_HIDE",
  "PULSE",
  "COLOR_TRANSITION",
  "COLOR_SWEEP",
  "GROUP_SEQUENCE",
];

export type LightingEasing = "LINEAR" | "SMOOTH" | "MIN_JERK";
export const LIGHTING_EASINGS: readonly LightingEasing[] = ["LINEAR", "SMOOTH", "MIN_JERK"];

/** Only modes that make sense for LED choreography are exposed. */
export type LightingBlendMode = "REPLACE" | "MULTIPLY_INTENSITY" | "ADD";
export const LIGHTING_BLEND_MODES: readonly LightingBlendMode[] = [
  "REPLACE",
  "MULTIPLY_INTENSITY",
  "ADD",
];

/** Timing anchor of an effect. `start` is an offset relative to the anchor. */
export type LightingAnchor = "ABSOLUTE" | "SCENE_START" | "FORMATION_READY" | "SCENE_END";
export const LIGHTING_ANCHORS: readonly LightingAnchor[] = [
  "ABSOLUTE",
  "SCENE_START",
  "FORMATION_READY",
  "SCENE_END",
];

/**
 * Coordinate space the SPATIAL FIELD of a reveal/sweep is evaluated in.
 *   REFERENCE_SPACE  the deterministic scene target positions (default): a wing
 *                    flap never reorders which drones a reveal reaches first.
 *   WORLD_SPACE      the live sampled positions, for effects that intentionally
 *                    sweep across moving geometry.
 */
export type LightingSpace = "REFERENCE_SPACE" | "WORLD_SPACE";
export const LIGHTING_SPACES: readonly LightingSpace[] = ["REFERENCE_SPACE", "WORLD_SPACE"];

/** PLANAR ignores depth (Z) and uses the visual X/Y plane; SPATIAL is true 3D. */
export type LightingDistanceMode = "PLANAR" | "SPATIAL";
export const LIGHTING_DISTANCE_MODES: readonly LightingDistanceMode[] = ["PLANAR", "SPATIAL"];

/**
 * TARGET MODEL. `SCENE` and `SCENE_OBJECT` are implemented; the two group kinds
 * are part of the schema so semantic targeting (Body -> Wings) can be added
 * without redesigning the model or migrating projects.
 */
export type LightingTarget =
  | { readonly kind: "SCENE"; readonly clipId: string }
  | { readonly kind: "SCENE_OBJECT"; readonly clipId: string; readonly instanceId: string }
  | {
      readonly kind: "MOTION_GROUP";
      readonly clipId: string;
      readonly instanceId: string;
      readonly groupId: string;
    }
  | {
      readonly kind: "POINT_GROUP";
      readonly clipId: string;
      readonly instanceId: string;
      readonly pointIds: readonly string[];
    };

export type LightingTargetKind = LightingTarget["kind"];

/** Ordered gradient stop. `position` is 0..1 along the gradient. */
export interface GradientStop {
  readonly position: number;
  readonly color: RGB;
}

/** One stage of a GROUP_SEQUENCE effect: these groups light up together. */
export interface GroupSequenceStage {
  readonly groupIds: readonly string[];
}

/**
 * Every parameter is optional: presets fill in sensible defaults so a normal
 * user can add "Center -> Outside" without configuring vectors or maths.
 */
export interface LightingEffectParameters {
  readonly easing?: LightingEasing;
  /** Direction vector of a directional reveal/sweep (normalised on use). */
  readonly direction?: Vector3Tuple;
  /** Convenience 2D control: degrees CCW from +X in the X/Y plane. */
  readonly angleDeg?: number;
  /** Effect origin in the effect coordinate space. `null` = target centre. */
  readonly origin?: Vector3Tuple | null;
  /** 0 = hard activation boundary, 1 = fully gradual illumination band. */
  readonly softness?: number;
  readonly distanceMode?: LightingDistanceMode;
  readonly space?: LightingSpace;
  /** PULSE: number of complete cycles inside the effect duration. */
  readonly cycles?: number;
  /** PULSE: explicit cycle duration in seconds (overrides `cycles`). */
  readonly cycleDuration?: number;
  readonly minIntensity?: number;
  readonly maxIntensity?: number;
  /** PULSE phase offset in CYCLES (0..1 = one full cycle). */
  readonly phase?: number;
  readonly fromColor?: RGB;
  readonly toColor?: RGB;
  /** COLOR_SWEEP gradient. Two stops minimum; more are supported. */
  readonly stops?: readonly GradientStop[];
  /** Colour a reveal illuminates with. Absent = keep the base colour. */
  readonly color?: RGB;
  /** Overall intensity ceiling of the effect, 0..1. Defaults to 1. */
  readonly intensity?: number;
  readonly stages?: readonly GroupSequenceStage[];
  /** GROUP_SEQUENCE overlap between consecutive stages, 0..1. */
  readonly stageOverlap?: number;
}

export interface LightingEffectMetadata {
  /** Built-in preset this instance was created from. Provenance only. */
  readonly presetId?: string;
  /** Author note. Never machine-facing. */
  readonly note?: string;
}

/** One lighting effect instance of the project. */
export interface LightingEffectInstance {
  readonly id: string;
  readonly target: LightingTarget;
  readonly type: LightingEffectType;
  readonly anchor: LightingAnchor;
  /** Offset from the anchor in seconds (absolute show time when ABSOLUTE). */
  readonly start: number;
  readonly duration: number;
  readonly parameters: LightingEffectParameters;
  readonly blendMode: LightingBlendMode;
  /** Higher priority is applied later. Ties break on start, then on id. */
  readonly priority: number;
  readonly enabled: boolean;
  readonly metadata?: LightingEffectMetadata;
}

/** Project-owned, versioned lighting choreography. */
export interface LightingProgram {
  readonly schemaVersion: number;
  readonly effects: readonly LightingEffectInstance[];
}

export const EMPTY_LIGHTING_PROGRAM: LightingProgram = {
  schemaVersion: LIGHTING_SCHEMA_VERSION,
  effects: [],
};

/** CANONICAL LED OUTPUT — one deterministic state per drone per instant. */
export interface DroneLightState {
  /** sRGB 0-255, always integral and in gamut. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0..1, never negative, never NaN. */
  readonly intensity: number;
}

export const LIGHT_OFF: DroneLightState = { r: 0, g: 0, b: 0, intensity: 0 };

export type LightingIssueCode =
  | "INVALID_COLOR"
  | "INVALID_TIMING"
  | "INVALID_DURATION"
  | "INVALID_PARAMETER"
  | "UNRESOLVED_TARGET"
  | "OUTSIDE_SCENE_RANGE";

export interface LightingIssue {
  readonly id: string;
  readonly severity: "error" | "warning" | "info";
  readonly code: LightingIssueCode;
  readonly message: string;
  readonly effectId?: string;
  readonly clipId?: string;
  readonly time?: number;
}

export interface LightingValidationReport {
  readonly effectCount: number;
  readonly issues: readonly LightingIssue[];
  readonly algorithmVersion: string;
}

export type LightingErrorCode = "UNKNOWN_EFFECT" | "UNKNOWN_TARGET";

export class LightingError extends Error {
  readonly code: LightingErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: LightingErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "LightingError";
    this.code = code;
    this.details = details;
  }
}

/** Deterministic effect id. */
export function newLightingEffectId(seed: number): string {
  return `fx-${seed.toString(36)}`;
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clampByte(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function clampColor(color: RGB): RGB {
  return [clampByte(color[0]), clampByte(color[1]), clampByte(color[2])];
}

/** Effects that keep the target dark BEFORE they start (armed reveal). */
export function armsTargetDark(type: LightingEffectType): boolean {
  return (
    type === "FADE_IN" ||
    type === "DIRECTIONAL_REVEAL" ||
    type === "RADIAL_REVEAL" ||
    type === "GROUP_SEQUENCE"
  );
}

/** Effects that keep holding their end state AFTER they finish. */
export function sustainsAfterEnd(type: LightingEffectType): boolean {
  return type !== "PULSE";
}
