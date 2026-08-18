/**
 * SIMULTANEOUS MULTI-FORMATION SCENES — domain model (Sprint 7.3.5).
 *
 * ARCHITECTURAL PRINCIPLE
 *   FORMATION ASSET            reusable geometry / animation (library owned)
 *   SCENE FORMATION INSTANCE   how that asset appears in THIS scene
 *   FORMATION SCENE            one simultaneous visual composition
 *
 * A `FormationScene` is project-owned artistic data. It never contains physical
 * drone identity: the Fleet Participation Planner (Sprint 7.3) decides which
 * drones fly which point of which object. Object ids, formation point indices
 * and drone ids are three DIFFERENT identities and are never conflated.
 *
 * A scene is bound 1:1 to a timeline clip (`scene.id === clip.id`), so the
 * timeline stays scene-first and readable: one clip = one scene, however many
 * visual objects it contains.
 *
 * Machine-readable identity (kinds, ids, versions, semantic enums) is
 * language-neutral and is NEVER translated.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { LightEffect, RGB, Vector3Tuple } from "../types";

/** Persisted schema version of the scene structures. */
export const SCENE_SCHEMA_VERSION = 1;
/** Bumped whenever identical scene input can resolve to different geometry. */
export const SCENE_ALGORITHM_VERSION = "0.1.0";

/**
 * TRANSFORM HIERARCHY (documented, deterministic, render-order independent):
 *
 *   SCENE TRANSFORM
 *       -> OBJECT (INSTANCE) TRANSFORM
 *           -> DYNAMIC LOCAL MOTION (dynamic sampler)
 *               -> FORMATION POINT (asset-local metres)
 *
 * Per level the composition order is fixed:
 *   mirror -> scale -> rotate (Euler XYZ, degrees, around the pivot) -> translate
 */
export interface InstanceTransform {
  /** Translation in show-local metres (+Y up). */
  readonly position: Vector3Tuple;
  /** Euler XYZ rotation in degrees, applied around the pivot. */
  readonly rotationDeg: Vector3Tuple;
  /** Uniform scale. Non-uniform scale is intentionally not exposed yet. */
  readonly scale: number;
  /** Mirrors the local X axis around the pivot. Never mutates the asset. */
  readonly mirrorX?: boolean;
  /**
   * Explicit pivot in ASSET-LOCAL metres. When absent the pivot is the
   * deterministic geometric centre (component-wise mean) of the instance's
   * resolved base points — see `instancePivot`.
   */
  readonly pivot?: Vector3Tuple | null;
}

export const IDENTITY_INSTANCE_TRANSFORM: InstanceTransform = {
  position: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: 1,
};

/** Artistic per-object lighting. Choreography only; never flight relevant. */
export interface SceneObjectLighting {
  readonly color?: RGB;
  readonly effect?: LightEffect;
}

/** Per-instance animation state of a DYNAMIC object. */
export interface SceneObjectAnimation {
  /** Local animation time multiplier. Defaults to 1. */
  readonly playbackRate?: number;
  /** Local animation time the instance starts at (seconds). */
  readonly startOffset?: number;
  /** Extra phase shift in CYCLES (0..1 = one full cycle). Additive. */
  readonly phaseCycles?: number;
}

/**
 * FUTURE AI VISUAL GENERATOR readiness (Sprint 7.3.5 part AB). Purely
 * descriptive: nothing in the flight pipeline reads these fields.
 */
export interface SceneObjectMetadata {
  readonly semanticType?: string;
  readonly renderStrategy?: "CONTOUR" | "SEMANTIC_2D" | "ARTICULATED_2_5D" | "PARAMETRIC_3D";
  readonly note?: string;
}

export type SceneObjectSource =
  | { readonly kind: "STATIC"; readonly formationId: string }
  | { readonly kind: "DYNAMIC"; readonly dynamicFormationId: string };

/** One visual object of a scene: an INSTANCE of a formation asset. */
export interface SceneFormationInstance {
  readonly id: string;
  readonly name: string;
  readonly source: SceneObjectSource;
  /** Library asset this instance came from. Provenance only, may dangle. */
  readonly assetId?: string;
  readonly transform: InstanceTransform;
  /**
   * Requested ACTIVE drone budget. When smaller than the asset point count the
   * points are sub-sampled deterministically (evenly, never randomly). `null` /
   * absent means "every point of the asset".
   */
  readonly requestedDroneCount?: number | null;
  readonly animation?: SceneObjectAnimation;
  readonly lighting?: SceneObjectLighting;
  /** EDITOR-ONLY visibility. Never "drone lights off", never flight relevant. */
  readonly visible?: boolean;
  readonly metadata?: SceneObjectMetadata;
}

export interface FormationScene {
  /** Always equal to the timeline clip id that plays this scene. */
  readonly id: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly objects: readonly SceneFormationInstance[];
  /** Parent transform applied to the whole composition. */
  readonly transform: InstanceTransform;
  /** EDITOR-ONLY timeline expansion state. */
  readonly expanded?: boolean;
}

/** One resolved active target group of a scene, ready for the planner. */
export interface ResolvedSceneGroup {
  readonly groupId: string;
  readonly instanceId: string;
  readonly name: string;
  readonly formationId: string | null;
  readonly dynamicFormationId?: string;
  /** Offset of this group's first point in the combined point list. */
  readonly offset: number;
  readonly pointCount: number;
}

/** A scene resolved to combined world-space target points at one local time. */
export interface ResolvedScene {
  readonly sceneId: string;
  readonly groups: readonly ResolvedSceneGroup[];
  /** Combined points: group order, then formation point order. */
  readonly points: readonly Vector3Tuple[];
  /** Combined stable point ids, index aligned with `points`. */
  readonly pointIds: readonly string[];
  /** True when at least one object animates during the hold. */
  readonly animated: boolean;
}

export type SceneErrorCode = "MISSING_SOURCE" | "EMPTY_OBJECT" | "OVER_CAPACITY";

export class SceneError extends Error {
  readonly code: SceneErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: SceneErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SceneError";
    this.code = code;
    this.details = details;
  }
}

/** Deterministic instance id. */
export function newSceneObjectId(seed: number): string {
  return `obj-${seed.toString(36)}`;
}
