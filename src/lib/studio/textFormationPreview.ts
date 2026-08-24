/**
 * TEXT PREVIEW TRANSACTION — ZERO PROJECT MUTATION.
 *
 * A preview NEVER touches the project, the reference layer, the transition
 * overrides, the history stack or the participation plan. It only answers:
 * "if the operator applied this recipe to this clip, what geometry would the
 * planner own, and what would it replace?". Cancelling a preview is therefore
 * a pure discard — there is nothing to roll back by construction.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import { generateTextGeometry, TextGeometryError, type TextGeometryRecipe, type TextGeometryResult } from "../show/text";
import type { ShowProject, Vec3 } from "../show/types";

export type TextPreviewBlocker =
  | "CLIP_NOT_FOUND"
  | "OBJECT_NOT_FOUND"
  | "DYNAMIC_CLIP_UNSUPPORTED"
  | "DYNAMIC_OBJECT_UNSUPPORTED"
  | "FORMATION_NOT_FOUND"
  | "PARTICIPATION_MISMATCH"
  | `GEOMETRY_${string}`;

export interface TextPreviewRequest {
  readonly clipId: string;
  /** Scene object to replace. Omitted for a clip without an authored scene. */
  readonly objectId?: string;
  readonly recipe: TextGeometryRecipe;
}

export interface TextPreviewSuccess {
  readonly ok: true;
  readonly clipId: string;
  readonly objectId: string | null;
  /** Formation asset the preview would replace. */
  readonly replacedFormationId: string;
  readonly replacedPointCount: number;
  readonly geometry: TextGeometryResult;
  readonly points: readonly Vec3[];
  readonly note: string;
}

export interface TextPreviewFailure {
  readonly ok: false;
  readonly blockers: readonly TextPreviewBlocker[];
  readonly note: string;
}

export type TextPreviewResult = TextPreviewSuccess | TextPreviewFailure;

function fail(blocker: TextPreviewBlocker, note: string): TextPreviewFailure {
  return { ok: false, blockers: [blocker], note };
}

/** Resolves the formation a text replacement would take over, if any. */
export function resolveTextPreviewTarget(
  project: ShowProject,
  clipId: string,
  objectId?: string,
): { readonly formationId: string; readonly objectId: string | null } | TextPreviewFailure {
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip) return fail("CLIP_NOT_FOUND", `Clip ${clipId} is not part of the open show.`);
  if (clip.dynamicFormationId && !objectId) {
    return fail(
      "DYNAMIC_CLIP_UNSUPPORTED",
      "This foundation replaces STATIC clip geometry only; the clip plays a dynamic formation.",
    );
  }
  const scene = project.scenes?.find((s) => s.id === clipId);
  if (objectId) {
    const object = scene?.objects.find((o) => o.id === objectId);
    if (!object) return fail("OBJECT_NOT_FOUND", `Object ${objectId} is not part of scene ${clipId}.`);
    if (object.source.kind !== "STATIC") {
      return fail("DYNAMIC_OBJECT_UNSUPPORTED", "Only STATIC scene objects can be replaced by text.");
    }
    return { formationId: object.source.formationId, objectId };
  }
  if (scene && scene.objects.length > 1) {
    return fail(
      "OBJECT_NOT_FOUND",
      "The clip renders several objects; the object to replace must be named explicitly.",
    );
  }
  const single = scene?.objects[0];
  if (single) {
    if (single.source.kind !== "STATIC") {
      return fail("DYNAMIC_OBJECT_UNSUPPORTED", "Only STATIC scene objects can be replaced by text.");
    }
    return { formationId: single.source.formationId, objectId: single.id };
  }
  return { formationId: clip.formationId, objectId: null };
}

/**
 * Read-only preview. `project` is never copied, edited or returned: the caller
 * receives geometry only.
 */
export function previewTextFormation(
  project: ShowProject,
  request: TextPreviewRequest,
): TextPreviewResult {
  const target = resolveTextPreviewTarget(project, request.clipId, request.objectId);
  if ("ok" in target) return target;

  const formation = project.formations.find((f) => f.id === target.formationId);
  if (!formation) {
    return fail("FORMATION_NOT_FOUND", `Formation ${target.formationId} is missing from the show.`);
  }
  if (request.recipe.participation !== formation.points.length) {
    return fail(
      "PARTICIPATION_MISMATCH",
      `Text participation must stay at ${formation.points.length} active drones; the recipe asks for ${request.recipe.participation}.`,
    );
  }

  let geometry: TextGeometryResult;
  try {
    geometry = generateTextGeometry(request.recipe);
  } catch (error) {
    if (error instanceof TextGeometryError) {
      return fail(`GEOMETRY_${error.code}` as TextPreviewBlocker, error.message);
    }
    throw error;
  }

  return {
    ok: true,
    clipId: request.clipId,
    objectId: target.objectId,
    replacedFormationId: formation.id,
    replacedPointCount: formation.points.length,
    geometry,
    points: geometry.points,
    note: "PREVIEW ONLY. No project, reference-layer, override, participation or history state was read for writing or modified.",
  };
}

/**
 * Explicit cancel contract: a preview owns no state, so discarding it is a
 * documented no-op that can never leave a partial edit behind.
 */
export function discardTextPreview(_preview: TextPreviewResult | null): null {
  return null;
}
