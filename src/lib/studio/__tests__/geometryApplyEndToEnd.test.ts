/**
 * GEOMETRY APPLY — END-TO-END ACCEPTANCE (store semantics, no browser).
 *
 * The harness below reproduces EXACTLY what the Studio store command does:
 * `prepareGeometryApplyCommand` -> `installPreparedGeometryApply` -> atomic
 * install + derived-analysis invalidation + selection reconciliation, and the
 * existing timeline history authority for undo/redo. No policy is duplicated.
 */
import { describe, expect, it } from "vitest";

import { evaluateExportEligibility } from "../../adapters/exportEligibility";
import { buildSyntheticEssp } from "../../import/essp/codec";
import { analyzeReferenceShow } from "../../import/essp/forensics/report";
import {
  extractReferenceTimeline,
  reseedReferenceSignatures,
  type ReferenceTrajectoryLayer,
} from "../../import/essp/native";
import { buildReferenceShow } from "../../import/essp/reference";
import { createDefaultProject, createDemoProject } from "../../show/defaultProject";
import type { GeometryApplyReadinessReport } from "../../show/diagnostics/geometryApplyReadiness";
import {
  DYNAMIC_SCENE_UNAVAILABLE_MESSAGE,
  projectWithFormationPoints,
  resolveProposalMaterialisation,
} from "../../show/diagnostics";
import { materializeStaticSceneGeometryProposal, resolveSceneAt } from "../../show/scene";
import type { FormationScene } from "../../show/scene/types";
import type { ClipTransitionOverride } from "../../show/trajectory";
import { clipPhase, type ShowProject, type Vector3Tuple } from "../../show/types";
import { EMPTY_EDITOR_CLIP_SELECTION, reconcileEditorSelection } from "../clipSelection";
import { prepareGeometryApplyCommand } from "../geometryApplyCommand";
import { installPreparedGeometryApply } from "../geometryApplyStoreTransaction";
import { computeOverrideBasis, type TimelineHistorySnapshot } from "../planningIntegrity";

const STRATEGY = "nearestNeighbor" as const;

function readiness(
  status: "READY" | "WARNING" | "BLOCKED",
  newlyPromotedClipIds: readonly string[] = [],
): GeometryApplyReadinessReport {
  return {
    status,
    canApply: status !== "BLOCKED",
    blockers: status === "BLOCKED" ? ["canonical evidence blocks apply"] : [],
    warnings: status === "WARNING" ? ["ready with warnings"] : [],
    newlyPromotedClipIds,
    note: "test",
  };
}

/** Minimal faithful model of the store state a geometry apply touches. */
class Harness {
  project: ShowProject;
  transitionOverrides: Record<string, ClipTransitionOverride>;
  transitionDesigns: Record<string, unknown> = {};
  referenceLayer: ReferenceTrajectoryLayer | null;
  history: { past: TimelineHistorySnapshot[]; future: TimelineHistorySnapshot[] } = {
    past: [],
    future: [],
  };
  /** Derived analysis (all of it must be dropped by an apply). */
  derived: { fullShowReport: unknown; transitionAnalysis: unknown; assignmentComparison: unknown; optimization: unknown; preShowPreview: unknown } = {
    fullShowReport: { exportReadiness: { status: "READY", blockers: [], warnings: [] } },
    transitionAnalysis: {},
    assignmentComparison: {},
    optimization: {},
    preShowPreview: {},
  };
  selectedClipId: string | null;
  selection = EMPTY_EDITOR_CLIP_SELECTION;

  constructor(
    project: ShowProject,
    options: {
      overrides?: Record<string, ClipTransitionOverride>;
      referenceLayer?: ReferenceTrajectoryLayer | null;
      selectedClipId?: string | null;
    } = {},
  ) {
    this.project = project;
    this.transitionOverrides = options.overrides ?? {};
    this.referenceLayer = options.referenceLayer ?? null;
    this.selectedClipId = options.selectedClipId ?? (project.timeline[0]?.id ?? null);
  }

  apply(afterProject: ShowProject, report: GeometryApplyReadinessReport) {
    const prepared = prepareGeometryApplyCommand({
      beforeProject: this.project,
      afterProject,
      readiness: report,
      transitionOverrides: this.transitionOverrides,
      transitionDesigns: this.transitionDesigns as never,
      referenceLayer: this.referenceLayer,
      assignmentStrategy: STRATEGY,
      promotedAt: "2026-08-21T09:00:00.000Z",
    });
    if (!prepared.ok) return prepared;
    const installed = installPreparedGeometryApply(prepared, this.history);
    this.history = {
      past: [...installed.history.past],
      future: [...installed.history.future],
    };
    this.transitionOverrides = { ...installed.transitionOverrides };
    this.transitionDesigns = { ...installed.transitionDesigns };
    if (this.referenceLayer) this.referenceLayer = installed.referenceLayer;
    this.project = installed.project;
    this.derived = {
      fullShowReport: null,
      transitionAnalysis: null,
      assignmentComparison: null,
      optimization: null,
      preShowPreview: null,
    };
    this.reconcileSelection();
    return {
      ok: true as const,
      invalidatedTransitionOverrideClipIds: installed.invalidatedTransitionOverrideClipIds,
      promotedReferenceClipIds: installed.promotedReferenceClipIds,
    };
  }

