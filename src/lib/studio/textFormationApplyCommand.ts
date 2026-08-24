/**
 * STATIC TEXT APPLY — PREPARATION OF ONE ATOMIC AUTHORING REVISION.
 *
 * WHAT AN APPLY MEANS
 *   The clip's STATIC geometry is replaced by a NEW planner-owned text
 *   formation. The clip keeps its identity, timing (start / transition / hold),
 *   easing, phase, lighting program and participation. Imported source bytes are
 *   never touched, so ESSP source recovery and re-export of untouched clips
 *   remain possible.
 *
 * WHAT THE APPLY DELIBERATELY DOES NOT DO
 *   - it does not rebuild the show: only the edited clip's hold and the
 *     mathematically necessary transition boundaries are promoted, which is
 *     derived by `reconcileReferenceLayer` / `resolveReferenceIntervals`
 *   - it does not transfer imported point identity: the audit established that
 *     `essp-clip-31` has no usable target correspondence, so the text formation
 *     is a clean rebuild and re-assignment is expected
 *   - it does not delete the replaced formation asset: other clips and source
 *     recovery may still reference it
 *
 * Pure module: no React, no I/O, no store access. The store only installs the
 * prepared snapshots via `installPreparedGeometryApply`.
 */
import { resolveReferenceIntervals, type ReferenceTrajectoryLayer } from "../import/essp/native";
import type { GeometryApplyReadinessReport } from "../show/diagnostics/geometryApplyReadiness";
import type { AssignmentStrategyId } from "../show/assignment";
import type { FormationScene } from "../show/scene";
import { makeTextFormation } from "../show/text";
import type { Formation, ShowProject } from "../show/types";
import type { ClipTransitionOverride } from "../show/trajectory";
import type { TransitionDesignState } from "../show/transition";
import {
  prepareGeometryApplyCommand,
  type GeometryApplyPreparationSuccess,
} from "./geometryApplyCommand";
import {
  previewTextFormation,
  type TextPreviewBlocker,
  type TextPreviewRequest,
} from "./textFormationPreview";

export interface TextApplyInput {
  readonly project: ShowProject;
  readonly request: TextPreviewRequest;
  /** Deterministic id supplied by the command boundary, never generated here. */
  readonly formationId: string;
  readonly formationName?: string;
  readonly transitionOverrides: Readonly<Record<string, ClipTransitionOverride>>;
  readonly transitionDesigns?: Readonly<Record<string, TransitionDesignState>>;
  readonly referenceLayer?: ReferenceTrajectoryLayer | null;
  readonly assignmentStrategy: AssignmentStrategyId;
  /** Stable timestamp supplied by the command boundary. */
  readonly promotedAt: string;
}

export interface PromotedTextInterval {
  readonly clipId: string;
  readonly kind: "TRANSITION" | "HOLD";
  readonly start: number;
  readonly end: number;
}

export interface TextApplyPreparationSuccess {
  readonly ok: true;
  readonly prepared: GeometryApplyPreparationSuccess;
  readonly formation: Formation;
  readonly replacedFormationId: string;
  readonly objectId: string | null;
  /** Reference intervals that changed from REFERENCE to PLANNER ownership. */
  readonly newlyPlannedIntervals: readonly PromotedTextInterval[];
  readonly note: string;
}

export interface TextApplyPreparationFailure {
  readonly ok: false;
  readonly blockers: readonly (TextPreviewBlocker | "APPLY_BLOCKED")[];
  readonly note: string;
}

export type TextApplyPreparationResult = TextApplyPreparationSuccess | TextApplyPreparationFailure;

function plannedIntervals(layer: ReferenceTrajectoryLayer | null | undefined): Set<string> {
  if (!layer) return new Set();
  return new Set(
    resolveReferenceIntervals(layer)
      .filter((interval) => interval.owner === "PLANNER")
      .map((interval) => `${interval.clipId}|${interval.kind}|${interval.start}|${interval.end}`),
  );
}

function readiness(clipId: string): GeometryApplyReadinessReport {
  return {
    status: "READY",
    canApply: true,
    blockers: [],
    warnings: [],
    newlyPromotedClipIds: [clipId],
    note: `Deterministic text geometry is ready to replace the static geometry of ${clipId}.`,
  };
}

/**
 * Prepares the complete revision. The caller must install `prepared.after`
 * (project + pruned overrides + reconciled reference layer) as ONE history
 * entry; a partial commit would break undo/redo and imported ownership.
 */
export function prepareTextFormationApply(input: TextApplyInput): TextApplyPreparationResult {
  const preview = previewTextFormation(input.project, input.request);
  if (!preview.ok) return { ok: false, blockers: preview.blockers, note: preview.note };

  const { formation } = makeTextFormation({
    id: input.formationId,
    name: input.formationName ?? `Text — ${input.request.recipe.text}`,
    recipe: input.request.recipe,
    authoredForClipId: preview.clipId,
    ...(preview.objectId ? { authoredForObjectId: preview.objectId } : {}),
  });

  // The replaced asset is kept: other clips and ESSP source recovery may use it.
  const formations = [...input.project.formations, formation];
  const timeline = input.project.timeline.map((clip) =>
    clip.id === preview.clipId ? { ...clip, formationId: formation.id } : clip,
  );
  const scenes: FormationScene[] | undefined = input.project.scenes?.map((scene) =>
    scene.id === preview.clipId && preview.objectId
      ? {
          ...scene,
          objects: scene.objects.map((object) =>
            object.id === preview.objectId
              ? { ...object, source: { kind: "STATIC" as const, formationId: formation.id } }
              : object,
          ),
        }
      : scene,
  );

  const afterProject: ShowProject = {
    ...input.project,
    formations,
    timeline,
    ...(scenes ? { scenes } : {}),
  };

  const prepared = prepareGeometryApplyCommand({
    beforeProject: input.project,
    afterProject,
    readiness: readiness(preview.clipId),
    transitionOverrides: input.transitionOverrides,
    ...(input.transitionDesigns ? { transitionDesigns: input.transitionDesigns } : {}),
    referenceLayer: input.referenceLayer ?? null,
    assignmentStrategy: input.assignmentStrategy,
    promotedAt: input.promotedAt,
  });
  if (!prepared.ok) return { ok: false, blockers: ["APPLY_BLOCKED"], note: prepared.note };

  const before = plannedIntervals(input.referenceLayer);
  const newlyPlannedIntervals = (
    input.referenceLayer ? resolveReferenceIntervals(prepared.after.referenceLayer!) : []
  )
    .filter(
      (interval) =>
        interval.owner === "PLANNER" &&
        !before.has(`${interval.clipId}|${interval.kind}|${interval.start}|${interval.end}`),
    )
    .map((interval) => ({
      clipId: interval.clipId,
      kind: interval.kind,
      start: interval.start,
      end: interval.end,
    }));

  return {
    ok: true,
    prepared,
    formation,
    replacedFormationId: preview.replacedFormationId,
    objectId: preview.objectId,
    newlyPlannedIntervals,
    note: "PREPARED ATOMIC TEXT APPLY. Clip identity, timing, lighting, participation and imported source bytes are preserved; only the edited clip's geometry and the derived transition boundaries become planner owned.",
  };
}
