/**
 * GEOMETRY APPLY — LONG SESSION ACCEPTANCE (25 cycles, accumulation, redo branch).
 *
 * Covers what a single apply test cannot: repeated Apply/Undo/Redo on the same
 * subject, derived-asset accumulation, bounded history, redo-branch closure and
 * validation staleness across edit/undo. All of it drives the SAME store
 * authorities through the shared apply harness — no policy is re-implemented.
 */
import { describe, expect, it } from "vitest";

import { evaluateExportEligibility } from "../../adapters/exportEligibility";
import { auditGeometryDerivedAssets } from "../../show/diagnostics/geometryDerivedAssetAudit";
import { projectWithFormationPoints } from "../../show/diagnostics";
import { computeAnalysisRevision } from "../../show/fullshow/revision";
import { materializeStaticSceneGeometryProposal, resolveSceneAt } from "../../show/scene";
import { createDemoProject } from "../../show/defaultProject";
import { TIMELINE_HISTORY_LIMIT } from "../editorSession";
import {
  ApplyHarness,
  STRATEGY,
  importedFixture,
  readiness,
  sceneFixture,
  showClip,
  staggered,
} from "./support/geometryApplyHarness";

const CYCLES = 25;
const SAMPLE_RATE = 8;

function revisionOf(store: ApplyHarness): string {
  return computeAnalysisRevision(store.project, {
    sampleRate: SAMPLE_RATE,
    assignmentStrategy: STRATEGY,
    transitionOverrides: store.transitionOverrides,
    referenceLayer: store.referenceLayer,
  });
}

function expectDerivedCleared(store: ApplyHarness) {
  expect(store.derived).toEqual({
    fullShowReport: null,
    transitionAnalysis: null,
    assignmentComparison: null,
    optimization: null,
    preShowPreview: null,
  });
  expect(evaluateExportEligibility(null, false).canExportComputedShow).toBe(false);
}

describe("25-cycle geometry apply stress", () => {
  it("keeps one revision per cycle, exact undo/redo and no export without re-validation", () => {
    const project = createDemoProject();
    const clip = showClip(project);
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const originalPoints = JSON.stringify(formation.points);
    const store = new ApplyHarness(project, { selectedClipId: clip.id });

    const revisions: string[] = [revisionOf(store)];
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const current = store.project.formations.find((f) => f.id === formation.id)!;
      const after = projectWithFormationPoints(
        store.project,
        formation.id,
        staggered(current.points, cycle),
      );

      expect(store.apply(after, readiness("READY")).ok, `cycle ${cycle}`).toBe(true);
      const appliedPoints = JSON.stringify(
        store.project.formations.find((f) => f.id === formation.id)!.points,
      );
      expect(store.history.past.length).toBe(cycle);
      expect(store.history.future).toHaveLength(0);
      expectDerivedCleared(store);

      // Undo restores the pre-cycle geometry EXACTLY, redo reproduces the apply.
      const beforePoints = JSON.stringify(current.points);
      expect(store.undo()).toBe(true);
      expect(JSON.stringify(store.project.formations.find((f) => f.id === formation.id)!.points)).toBe(
        beforePoints,
      );
      expect(store.history.past.length).toBe(cycle - 1);
      expect(store.history.future).toHaveLength(1);

      expect(store.redo()).toBe(true);
      expect(JSON.stringify(store.project.formations.find((f) => f.id === formation.id)!.points)).toBe(
        appliedPoints,
      );
      expect(store.history.future).toHaveLength(0);
      expect(store.selectedClipId).toBe(clip.id);
      revisions.push(revisionOf(store));
    }

    // Every cycle produced a distinct content revision (no silent no-ops).
    expect(new Set(revisions).size).toBe(revisions.length);
    // History never exceeds the bound, and the whole session unwinds to the start.
    expect(store.history.past.length).toBeLessThanOrEqual(TIMELINE_HISTORY_LIMIT);
    for (let i = 0; i < CYCLES; i++) expect(store.undo()).toBe(true);
    expect(JSON.stringify(store.project.formations.find((f) => f.id === formation.id)!.points)).toBe(
      originalPoints,
    );
    expect(store.undo()).toBe(false);
  }, 60_000);

  it("bounds the history at the timeline limit over more cycles than the bound", () => {
    const project = createDemoProject();
    const clip = showClip(project);
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const store = new ApplyHarness(project, { selectedClipId: clip.id });
    for (let i = 1; i <= TIMELINE_HISTORY_LIMIT + 20; i++) {
      const current = store.project.formations.find((f) => f.id === formation.id)!;
      store.apply(
        projectWithFormationPoints(store.project, formation.id, staggered(current.points, i)),
        readiness("READY"),
      );
      expect(store.history.past.length).toBeLessThanOrEqual(TIMELINE_HISTORY_LIMIT);
    }
    expect(store.history.past.length).toBe(TIMELINE_HISTORY_LIMIT);
  }, 60_000);
});

