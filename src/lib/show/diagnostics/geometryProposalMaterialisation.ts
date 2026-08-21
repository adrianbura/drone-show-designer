/**
 * HYPOTHETICAL-PROJECT ELIGIBILITY RESOLVER — PURE / READ-ONLY.
 *
 * Decides whether a geometry proposal at a given show instant corresponds to a
 * SIMPLE REUSABLE FORMATION whose point cloud can honestly be swapped by the
 * canonical `projectWithFormationPoints` helper. Composed scenes, dynamic
 * formations and transition instants are reported as UNAVAILABLE instead of
 * being faked through a formation mutation that the real authoring path would
 * never perform.
 *
 * This module never mutates the project and never applies anything.
 */
import { isCompositeScene } from "../scene/migrate";
import { activeClipAt } from "../timeline";
import type { ShowProject } from "../types";

export type ProposalMaterialisation =
  | {
      readonly kind: "FORMATION";
      readonly clipId: string;
      readonly formationId: string;
      readonly pointCount: number;
    }
  | { readonly kind: "UNAVAILABLE"; readonly reason: string };

export const SCENE_MATERIALISER_MISSING_MESSAGE =
  "Full trajectory consequence preview unavailable for this scene representation";

export function resolveProposalMaterialisation(
  project: ShowProject,
  time: number,
  proposedPointCount: number,
): ProposalMaterialisation {
  const clip = activeClipAt(project, time);
  if (!clip) {
    return { kind: "UNAVAILABLE", reason: "No timeline clip governs this instant." };
  }
  if (time < clip.start + clip.transition - 1e-9) {
    return {
      kind: "UNAVAILABLE",
      reason: "This instant is inside a transition, not a formation hold.",
    };
  }
  if (clip.dynamicFormationId) {
    return {
      kind: "UNAVAILABLE",
      reason: `${SCENE_MATERIALISER_MISSING_MESSAGE} (dynamic formation hold).`,
    };
  }
  if (isCompositeScene(project, clip)) {
    return {
      kind: "UNAVAILABLE",
      reason: `${SCENE_MATERIALISER_MISSING_MESSAGE} (composed multi-object scene).`,
    };
  }
  const formation = project.formations.find((f) => f.id === clip.formationId);
  if (!formation) {
    return { kind: "UNAVAILABLE", reason: "The clip's formation could not be resolved." };
  }
  if (formation.points.length !== proposedPointCount) {
    return {
      kind: "UNAVAILABLE",
      reason: `Proposal covers ${proposedPointCount} point(s) but the formation defines ${formation.points.length}.`,
    };
  }
  return {
    kind: "FORMATION",
    clipId: clip.id,
    formationId: formation.id,
    pointCount: proposedPointCount,
  };
}
