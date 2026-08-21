/**
 * HISTORY RESTORE INTEGRITY — derived-analysis invalidation authority, exact
 * reference-layer restoration and the export gate across undo/redo.
 *
 * The harness mirrors the store commands exactly: `invalidateDerivedAnalysis`
 * is the SAME authority the store calls from geometry apply, project load and
 * undo/redo restore. No policy is duplicated here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateExportEligibility } from "../../adapters/exportEligibility";
import { analyzeFullShow } from "../../show/fullshow/validator";
import { projectWithFormationPoints } from "../../show/diagnostics";
import { createDepthStaggerDemoProject } from "../../show/stories/depthStaggerDemo";
import { findSampleShow, SAMPLE_SHOWS } from "../../show/stories/samples";
import type { ShowProject, Vector3Tuple } from "../../show/types";
import type { ReferenceTrajectoryLayer } from "../../import/essp/native";
import type { ClipTransitionOverride } from "../../show/trajectory";
import { invalidateDerivedAnalysis, DERIVED_ANALYSIS_SLOTS } from "../derivedAnalysis";
import { prepareGeometryApplyCommand } from "../geometryApplyCommand";
import { installPreparedGeometryApply } from "../geometryApplyStoreTransaction";
import { computeOverrideBasis, type TimelineHistorySnapshot } from "../planningIntegrity";
import type { GeometryApplyReadinessReport } from "../../show/diagnostics/geometryApplyReadiness";

type Derived = Record<(typeof DERIVED_ANALYSIS_SLOTS)[number], unknown>;

function readiness(status: "READY" | "WARNING"): GeometryApplyReadinessReport {
  return {
    status,
    canApply: true,
    blockers: [],
    warnings: status === "WARNING" ? ["ready with warnings"] : [],
    newlyPromotedClipIds: [],
    note: "test",
  };
}

/** Faithful model of the store slices a history restore touches. */
class Store {
  project: ShowProject;
  transitionOverrides: Record<string, ClipTransitionOverride> = {};
  transitionDesigns: Record<string, unknown> = {};
  referenceLayer: ReferenceTrajectoryLayer | null = null;
  /** Authored settings must survive every restore. */
  settings = { horizontalThresholdMeters: 3, audienceDistanceMeters: 120, sampleRate: 10 };
  derived: Derived = {
    transitionAnalysis: {},
    assignmentComparison: {},
    optimization: {},
    transitionError: { code: "X", message: "derived" },
    fullShow: null,
    fullShowError: null,
    highlightedDrones: [1],
    preShowPreview: {},
  };
  history: { past: TimelineHistorySnapshot[]; future: TimelineHistorySnapshot[] } = {
    past: [],
    future: [],
  };

  constructor(project: ShowProject) {
    this.project = project;
  }

  private setters = {
    setTransitionAnalysis: (v: null) => void (this.derived.transitionAnalysis = v),
    setAssignmentComparison: (v: null) => void (this.derived.assignmentComparison = v),
    setOptimization: (v: null) => void (this.derived.optimization = v),
    setTransitionError: (v: null) => void (this.derived.transitionError = v),
    setFullShow: (v: null) => void (this.derived.fullShow = v),
    setFullShowError: (v: null) => void (this.derived.fullShowError = v),
    setHighlightedDrones: (v: never[]) => void (this.derived.highlightedDrones = v),
    setPreShowPreview: (v: null) => void (this.derived.preShowPreview = v),
  };

  validate() {
    this.derived.fullShow = analyzeFullShow(this.project).report;
    return this.derived.fullShow as { exportReadiness: { status: string } };
  }

  exportGate() {
    return evaluateExportEligibility(this.derived.fullShow as never, false);
  }

