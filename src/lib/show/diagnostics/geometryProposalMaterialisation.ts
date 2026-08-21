/**
 * HYPOTHETICAL-PROJECT ELIGIBILITY RESOLVER — PURE / READ-ONLY.
 *
 * Decides which canonical materialiser can honestly represent a current-frame
 * geometry proposal. Legacy/simple formation holds use `projectWithFormationPoints`.
 * Authored STATIC scenes (including multi-object and deterministic sub-sampling)
 * use the scene proposal materialiser. Dynamic formations and transition instants
 * remain unavailable instead of being approximated.
 */
import { isCompositeScene, projectScene } from "../scene/migrate";
import { resolveSceneAt } from "../scene/resolve";
import { activeClipAt } from "../timeline";
import type { ShowProject } from "../types";

export type ProposalMaterialisation =
  | {
      readonly kind: "FORMATION";
      readonly clipId: string;
      readonly formationId: string;
      readonly pointCount: number;
    }
  | {
      readonly kind: "SCENE";
      readonly clipId: string;
      readonly sceneId: string;
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
    const scene = projectScene(project, clip.id);
    if (!scene) {
      return {
        kind: "UNAVAILABLE",
        reason: `${SCENE_MATERIALISER_MISSING_MESSAGE} (scene data missing).`,
      };
    }
    if (scene.objects.some((object) => object.source.kind !== "STATIC")) {
      return {
        kind: "UNAVAILABLE",
        reason: `${SCENE_MATERIALISER_MISSING_MESSAGE} (dynamic scene object).`,
      };
    }
    try {
      const resolvedCount = resolveSceneAt(project, scene).points.length;
      if (resolvedCount !== proposedPointCount) {
        return {
          kind: "UNAVAILABLE",
          reason: `Proposal covers ${proposedPointCount} point(s) but the static scene resolves to ${resolvedCount}.`,
        };
      }
      return {
        kind: "SCENE",
        clipId: clip.id,
        sceneId: scene.id,
        pointCount: proposedPointCount,
      };
    } catch (err) {
      return {
        kind: "UNAVAILABLE",
        reason: `${SCENE_MATERIALISER_MISSING_MESSAGE} (${err instanceof Error ? err.message : String(err)}).`,
      };
    }
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
