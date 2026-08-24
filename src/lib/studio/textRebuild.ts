/**
 * TEXT REBUILD — ELIGIBILITY, DEFAULTS AND EVIDENCE IDENTITY (pure).
 *
 * ONE authority answers "can this clip be rebuilt as deterministic text?", and
 * it answers it from the SAME target resolution the preview transaction uses
 * (`resolveTextPreviewTarget`), so the context menu can never offer something
 * the preview would then refuse. Dynamic clips, dynamic scene objects and
 * multi-object scenes stay unavailable WITH the explicit reason produced by that
 * resolver.
 *
 * The evidence identity here is what makes stale readiness impossible: canonical
 * analysis is only valid for one (project revision, clip, object, recipe,
 * assignment strategy) tuple.
 *
 * Pure module: no React, no DOM, no store access.
 */
import { makeTextRecipe, type TextGeometryRecipe } from "../show/text";
import type { ShowProject } from "../show/types";
import { resolveTextPreviewTarget } from "./textFormationPreview";

export interface TextRebuildEligibility {
  readonly available: boolean;
  /** Always present when `available` is false. */
  readonly reason?: string;
  readonly clipId: string;
  readonly objectId: string | null;
  readonly formationId: string | null;
  /** Exact number of active drones the text must occupy. */
  readonly participation: number;
}

export function resolveTextRebuildEligibility(
  project: ShowProject,
  clipId: string,
): TextRebuildEligibility {
  const target = resolveTextPreviewTarget(project, clipId);
  if ("ok" in target) {
    return {
      available: false,
      reason: target.note,
      clipId,
      objectId: null,
      formationId: null,
      participation: 0,
    };
  }
  const formation = project.formations.find((f) => f.id === target.formationId);
  if (!formation) {
    return {
      available: false,
      reason: `Formation ${target.formationId} is missing from the show.`,
      clipId,
      objectId: target.objectId,
      formationId: target.formationId,
      participation: 0,
    };
  }
  return {
    available: true,
    clipId,
    objectId: target.objectId,
    formationId: formation.id,
    participation: formation.points.length,
  };
}

/**
 * Editor defaults. Participation is NOT a free parameter: it must equal the
 * replaced formation's point count, otherwise the preview blocks.
 */
export function defaultTextRecipe(participation: number, text = "TEXT"): TextGeometryRecipe {
  return makeTextRecipe({
    text,
    weight: "REGULAR",
    style: "UPRIGHT",
    widthMeters: 90,
    heightMeters: 24,
    letterSpacingEm: 0.8,
    alignment: "CENTER",
    participation,
    outlineRatio: 0.7,
    bandOffsetEm: 0.35,
    seed: 1,
  });
}

/** Deterministic formation id — identical recipe ⇒ identical asset identity. */
export function textFormationIdFor(clipId: string, recipeHash: string): string {
  return `formation-text-${clipId}-${recipeHash}`;
}

export interface TextEvidenceIdentity {
  readonly projectId: string;
  /** Canonical analysis revision of the open document. */
  readonly analysisRevision: string;
  readonly clipId: string;
  readonly objectId: string | null;
  readonly recipeHash: string;
  readonly assignmentStrategy: string;
}

/**
 * Canonical readiness binding. Any change to the target, the recipe, the project
 * revision, the assignment strategy or the relevant planning state changes this
 * key, which discards previously computed analysis.
 */
export function textEvidenceKey(identity: TextEvidenceIdentity): string {
  return [
    identity.projectId,
    identity.analysisRevision,
    identity.clipId,
    identity.objectId ?? "-",
    identity.recipeHash,
    identity.assignmentStrategy,
  ].join("|");
}
