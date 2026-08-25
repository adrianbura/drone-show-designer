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
  type TextPreviewSuccess,
} from "./textFormationPreview";

export interface TextApplyInput {
  readonly project: ShowProject;
  readonly request: TextPreviewRequest;
  /**
   * REAL canonical readiness evidence produced by
   * `evaluateGeometryApplyReadiness` for this proposal. This module never
   * synthesizes readiness: missing or blocked canonical evidence must prevent
   * Apply, and the report is forwarded to `prepareGeometryApplyCommand`
   * unchanged.
   */
  readonly readiness: GeometryApplyReadinessReport | null | undefined;
  /** Deterministic id supplied by the command boundary, never generated here. */
  readonly formationId: string;
  readonly formationName?: string;
  readonly transitionOverrides: Readonly<Record<string, ClipTransitionOverride>>;
  /** Exact candidate overrides used by the canonical consequence analysis. */
  readonly candidateTransitionOverrides?: Readonly<Record<string, ClipTransitionOverride>>;
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
  readonly feasibility: TextPreviewSuccess["feasibility"];
  readonly prepared: GeometryApplyPreparationSuccess;
  readonly formation: Formation;
  readonly replacedFormationId: string;
  readonly objectId: string | null;
  /** Reference intervals that changed from REFERENCE to PLANNER ownership. */
  readonly newlyPlannedIntervals: readonly PromotedTextInterval[];
  readonly note: string;
}

export type TextApplyBlocker =
  | TextPreviewBlocker
  | "READINESS_MISSING"
  | "READINESS_BLOCKED"
  | "FORMATION_ID_COLLISION"
  | "TEXT_INFEASIBLE"
  | "APPLY_BLOCKED";

export interface TextApplyPreparationFailure {
  readonly ok: false;
  readonly blockers: readonly TextApplyBlocker[];
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

/**
 * ONE CANONICAL CANDIDATE MATERIALISATION, shared by the review UI (which runs
 * the canonical static preflight, full-show trajectory consequence analysis and
 * readiness evaluation on it) and by Apply. The evidence is therefore produced
 * for exactly the project that gets installed.
 */
export function buildTextCandidateProject(input: {
  readonly project: ShowProject;
  readonly preview: TextPreviewSuccess;
  readonly formationId: string;
  readonly formationName?: string;
}): {
  readonly project: ShowProject;
  readonly formation: Formation;
} {
  const { project, preview } = input;
  const { formation } = makeTextFormation({
    id: input.formationId,
    name: input.formationName ?? `Text — ${preview.geometry.recipe.text}`,
    recipe: preview.geometry.recipe,
    authoredForClipId: preview.clipId,
    ...(preview.objectId ? { authoredForObjectId: preview.objectId } : {}),
  });

  // The replaced asset is kept: other clips and ESSP source recovery may use it.
  const formations = [...project.formations, formation];
  // Explicit scene object edits touch ONLY that object's STATIC source; the
  // legacy `clip.formationId` fallback is rewritten only when no scene object
  // owns the geometry.
  const timeline = preview.objectId
    ? project.timeline
    : project.timeline.map((clip) =>
        clip.id === preview.clipId ? { ...clip, formationId: formation.id } : clip,
      );

  const scenes: FormationScene[] | undefined = project.scenes?.map((scene) =>
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

  return {
    formation,
    project: { ...project, formations, timeline, ...(scenes ? { scenes } : {}) },
  };
}

/**
 * Prepares the complete revision. The caller must install `prepared.after`
 * (project + pruned overrides + reconciled reference layer) as ONE history
 * entry; a partial commit would break undo/redo and imported ownership.
 */
export function prepareTextFormationApply(input: TextApplyInput): TextApplyPreparationResult {
  const readiness = input.readiness;
  if (!readiness) {
    return {
      ok: false,
      blockers: ["READINESS_MISSING"],
      note: "Apply requires the canonical geometry apply readiness report; it has not been produced for this proposal.",
    };
  }
  if (!readiness.canApply || readiness.status === "BLOCKED") {
    return {
      ok: false,
      blockers: ["READINESS_BLOCKED"],
      note: `Canonical readiness evidence blocks Apply: ${readiness.blockers.join(" | ") || readiness.note}`,
    };
  }

  const preview = previewTextFormation(input.project, input.request);
  if (!preview.ok) return { ok: false, blockers: preview.blockers, note: preview.note };

  // Feasibility is an EXTRA gate in front of canonical validation, never a
  // substitute for it: a recipe that generated exactly N points can still be
  // physically impossible at the project's separation minimum.
  if (preview.feasibility.status === "INFEASIBLE") {
    return {
      ok: false,
      blockers: ["TEXT_INFEASIBLE"],
      note: `The generated text is not physically flyable: ${preview.feasibility.note}`,
    };
  }

  if (input.project.formations.some((f) => f.id === input.formationId)) {
    return {
      ok: false,
      blockers: ["FORMATION_ID_COLLISION"],
      note: `Formation id ${input.formationId} already exists in the open show; Apply would overwrite or duplicate an existing asset.`,
    };
  }

  const candidate = buildTextCandidateProject({
    project: input.project,
    preview,
    formationId: input.formationId,
    ...(input.formationName ? { formationName: input.formationName } : {}),
  });
  const formation = candidate.formation;
  const afterProject = candidate.project;

  const prepared = prepareGeometryApplyCommand({
    beforeProject: input.project,
    afterProject,
    readiness,
    transitionOverrides: input.transitionOverrides,
    ...(input.candidateTransitionOverrides
      ? { replacementTransitionOverrides: input.candidateTransitionOverrides }
      : {}),
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
    feasibility: preview.feasibility,
    prepared,
    formation,
    replacedFormationId: preview.replacedFormationId,
    objectId: preview.objectId,
    newlyPlannedIntervals,
    note: "PREPARED ATOMIC TEXT APPLY. Clip identity, timing, lighting, participation and imported source bytes are preserved; only the edited clip's geometry and the derived transition boundaries become planner owned.",
  };
}