  private snapshot(): TimelineHistorySnapshot {
    return {
      project: this.project,
      transitionOverrides: { ...this.transitionOverrides },
      transitionDesigns: { ...(this.transitionDesigns as Record<string, never>) },
      referenceLayer: this.referenceLayer,
    };
  }

  private restore(snapshot: TimelineHistorySnapshot) {
    this.transitionOverrides = { ...snapshot.transitionOverrides };
    this.transitionDesigns = { ...(snapshot.transitionDesigns ?? {}) };
    if (snapshot.referenceLayer !== undefined && this.referenceLayer) {
      this.referenceLayer = snapshot.referenceLayer;
    }
    this.project = snapshot.project;
    computeOverrideBasis(this.project, this.transitionOverrides);
    this.reconcileSelection();
  }

  private reconcileSelection() {
    const previous = this.selectedClipId;
    const next =
      previous && this.project.timeline.some((c) => c.id === previous)
        ? previous
        : (this.project.timeline[0]?.id ?? null);
    this.selectedClipId = next;
    this.selection = reconcileEditorSelection(this.project, next, this.selection, next);
  }

  undo() {
    const previous = this.history.past.pop();
    if (!previous) return false;
    this.history.future.push(this.snapshot());
    this.restore(previous);
    return true;
  }

  redo() {
    const next = this.history.future.pop();
    if (!next) return false;
    this.history.past.push(this.snapshot());
    this.restore(next);
    return true;
  }
}

/* ------------------------------------------------------------------ fixtures */

function showClip(project: ShowProject) {
  return project.timeline.find((c) => clipPhase(c) === "SHOW")!;
}

function staggered(points: readonly Vector3Tuple[]): Vector3Tuple[] {
  return points.map(
    (p, i) => [p[0], p[1], p[2] + (i % 2 === 0 ? 0.9 : -0.9)] as Vector3Tuple,
  );
}

function identityOverride(count: number): ClipTransitionOverride {
  return {
    targetPointIndex: Array.from({ length: count }, (_, i) => i),
    startOffsets: Array.from({ length: count }, () => 0),
    laneOffsets: Array.from({ length: count }, () => 0),
    strategy: "test",
  };
}

function sceneFixture(objectCount: 1 | 2): { project: ShowProject; scene: FormationScene } {
  const base = createDemoProject();
  const clip = showClip(base);
  const formation = base.formations.find((f) => f.id === clip.formationId)!;
  const objects = Array.from({ length: objectCount }, (_, i) => ({
    id: `${clip.id}-obj-${i + 1}`,
    name: `Static object ${i + 1}`,
    source: { kind: "STATIC" as const, formationId: formation.id },
    transform: {
      position: [i * 8 - 4, 2, 3] as Vector3Tuple,
      rotationDeg: [0, i * 15, 0] as Vector3Tuple,
      scale: 1,
    },
  }));
  const scene: FormationScene = {
    id: clip.id,
    name: "Apply scene",
    schemaVersion: 1,
    transform: { position: [1, 0, -1], rotationDeg: [0, 6, 0], scale: 1 },
    objects,
  };
  return { project: { ...base, scenes: [scene] }, scene };
}

const RATE = 8;
const DRONES = 6;

function esspTrajectory(index: number): number[][] {
  const out: number[][] = [];
  const x = (index % 3) * 500 - 500;
  const y = Math.floor(index / 3) * 500 - 250;
  const push = (seconds: number, z: (t: number) => number, dx = 0) => {
    for (let f = 0; f < seconds * RATE; f += 1) {
      const t = f / RATE;
      out.push([Math.round(x + dx * t), y, Math.round(z(t))]);
    }
  };
  push(12, (t) => (t / 12) * 3000);
  push(20, () => 3000);
  push(16, () => 3000, 60);
  push(20, () => 3000);
  push(12, (t) => 3000 * (1 - t / 12));
  return out;
}