  apply(afterProject: ShowProject, status: "READY" | "WARNING" = "READY") {
    const prepared = prepareGeometryApplyCommand({
      beforeProject: this.project,
      afterProject,
      readiness: readiness(status),
      transitionOverrides: this.transitionOverrides,
      transitionDesigns: this.transitionDesigns as never,
      referenceLayer: this.referenceLayer,
      assignmentStrategy: "nearestNeighbor",
      promotedAt: "2026-08-21T12:00:00.000Z",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const installed = installPreparedGeometryApply(prepared, this.history);
    this.history = { past: [...installed.history.past], future: [...installed.history.future] };
    this.transitionOverrides = { ...installed.transitionOverrides };
    this.transitionDesigns = { ...installed.transitionDesigns };
    this.referenceLayer = installed.referenceLayer;
    this.project = installed.project;
    invalidateDerivedAnalysis(this.setters);
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
    computeOverrideBasis(snapshot.project, this.transitionOverrides);
    // EXACT: never gated on the current layer value.
    if (snapshot.referenceLayer !== undefined) this.referenceLayer = snapshot.referenceLayer;
    this.project = snapshot.project;
    invalidateDerivedAnalysis(this.setters);
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

function staggered(points: readonly Vector3Tuple[]): Vector3Tuple[] {
  return points.map((p, i) => [p[0], p[1], p[2] + (i % 2 === 0 ? 0.9 : -0.9)] as Vector3Tuple);
}

function stackProposal(project: ShowProject) {
  const formation = project.formations.find((f) => f.id === "f-ds-stack")!;
  return {
    formationId: formation.id,
    after: projectWithFormationPoints(project, formation.id, staggered(formation.points)),
  };
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("legacy wedding story removal", () => {
  it("has zero runtime or test references to the removed sample", () => {
    const patterns = [
      "createWeddingStoryProject",
      "loadStoryShow",
      "story-wedding-two-hearts",
      "Two Hearts",
      "Wedding Story",
      "weddingStory",
    ];
    const offenders: string[] = [];
    const self = "historyRestoreIntegrity.test.ts";
    for (const file of sourceFiles("src")) {
      if (file.endsWith(self)) continue;
      const text = readFileSync(file, "utf8");
      for (const pattern of patterns) {
        if (text.includes(pattern)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("depth stagger demo exposure + baseline validation", () => {
  it("is registered as an opt-in sample show", () => {
    expect(SAMPLE_SHOWS.map((s) => s.name)).toContain("Depth Stagger Demo");
    expect(findSampleShow("story-depth-stagger-demo")).not.toBeNull();
    expect(findSampleShow("nope")).toBeNull();
  });

  it("validates READY (no warnings-only downgrade required) before editing", () => {
    const report = analyzeFullShow(createDepthStaggerDemoProject()).report;
    expect(["READY", "READY_WITH_WARNINGS"]).toContain(report.exportReadiness.status);
    expect(report.exportReadiness.blockers).toEqual([]);
    expect(report.safety.metrics.minSeparation).toBeGreaterThan(2.5);
    expect(report.conflicts.conflictCount).toBe(0);
    expect(report.continuity.ok).toBe(true);
  }, 30_000);
});

describe("geometry apply history + derived analysis invalidation", () => {
  it("applies as exactly one history entry and invalidates every derived slot", () => {
    const store = new Store(createDepthStaggerDemoProject());
    const { after } = stackProposal(store.project);
    store.apply(after);
    expect(store.history.past).toHaveLength(1);
    expect(store.history.future).toHaveLength(0);
    for (const slot of DERIVED_ANALYSIS_SLOTS) {
      expect(store.derived[slot]).toEqual(slot === "highlightedDrones" ? [] : null);
    }
  });

  it("invalidates applied-geometry validation on undo and pre-undo validation on redo", () => {
    const store = new Store(createDepthStaggerDemoProject());
    expect(store.validate().exportReadiness.status).toBe("READY");
    const baselinePoints = JSON.stringify(
      store.project.formations.find((f) => f.id === "f-ds-stack")!.points,
    );

    const { after } = stackProposal(store.project);
    store.apply(after);
    expect(store.exportGate().canExportComputedShow).toBe(false);
    expect(store.exportGate().reason).toBe("NO_REPORT");

    store.validate();
    expect(store.exportGate().canExportComputedShow).toBe(true);

    expect(store.undo()).toBe(true);
    expect(store.derived.fullShow).toBeNull();
    expect(store.exportGate().reason).toBe("NO_REPORT");
    expect(JSON.stringify(store.project.formations.find((f) => f.id === "f-ds-stack")!.points)).toBe(
      baselinePoints,
    );

    store.validate();
    expect(store.redo()).toBe(true);
    expect(store.derived.fullShow).toBeNull();
    expect(store.exportGate().reason).toBe("NO_REPORT");
    expect(
      JSON.stringify(store.project.formations.find((f) => f.id === "f-ds-stack")!.points),
    ).not.toBe(baselinePoints);
  }, 60_000);

  it("keeps authored settings across restoration", () => {
    const store = new Store(createDepthStaggerDemoProject());
    const settings = { ...store.settings };
    const { after } = stackProposal(store.project);
    store.apply(after);
    store.undo();
    store.redo();
    expect(store.settings).toEqual(settings);
  });
});

describe("exact reference layer restoration", () => {
  const layerA = { showHash: "A", bindings: [] } as unknown as ReferenceTrajectoryLayer;
  const layerB = { showHash: "B", bindings: [] } as unknown as ReferenceTrajectoryLayer;

  function roundTrip(before: ReferenceTrajectoryLayer | null, after: ReferenceTrajectoryLayer | null) {
    const store = new Store(createDepthStaggerDemoProject());
    store.referenceLayer = before;
    const { after: afterProject } = stackProposal(store.project);
    // Snapshot the BEFORE layer through the canonical history stack, then move
    // ownership to the AFTER value and prove undo/redo restore both exactly.
    store.history.past.push({
      project: store.project,
      transitionOverrides: {},
      transitionDesigns: {},
      referenceLayer: before,
    });
    store.project = afterProject;
    store.referenceLayer = after;
    expect(store.undo()).toBe(true);
    expect(store.referenceLayer).toBe(before);
    expect(store.redo()).toBe(true);
    expect(store.referenceLayer).toBe(after);
  }

  it("restores null -> non-null, non-null -> null and non-null -> other non-null", () => {
    roundTrip(null, layerA);
    roundTrip(layerA, null);
    roundTrip(layerA, layerB);
  });
});
