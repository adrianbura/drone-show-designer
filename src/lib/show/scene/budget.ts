/**
 * SCENE DRONE BUDGET.
 *
 * Answers one question in the user's language: how many physical drones does
 * this composition need, and how many are left for Sprint 7.3 roles?
 *
 *   sum(active objects) + PREPOSITION + HOLD + RESERVE + MANUAL = fleet size
 *
 * The budget NEVER truncates an object. When the objects need more drones than
 * the fleet has, `over` is positive and the caller must block the apply /
 * validation-ready state instead of silently deleting points.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { ShowProject } from "../types";
import { findDynamicSource, findStaticSource } from "./resolve";
import type { FormationScene, SceneFormationInstance } from "./types";

export interface SceneBudgetObject {
  readonly instanceId: string;
  readonly name: string;
  /** Physical drones this object needs (0 when its asset is missing). */
  readonly count: number;
  readonly available: boolean;
}

export interface SceneBudget {
  readonly sceneId: string;
  readonly fleet: number;
  readonly objects: readonly SceneBudgetObject[];
  /** Drones needed by all active objects together. */
  readonly active: number;
  /** Drones the Smart Reserve Planner may still use (0 when over capacity). */
  readonly availableDrones: number;
  /** Drones needed BEYOND the fleet size. > 0 means the scene is invalid. */
  readonly over: number;
  readonly overCapacity: boolean;
}

/** Physical drones one instance needs — asset points, or its requested budget. */
export function instanceDroneCount(project: ShowProject, instance: SceneFormationInstance): number {
  const assetPoints =
    instance.source.kind === "STATIC"
      ? (findStaticSource(project, instance.source.formationId)?.points.length ?? 0)
      : (findDynamicSource(project, instance.source.dynamicFormationId)?.points.length ?? 0);
  if (assetPoints === 0) return 0;
  const requested = instance.requestedDroneCount ?? assetPoints;
  return Math.max(0, Math.min(assetPoints, Math.round(requested)));
}

export function sceneBudget(
  project: ShowProject,
  scene: FormationScene,
  fleet = project.droneCount,
): SceneBudget {
  const objects = scene.objects.map((instance) => {
    const count = instanceDroneCount(project, instance);
    return {
      instanceId: instance.id,
      name: instance.name,
      count,
      available: count > 0,
    };
  });
  const active = objects.reduce((sum, o) => sum + o.count, 0);
  const over = Math.max(0, active - fleet);
  return {
    sceneId: scene.id,
    fleet,
    objects,
    active,
    availableDrones: Math.max(0, fleet - active),
    over,
    overCapacity: over > 0,
  };
}
