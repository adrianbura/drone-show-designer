/**
 * LIGHTING AUTHORING HELPERS.
 *
 * Pure bridge between Scene Editor selection and the canonical lighting model.
 * React/store code must not invent target ordering or duplicate one preset per
 * selected object itself; that policy lives here.
 */
import type { FormationScene } from "../scene/types";
import {
  createEffectFromPreset,
  type CreateEffectOptions,
  type LightingPreset,
} from "./presets";
import type { LightingEffectInstance, LightingTarget } from "./types";

/**
 * Resolve the current scene selection to canonical lighting targets.
 *
 * Empty selection means the whole scene. A non-empty selection resolves to one
 * SCENE_OBJECT target per valid selected object, in scene order. Stale and
 * duplicate ids are ignored. Selecting every object deliberately does NOT
 * collapse back to SCENE: spatial effects evaluated per-object are not
 * equivalent to one scene-wide spatial field.
 */
export function lightingTargetsForSceneSelection(
  clipId: string,
  scene: FormationScene | null,
  selectedObjectIds: readonly string[],
): LightingTarget[] {
  if (!scene || selectedObjectIds.length === 0) {
    return [{ kind: "SCENE", clipId }];
  }

  const selected = new Set(selectedObjectIds);
  const targets = scene.objects
    .filter((object) => selected.has(object.id))
    .map(
      (object): LightingTarget => ({
        kind: "SCENE_OBJECT",
        clipId,
        instanceId: object.id,
      }),
    );

  // A selection that contains only stale ids is safer as a scene-wide action
  // than as a silent no-op. Selection reconciliation normally prevents this,
  // but the domain helper remains total for imported/legacy state.
  return targets.length > 0 ? targets : [{ kind: "SCENE", clipId }];
}

/**
 * Instantiate one preset across canonical targets as one authoring batch.
 * IDs are unique and deterministic when idSeed is supplied.
 */
export function createEffectsFromPresetForTargets(
  preset: LightingPreset,
  targets: readonly LightingTarget[],
  options: CreateEffectOptions = {},
): LightingEffectInstance[] {
  const baseSeed = options.idSeed ?? Date.now();
  return targets.map((target, index) =>
    createEffectFromPreset(preset, target, {
      ...options,
      idSeed: baseSeed + index,
    }),
  );
}