describe("derived formation accumulation", () => {
  it("reuses one derived formation per scene object across 25 applies and never orphans assets", () => {
    const { project, scene } = sceneFixture(2);
    const sourceIds = project.formations.map((f) => f.id);
    const sourceJson = JSON.stringify(project.formations);
    const store = new ApplyHarness(project, { selectedClipId: scene.id });

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const currentScene = store.project.scenes!.find((s) => s.id === scene.id)!;
      const resolved = resolveSceneAt(store.project, currentScene).points;
      const proposed = staggered(resolved, cycle);
      const materialised = materializeStaticSceneGeometryProposal(store.project, scene.id, proposed);
      expect(materialised.ok, `cycle ${cycle} materialisation`).toBe(true);
      if (!materialised.ok) return;
      expect(store.apply(materialised.project, readiness("READY")).ok).toBe(true);

      const applied = store.project.scenes!.find((s) => s.id === scene.id)!;
      expect(applied.objects.map((o) => o.id)).toEqual(scene.objects.map((o) => o.id));
      const audit = auditGeometryDerivedAssets(store.project);
      // One derived asset per scene object, stable across every cycle.
      expect(audit.derivedAssetCount, `cycle ${cycle} derived assets`).toBe(scene.objects.length);
      expect(audit.orphanedFormationIds).toEqual([]);
      expect(audit.sharedFormationIds).toEqual([]);
      expect(audit.ownershipMismatchFormationIds).toEqual([]);
      // Reusable source assets are never rewritten by an apply.
      expect(
        JSON.stringify(store.project.formations.filter((f) => sourceIds.includes(f.id))),
      ).toBe(sourceJson);
    }

    // Full unwind restores the original scene bindings with no derived leftovers.
    while (store.undo());
    expect(store.project.scenes![0]!.objects).toEqual(scene.objects);
    expect(auditGeometryDerivedAssets(store.project).derivedAssetCount).toBe(0);
  }, 60_000);
});

describe("redo branch closure", () => {
  it("cuts the redo branch on a new authoring command and never reinstates it", () => {
    const project = createDemoProject();
    const clip = showClip(project);
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const store = new ApplyHarness(project, { selectedClipId: clip.id });

    for (let i = 1; i <= 3; i++) {
      const current = store.project.formations.find((f) => f.id === formation.id)!;
      store.apply(
        projectWithFormationPoints(store.project, formation.id, staggered(current.points, i)),
        readiness("READY"),
      );
    }
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.history.future).toHaveLength(2);

    // A non-geometry authoring edit on the same history stack cuts the branch.
    store.editWithHistory((p) => ({ ...p, name: `${p.name} edited` }));
    expect(store.history.future).toHaveLength(0);
    expect(store.redo()).toBe(false);

    // Undo of the new edit is still exact and does not restore the cut branch.
    expect(store.undo()).toBe(true);
    expect(store.history.future).toHaveLength(1);
    expect(store.project.name).not.toContain("edited");
  });
});

describe("validation / edit / history stress", () => {
  it("makes a report stale on every edit and drops it on every history restore", () => {
    const project = createDemoProject();
    const clip = showClip(project);
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const store = new ApplyHarness(project, { selectedClipId: clip.id });

    for (let cycle = 1; cycle <= 8; cycle++) {
      // "Validate": a report is always stamped with the CURRENT revision.
      const validatedRevision = revisionOf(store);
      store.derived = {
        ...store.derived,
        fullShowReport: {
          analysisRevision: validatedRevision,
          exportReadiness: { status: "READY", blockers: [], warnings: [] },
        },
      };
      const report = store.derived.fullShowReport as { analysisRevision: string };
      expect(evaluateExportEligibility(report as never, false).canExportComputedShow).toBe(true);

      const current = store.project.formations.find((f) => f.id === formation.id)!;
      expect(
        store.apply(
          projectWithFormationPoints(store.project, formation.id, staggered(current.points, cycle)),
          readiness("READY"),
        ).ok,
      ).toBe(true);

      // The applied geometry has no validation evidence at all any more.
      expect(store.derived.fullShowReport).toBeNull();
      expect(report.analysisRevision).not.toBe(revisionOf(store));
      expectDerivedCleared(store);

      // Undo restores content, never a report for it.
      expect(store.undo()).toBe(true);
      expect(store.derived.fullShowReport).toBeNull();
      expect(evaluateExportEligibility(null, false).reason).toBe("NO_REPORT");
      expect(store.redo()).toBe(true);
      expect(store.derived.fullShowReport).toBeNull();
    }
  }, 60_000);
});

describe("imported ownership across repeated applies", () => {
  it("round-trips the reference layer exactly over repeated apply/undo/redo cycles", async () => {
    const { show, project, layer } = await importedFixture();
    const sourceBytes = show.drones.map((drone) => drone.sourceId);
    const clip = project.timeline.find(
      (c) => !c.dynamicFormationId && layer.bindings.some((b) => b.clipId === c.id && b.owner === "REFERENCE"),
    )!;
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const store = new ApplyHarness(project, { referenceLayer: layer, selectedClipId: clip.id });

    for (let cycle = 1; cycle <= 8; cycle++) {
      const layerBefore = JSON.stringify(store.referenceLayer);
      const current = store.project.formations.find((f) => f.id === formation.id)!;
      const result = store.apply(
        projectWithFormationPoints(store.project, formation.id, staggered(current.points, cycle)),
        readiness("WARNING", [clip.id]),
      );
      expect(result.ok, `cycle ${cycle}`).toBe(true);
      const promoted = JSON.stringify(store.referenceLayer);
      expect(
        store.referenceLayer!.bindings
          .filter((b) => b.clipId === clip.id)
          .every((b) => b.owner === "PLANNER"),
      ).toBe(true);

      expect(store.undo()).toBe(true);
      expect(JSON.stringify(store.referenceLayer)).toBe(layerBefore);
      expect(store.redo()).toBe(true);
      expect(JSON.stringify(store.referenceLayer)).toBe(promoted);
    }

    // Imported source bytes are untouched by the whole session.
    expect(show.drones.map((drone) => drone.sourceId)).toEqual(sourceBytes);
  }, 120_000);
});
