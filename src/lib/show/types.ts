/**
 * DRONE SHOW STUDIO — Show Core domain model.
 *
 * This module is the single source of truth for show data. It is intentionally
 * platform agnostic: no Three.js, no React, no PX4/MAVLink/Skybrush concepts.
 * Adapters (see src/lib/adapters) translate this model to/from external
 * ecosystems. Heavy computation (>200 drones, full-show solving) is expected to
 * migrate behind the same interfaces to a Python computation service.
 */

export type Vec3 = readonly [number, number, number];
/** sRGB, 0-255. */
export type RGB = readonly [number, number, number];

export type FormationKind =
  | "grid"
  | "circle"
  | "sphere"
  | "helix"
  | "cube"
  | "wave"
  | "heart"
  | "text"
  | "custom";

export interface Formation {
  id: string;
  name: string;
  kind: FormationKind;
  /** Local show-frame points, metres. +Y is up. */
  points: Vec3[];
  /** Parameters used to (re)generate the point cloud. */
  params: Record<string, number | string>;
}

export type LightEffect = "solid" | "pulse" | "rainbow" | "chase" | "twinkle";
export type Easing = "linear" | "smooth" | "minJerk";

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
}

export interface SafetyLimits {
  maxVelocity: number; // m/s
  maxAcceleration: number; // m/s^2
  maxYawRate: number; // deg/s
  minSeparation: number; // m
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
  /** Seconds before the first beat. */
  offset: number;
  duration: number;
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
}

export interface DroneSample {
  position: Vec3;
  color: RGB;
}

export const HOME_ALTITUDE = 0;

export function showDuration(project: ShowProject): number {
  return project.timeline.reduce((end, c) => Math.max(end, c.start + c.transition + c.hold), 0);
}