async function importedFixture() {
  const files = Array.from({ length: DRONES }, (_, i) => ({
    name: `${i + 1}.essp`,
    bytes: buildSyntheticEssp({
      xyz: esspTrajectory(i),
      rgb: Array.from({ length: esspTrajectory(i).length }, () => [255, 128, 32]),
    }),
  }));
  const show = await buildReferenceShow(files);
  const report = analyzeReferenceShow(show);
  const result = extractReferenceTimeline(show, report);
  const base = createDefaultProject();
  const project: ShowProject = {
    ...base,
    droneCount: result.droneCount,
    formations: [...result.formations],
    timeline: [...result.timeline],
    dynamicFormations: [...result.dynamicFormations],
    scenes: [...result.scenes],
    lighting: result.lighting,
    ...(base.preShow ? { preShow: { ...base.preShow, enabled: false } } : {}),
  };
  const layer = reseedReferenceSignatures(project, result.layer, {
    assignmentStrategy: STRATEGY,
    transitionOverrides: {},
  });
  return { show, project, layer };
}

/* --------------------------------------------------------------------- tests */

describe("geometry apply — end-to-end store semantics", () => {
  it("applies a READY formation proposal as ONE undoable revision and undo/redo round-trips", () => {
    const project = createDemoProject();
    const clip = showClip(project);
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const beforeJson = JSON.stringify(formation.points);
    const after = projectWithFormationPoints(project, formation.id, staggered(formation.points));

    const store = new Harness(project, { selectedClipId: clip.id });
    const result = store.apply(after, readiness("READY"));
    expect(result.ok).toBe(true);
    expect(store.history.past).toHaveLength(1);
    expect(store.history.future).toHaveLength(0);
    const appliedPoints = store.project.formations.find((f) => f.id === formation.id)!.points;
    expect(JSON.stringify(appliedPoints)).not.toBe(beforeJson);

    expect(store.undo()).toBe(true);
    expect(JSON.stringify(store.project.formations.find((f) => f.id === formation.id)!.points)).toBe(
      beforeJson,
    );
    expect(store.history.past).toHaveLength(0);

    expect(store.redo()).toBe(true);
    expect(store.project.formations.find((f) => f.id === formation.id)!.points).toEqual(
      appliedPoints,
    );
    expect(store.selectedClipId).toBe(clip.id);
  });

  it("applies a WARNING proposal and refuses a BLOCKED one", () => {
    const project = createDemoProject();
    const clip = showClip(project);
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const after = projectWithFormationPoints(project, formation.id, staggered(formation.points));

    const warn = new Harness(project).apply(after, readiness("WARNING"));
    expect(warn.ok).toBe(true);

    const blockedStore = new Harness(project);
    const blocked = blockedStore.apply(after, readiness("BLOCKED"));
    expect(blocked.ok).toBe(false);
    expect(blockedStore.project).toBe(project);
    expect(blockedStore.history.past).toHaveLength(0);
    expect(blockedStore.derived.fullShowReport).not.toBeNull();
  });

  it("drops the stale override, keeps unrelated overrides and clears derived analysis", () => {
    const project = createDemoProject();
    const clip = showClip(project);
    const other = project.timeline.find((c) => clipPhase(c) === "SHOW" && c.id !== clip.id);
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const after = projectWithFormationPoints(project, formation.id, staggered(formation.points));
    const overrides: Record<string, ClipTransitionOverride> = {
      [clip.id]: identityOverride(project.droneCount),
      ...(other ? { [other.id]: identityOverride(project.droneCount) } : {}),
    };

    const store = new Harness(project, { overrides, selectedClipId: clip.id });
    const beforeGate = evaluateExportEligibility(
      { exportReadiness: { status: "READY", blockers: [], warnings: [] } } as never,
      false,
    );
    expect(beforeGate.canExportComputedShow).toBe(true);

    const result = store.apply(after, readiness("READY"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invalidatedTransitionOverrideClipIds).toContain(clip.id);
    expect(store.transitionOverrides[clip.id]).toBeUndefined();
    if (other) expect(store.transitionOverrides[other.id]).toBeDefined();

    expect(store.derived).toEqual({
      fullShowReport: null,
      transitionAnalysis: null,
      assignmentComparison: null,
      optimization: null,
      preShowPreview: null,
    });
    // Export of a computed show is no longer offered until validation is re-run.
    const afterGate = evaluateExportEligibility(null, false);
    expect(afterGate.canExportComputedShow).toBe(false);
    expect(afterGate.reason).toBe("NO_REPORT");

    // Undo restores the pre-apply override set exactly.
    expect(store.undo()).toBe(true);
    expect(store.transitionOverrides[clip.id]).toBeDefined();
  });

  it("applies a composite static scene, preserves scene object ids and reproduces the proposal", () => {
    const { project, scene } = sceneFixture(2);
    const resolved = resolveSceneAt(project, scene).points;
    const proposed = staggered(resolved);
    const materialised = materializeStaticSceneGeometryProposal(project, scene.id, proposed);
    expect(materialised.ok).toBe(true);
    if (!materialised.ok) return;

    const store = new Harness(project, { selectedClipId: scene.id });
    store.selection = { ...store.selection, sceneSelection: { ids: [scene.objects[0]!.id], primaryId: scene.objects[0]!.id } };
    const result = store.apply(materialised.project, readiness("READY"));
    expect(result.ok).toBe(true);

    const appliedScene = store.project.scenes!.find((s) => s.id === scene.id)!;
    expect(appliedScene.objects.map((o) => o.id)).toEqual(scene.objects.map((o) => o.id));
    expect(store.selection.sceneSelection.ids).toEqual([scene.objects[0]!.id]);
    const appliedPoints = resolveSceneAt(store.project, appliedScene).points;
    appliedPoints.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(proposed[i]![0], 6);
      expect(p[1]).toBeCloseTo(proposed[i]![1], 6);
      expect(p[2]).toBeCloseTo(proposed[i]![2], 6);
    });

    // Undo gives the ORIGINAL scene bindings back (source assets never changed).
    expect(store.undo()).toBe(true);
    expect(store.project.scenes![0]!.objects).toEqual(scene.objects);
    expect(store.redo()).toBe(true);
    expect(store.project.scenes![0]!.objects.map((o) => o.id)).toEqual(
      scene.objects.map((o) => o.id),
    );
  });

  it("applies a sub-sampled static scene proposal", () => {
    const { project, scene } = sceneFixture(1);
    const budgeted: FormationScene = {
      ...scene,
      objects: [{ ...scene.objects[0]!, requestedDroneCount: 6 }],
    };
    const withBudget: ShowProject = { ...project, scenes: [budgeted] };
    const resolved = resolveSceneAt(withBudget, budgeted).points;
    expect(resolved.length).toBe(6);
    const proposed = staggered(resolved);
    const materialised = materializeStaticSceneGeometryProposal(withBudget, budgeted.id, proposed);
    expect(materialised.ok).toBe(true);
    if (!materialised.ok) return;

    const store = new Harness(withBudget, { selectedClipId: budgeted.id });
    expect(store.apply(materialised.project, readiness("READY")).ok).toBe(true);
    const appliedScene = store.project.scenes![0]!;
    const appliedPoints = resolveSceneAt(store.project, appliedScene).points;
    appliedPoints.forEach((p, i) => expect(p[2]).toBeCloseTo(proposed[i]![2], 6));
  });

  it("keeps dynamic scene geometry unavailable for apply", () => {
    const project = createDemoProject();
    const clip = showClip(project);
    const dynamic = (project.dynamicFormations ?? [])[0];
    if (!dynamic) return;
    const withDynamic: ShowProject = {
      ...project,
      timeline: project.timeline.map((c) =>
        c.id === clip.id ? { ...c, dynamicFormationId: dynamic.id } : c,
      ),
    };
    const at = clip.start + clip.transition + 0.1;
    const materialisation = resolveProposalMaterialisation(withDynamic, at, project.droneCount);
    expect(materialisation.kind).toBe("UNAVAILABLE");
    if (materialisation.kind !== "UNAVAILABLE") return;
    expect(materialisation.reason).toBe(DYNAMIC_SCENE_UNAVAILABLE_MESSAGE);
  });

  it("promotes imported ownership on apply, restores it exactly on undo and reproduces it on redo", async () => {
    const { show, project, layer } = await importedFixture();
    const sourceBytes = show.drones.map((drone) => drone.sourceId);
    // A STATIC reference-owned scene clip: a formation edit really does change
    // its flight output, so promotion is the canonical consequence.
    const clip = project.timeline.find(
      (c) =>
        clipPhase(c) === "SHOW" &&
        !c.dynamicFormationId &&
        layer.bindings.some((b) => b.clipId === c.id && b.owner === "REFERENCE"),
    )!;
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const after = projectWithFormationPoints(project, formation.id, staggered(formation.points));

    const store = new Harness(project, { referenceLayer: layer, selectedClipId: clip.id });
    const layerBefore = JSON.stringify(layer);
    const result = store.apply(after, readiness("WARNING", [clip.id]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.promotedReferenceClipIds).toContain(clip.id);
    const promotedLayer = store.referenceLayer!;
    expect(
      promotedLayer.bindings
        .filter((binding) => binding.clipId === clip.id)
        .every((binding) => binding.owner === "PLANNER"),
    ).toBe(true);

    expect(store.undo()).toBe(true);
    expect(JSON.stringify(store.referenceLayer)).toBe(layerBefore);

    expect(store.redo()).toBe(true);
    expect(JSON.stringify(store.referenceLayer)).toBe(JSON.stringify(promotedLayer));

    // Imported source stays untouched by any of it.
    expect(show.drones.map((drone) => drone.sourceId)).toEqual(sourceBytes);
  });
});
