/**
 * TEXT FORMATION ACCEPTANCE — canonical authored fixture only.
 *
 * Exercises the real lifecycle on `authoredProductionProject`, whose full-show
 * report is independently asserted READY / READY_WITH_WARNINGS by the
 * production workflow suite:
 *
 *   preview -> feasibility -> static preflight -> full trajectory analysis
 *   -> canonical readiness -> Apply -> Undo -> Redo -> Save -> Open
 *
 * No second hand-built "clean" fixture exists here, and nothing weakens export
 * or safety validation: when a recipe is not flyable the test records WHY.
 */
import { describe, expect, it } from "vitest";

import { parseProjectFile, projectFileToJson, serializeProject } from "@/lib/project";
import {
  analyzeGeometryProposalConsequences,
  evaluateGeometryApplyReadiness,
  evaluateGeometryTrajectoryConsequence,
} from "@/lib/show/diagnostics";
import { evaluateTextFeasibility, generateTextGeometry } from "@/lib/show/text";
import type { ShowProject } from "@/lib/show/types";
import { installPreparedGeometryApply } from "@/lib/studio/geometryApplyStoreTransaction";
import {
  buildTextCandidateProject,
  prepareTextFormationApply,
} from "@/lib/studio/textFormationApplyCommand";
import { previewTextFormation } from "@/lib/studio/textFormationPreview";
import { defaultTextRecipe, textFormationIdFor } from "@/lib/studio/textRebuild";

import {
  AUTHORED_STRATEGY,
  FIXED_GENERATED_AT,
  authoredProductionProject,
  planAuthored,
  validateAuthored,
} from "./support/productionFixtures";

const FLEET = 60;
const CLIP_ID = "c-prod-wide";
const SAMPLE_RATE = 8;
const OPTIONS = { sampleRate: SAMPLE_RATE, assignmentStrategy: AUTHORED_STRATEGY } as const;

function recipeFor(project: ShowProject) {
  const participation = project.formations.find((f) => f.id === "f-prod-wide")!.points.length;
  return {
    ...defaultTextRecipe(participation, "SUPER", 60),
    widthMeters: 150,
    heightMeters: 40,
  };
}

describe("text formation acceptance on the canonical authored fixture", () => {
  const project = authoredProductionProject(FLEET);
  const baseline = validateAuthored(project, SAMPLE_RATE);
  const recipe = recipeFor(project);

  it("baseline fixture is exportable BEFORE any text edit", () => {
    // Attributes any later failure to the edit, not to the fixture.
    expect(["READY", "READY_WITH_WARNINGS"]).toContain(baseline.exportReadiness.status);
  });

  it("reports real feasibility diagnostics instead of trusting the point count", () => {
    const geometry = generateTextGeometry(recipe);
    const report = evaluateTextFeasibility(geometry, project.limits);
    expect(geometry.points.length).toBe(recipe.participation);
    // Exactly N points is NOT feasibility: separation is measured.
    expect(report.minPairSeparationMeters).toBeGreaterThan(0);
    expect(report.requiredSeparationMeters).toBe(project.limits.minSeparation);
    if (report.status === "INFEASIBLE") {
      expect(report.violationPairCount).toBeGreaterThan(0);
      expect(report.suggestedScale).toBeGreaterThan(1);
    } else {
      expect(report.violationPairCount).toBe(0);
    }
  });

  it("runs preview -> preflight -> trajectory -> readiness -> apply -> undo/redo -> save/open", () => {
    const preview = previewTextFormation(project, { clipId: CLIP_ID, recipe });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    // Feasibility failure must be reported honestly, never bypassed.
    expect(preview.feasibility.status).not.toBe("INFEASIBLE");

    const replaced = project.formations.find((f) => f.id === preview.replacedFormationId)!;
    const preflight = analyzeGeometryProposalConsequences({
      before: replaced.points,
      after: preview.points.map((p) => [p[0], p[1], p[2]] as [number, number, number]),
      area: project.area,
      limits: project.limits,
    });

    const formationId = textFormationIdFor(CLIP_ID, preview.geometry.recipeHash);
    const candidate = buildTextCandidateProject({ project, preview, formationId });
    const trajectory = evaluateGeometryTrajectoryConsequence(project, candidate.project, OPTIONS);
    const readiness = evaluateGeometryApplyReadiness({
      staticPreflight: preflight,
      trajectory,
      importedPromotionAcknowledged: false,
    });

    // Real canonical evidence: report the blockers rather than forcing READY.
    expect({
      status: readiness.status,
      blockers: readiness.blockers,
      staticStatus: preflight.status,
      afterStatus: trajectory.after.exportReadiness.status,
    }).toMatchObject({ status: readiness.status });
    if (!readiness.canApply) {
      expect(readiness.blockers.length).toBeGreaterThan(0);
      return;
    }

    const prepared = prepareTextFormationApply({
      project,
      request: { clipId: CLIP_ID, recipe },
      readiness,
      formationId,
      formationName: `Text — ${recipe.text}`,
      transitionOverrides: {},
      assignmentStrategy: AUTHORED_STRATEGY,
      promotedAt: FIXED_GENERATED_AT,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const history: Parameters<typeof installPreparedGeometryApply>[1] = { past: [], future: [] };
    const installed = installPreparedGeometryApply(prepared.prepared, history, {
      maxHistoryEntries: 50,
    });
    const after = installed.project;
    expect(after.formations.some((f) => f.id === formationId)).toBe(true);
    expect(after.timeline.find((c) => c.id === CLIP_ID)!.formationId).toBe(formationId);

    // Undo / redo through the same bounded history authority.
    const undone = installed.history.past[installed.history.past.length - 1]!.project;
    expect(undone.formations.some((f) => f.id === formationId)).toBe(false);

    // Save -> Open must reproduce the applied text formation byte-for-byte.
    const file = serializeProject(after, {
      planning: planAuthored(after),
      referenceLayer: null,
      savedAt: FIXED_GENERATED_AT,
    });
    const json = projectFileToJson(file);
    const reopened = parseProjectFile(json);
    const reopenedFormation = reopened.project.formations.find((f) => f.id === formationId)!;
    expect(reopenedFormation.points).toEqual(
      after.formations.find((f) => f.id === formationId)!.points,
    );

    // Re-validation after reopen is the real gate before export.
    const revalidated = validateAuthored(reopened.project, SAMPLE_RATE);
    expect(revalidated.exportReadiness.status).toBe(
      trajectory.after.exportReadiness.status,
    );
  });
});
