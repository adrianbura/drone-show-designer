/**
 * LIGHTING AUTHORING TARGET RESOLUTION.
 *
 * Converts the Scene editor's canonical object selection into the existing
 * LightingTarget schema. No UI state or LED maths lives here.
 *
 * Rules:
 * - explicit object selection => one SCENE_OBJECT target per valid selected
 *   object, in scene order (stable regardless of click order);
 * - empty/stale selection => the whole SCENE target;
 * - unknown/duplicate object ids are ignored;
 * - selecting every object is NOT collapsed to SCENE: spatial effects use the
 *   target's own bounds/centre, so per-object and scene-wide effects are not
 *   semantically equivalent.
 */
import type { FormationScene } from "../scene/types";
import type { LightingTarget } from "./types";

export type LightingAuthoringScope = "SCENE" | "SELECTION";

export interface LightingAuthoringTargets {
  readonly scope: LightingAuthoringScope;
  readonly targets: readonly LightingTarget[];
  /** Valid selected object ids in deterministic scene order. */
  readonly objectIds: readonly string[];
}

export function lightingTargetsFromSceneSelection(
  clipId: string,
  scene: FormationScene | null | undefined,
  selectedObjectIds: readonly string[],
): LightingAuthoringTargets {
  if (!scene || selectedObjectIds.length === 0) {
    return {
      scope: "SCENE",
      targets: [{ kind: "SCENE", clipId }],
      objectIds: [],
    };
  }

  const selected = new Set(selectedObjectIds);
  const objectIds = scene.objects.filter((object) => selected.has(object.id)).map((object) => object.id);

  if (objectIds.length === 0) {
    return {
      scope: "SCENE",
      targets: [{ kind: "SCENE", clipId }],
      objectIds: [],
    };
  }

  return {
    scope: "SELECTION",
    targets: objectIds.map((instanceId) => ({
      kind: "SCENE_OBJECT" as const,
      clipId,
      instanceId,
    })),
    objectIds,
  };
}

/** Human-readable, presentation-neutral summary data for buttons/tooltips. */
export function describeLightingAuthoringTargets(resolved: LightingAuthoringTargets): {
  readonly scope: LightingAuthoringScope;
  readonly targetCount: number;
} {
  return { scope: resolved.scope, targetCount: resolved.targets.length };
}
