/**
 * DRONE SHOW STUDIO — Show Core domain model.
 *
 * Single source of truth for show data. Platform agnostic: no Three.js, no
 * React, no PX4/MAVLink/Skybrush concepts. Adapters (src/lib/adapters)
 * translate this model to/from external ecosystems.
 *
 * Units and axes: see src/lib/show/coordinates.ts (metres, seconds, degrees,
 * +Y up, ground at y = 0).
 */

/** Canonical 3-component vector tuple in show-local metres. */
export type Vector3Tuple = readonly [number, number, number];
/** Legacy alias kept so existing call sites keep compiling. */
export type Vec3 = Vector3Tuple;
/** sRGB, 0-255. */
export type RGB = readonly [number, number, number];

import type { SvgFormationSource } from "./svg/types";
import type { TextFormationSource } from "./text/types";
import type { PreShowConfig } from "./preshow/types";
import type { DynamicFormation } from "./dynamic/types";
import type { MusicSection, TimelineMarker } from "./markers";
import type { ParticipationSettings } from "./participation/types";
import type { FormationScene } from "./scene/types";
import type { LightingProgram } from "./lighting/types";



export type FormationKind =
  | "grid"
  | "circle"
  | "sphere"
  | "helix"
  | "cube"
  | "wave"
  | "heart"
  | "text"
  | "svg"
  | "custom";

export interface Formation {
  id: string;
  name: string;
  kind: FormationKind;
  /** Local show-frame points, metres. +Y is up. */
  points: Vec3[];
  /** Parameters used to (re)generate the point cloud. Includes `seed`. */
  params: Record<string, number | string>;
  /**
   * Reproducibility metadata for formations generated from an imported SVG
   * asset. Present only when `kind === "svg"`; every other layer ignores it.
   */
  svg?: SvgFormationSource;
  /**
   * Deterministic text recipe this formation was generated from. Present only
   * for planner-owned text formations built by the bundled glyph pack; every
   * other layer ignores it. Its presence is what makes the geometry
   * reproducible after Save/Open without re-running any browser code.
   */
  text?: TextFormationSource;
}

export type LightEffect = "solid" | "pulse" | "rainbow" | "chase" | "twinkle";
export type Easing = "linear" | "smooth" | "minJerk";

/**
 * Explicit choreography phases. TAKEOFF and LANDING have vertical semantics and
 * are planned differently from SHOW transitions; LANDING always ends at y = 0.
 * PRE_SHOW covers everything before SHOW TIME ZERO (launch grid -> staging) and
 * only ever occupies negative show time — see src/lib/show/preshow.
 */
export type ShowPhase = "PRE_SHOW" | "TAKEOFF" | "SHOW" | "LANDING";

export interface TimelineClip {
  id: string;
  formationId: string;
  /** Seconds from show start when the transition into this formation begins. */
  start: number;
  /** Seconds spent morphing from the previous formation. */
  transition: number;
  /** Seconds held after the transition completes. */
  hold: number;
  easing: Easing;
  color: RGB;
  effect: LightEffect;
  /** Defaults to "SHOW" when absent (backward compatible). */
  phase?: ShowPhase;
  /**
   * When set (and resolvable in `project.dynamicFormations`) the clip's HOLD
   * plays a living formation instead of standing still. The transition into the
   * clip still morphs to the animation state at `dynamicStartOffset`.
   */
  dynamicFormationId?: string;
  /** Local animation time multiplier during the hold. Defaults to 1. */
  playbackRate?: number;
  /** Local animation time the hold starts at. Defaults to 0. */
  dynamicStartOffset?: number;
}


export interface SafetyLimits {
  maxVelocity: number; // m/s
  maxAcceleration: number; // m/s^2
  maxJerk: number; // m/s^3
  maxYawRate: number; // deg/s
  minSeparation: number; // m
  minAltitude: number; // m — minimum altitude while airborne
  maxAltitude: number; // m
}

export interface ShowArea {
  width: number; // X, m
  depth: number; // Z, m
  height: number; // Y, m
}

export interface AudioTrack {
  name: string;
  bpm: number;
  /**
   * True once a local audio file has been attached in this session. Audio bytes
   * are NEVER stored in the project file — only this metadata is, so a reopened
   * project asks the operator to re-attach the same file.
   */
  attached?: boolean;
  /** Seconds before the first beat. */
  offset: number;
  /** Duration of the AUDIO FILE. This is NOT the show duration. */
  duration: number;
}

/**
 * Placeholder for future real audio analysis (librosa/aubio in the computation
 * service). Nothing fakes onsets today: only `bpm`/`beats` derived from the
 * manual tempo grid are ever populated, and `source` says so.
 */
export interface AudioAnalysisResult {
  source: "manual-bpm-grid" | "analysis";
  bpm: number;
  beats: number[];
  bars: number[];
  onsets?: number[];
  sections?: { start: number; end: number; label: string }[];
  energy?: number[];
  confidence?: number;
}

/** Altitude contract for the explicit choreography phases (metres, +Y up). */
export interface PhaseAltitudes {
  takeoff: number;
  show: number;
  landing: number;
}

export interface ProjectVersions {
  schemaVersion: string;
  trajectoryAlgorithmVersion: string;
  formationAlgorithmVersion: string;
  /** Absent in projects saved before the dynamic formation engine. */
  dynamicFormationAlgorithmVersion?: string;
}

export interface ShowProject {
  id: string;
  name: string;
  droneCount: number;
  area: ShowArea;
  limits: SafetyLimits;
  audio: AudioTrack;
  formations: Formation[];
  timeline: TimelineClip[];
  altitudes: PhaseAltitudes;
  versions: ProjectVersions;
  /** Deterministic seed for every generator that needs pseudo-randomness. */
  seed: number;
  /**
   * Launch grid / staging / grouped-takeoff configuration. When
   * `preShow.enabled` is false the project behaves exactly as before: the show
   * starts at t = 0 with no pre-show trajectories.
   */
  preShow?: PreShowConfig;
  /**
   * Living formations (global motion + internal deformation). Purely additive:
   * a project without any behaves exactly as before.
   */
  dynamicFormations?: DynamicFormation[];
  /**
   * SIMULTANEOUS MULTI-FORMATION SCENES (Sprint 7.3.5). One entry per timeline
   * clip that composes SEVERAL visual objects (`scene.id === clip.id`). Clips
   * without an entry keep the legacy single-formation behaviour exactly.
   */
  scenes?: FormationScene[];

  /**
   * AUTHORING ANNOTATIONS (Sprint 7.2). Project-owned editor metadata: markers
   * and music sections are persisted with the show but never influence flight
   * computation, validation or any machine-facing export.
   */
  markers?: TimelineMarker[];
  musicSections?: MusicSection[];
  /**
   * FLEET PARTICIPATION (Sprint 7.3). USER-OWNED settings that decide what the
   * drones a formation does not use should do. Derived participation plans are
   * always recomputed from these inputs and are never persisted as truth.
   */
  participation?: ParticipationSettings;
  /**
   * LIGHTING, REVEAL & COLOR EFFECTS (Sprint 7.4). Project-owned artistic LED
   * choreography. Purely additive: a project without a lighting program behaves
   * exactly as before, and lighting never influences flight computation.
   */
  lighting?: LightingProgram;
}


export interface DroneSample {
  position: Vec3;
  color: RGB;
}

export const GROUND_ALTITUDE = 0;
/** @deprecated use GROUND_ALTITUDE */
export const HOME_ALTITUDE = 0;

export const SCHEMA_VERSION = "1.0";
export const TRAJECTORY_ALGORITHM_VERSION = "0.1.0";
export const FORMATION_ALGORITHM_VERSION = "0.1.0";
export const SVG_FORMATION_ALGORITHM_VERSION = "0.1.0";

/** Canonical show duration. Never use `project.audio.duration` for this. */
export function showDuration(project: ShowProject): number {
  return project.timeline.reduce((end, c) => Math.max(end, c.start + c.transition + c.hold), 0);
}

/**
 * Resolves the dynamic formation a clip animates, or undefined for an ordinary
 * static clip. A clip referencing a missing dynamic formation degrades to a
 * static hold instead of failing the plan.
 */
export function resolveDynamicFormation(
  project: ShowProject,
  clip: TimelineClip,
): DynamicFormation | undefined {
  if (!clip.dynamicFormationId) return undefined;
  return project.dynamicFormations?.find((d) => d.id === clip.dynamicFormationId);
}

export function isDynamicClip(project: ShowProject, clip: TimelineClip): boolean {
  return !!resolveDynamicFormation(project, clip);
}



export function clipPhase(clip: TimelineClip): ShowPhase {
  return clip.phase ?? "SHOW";
}
