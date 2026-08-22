/**
 * SHARED GEOMETRY-APPLY STORE HARNESS (test support, no policy of its own).
 *
 * It reproduces EXACTLY what the Studio store command does:
 * `prepareGeometryApplyCommand` -> `installPreparedGeometryApply` -> atomic
 * install + derived-analysis invalidation + selection reconciliation, plus the
 * bounded timeline history authority for undo/redo.
 *
 * Extracted so the long-session stress suites can drive many cycles without
 * inventing a second apply/undo model.
 */
import { buildSyntheticEssp } from "../../../import/essp/codec";
import { analyzeReferenceShow } from "../../../import/essp/forensics/report";
import {
  extractReferenceTimeline,
  reseedReferenceSignatures,
  type ReferenceTrajectoryLayer,
} from "../../../import/essp/native";
import { buildReferenceShow } from "../../../import/essp/reference";
import { createDefaultProject, createDemoProject } from "../../../show/defaultProject";
import type { GeometryApplyReadinessReport } from "../../../show/diagnostics/geometryApplyReadiness";
import type { FormationScene } from "../../../show/scene/types";
import type { ClipTransitionOverride } from "../../../show/trajectory";
import type { TransitionDesignState } from "../../../show/transition";
import { clipPhase, type ShowProject, type Vector3Tuple } from "../../../show/types";
import {
  EMPTY_EDITOR_CLIP_SELECTION,
  reconcileEditorSelection,
  type EditorClipSelectionState,
} from "../../clipSelection";
import { TIMELINE_HISTORY_LIMIT, boundHistory } from "../../editorSession";
import { prepareGeometryApplyCommand } from "../../geometryApplyCommand";
import { installPreparedGeometryApply } from "../../geometryApplyStoreTransaction";
import { computeOverrideBasis, type TimelineHistorySnapshot } from "../../planningIntegrity";

export const STRATEGY = "nearestNeighbor" as const;

export interface DerivedAnalysisSlice {
  fullShowReport: unknown;
  transitionAnalysis: unknown;
  assignmentComparison: unknown;
  optimization: unknown;
  preShowPreview: unknown;
}

export function readiness(
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
export class ApplyHarness {
  project: ShowProject;
  transitionOverrides: Record<string, ClipTransitionOverride>;
  transitionDesigns: Record<string, TransitionDesignState> = {};
  referenceLayer: ReferenceTrajectoryLayer | null;
  history: { past: TimelineHistorySnapshot[]; future: TimelineHistorySnapshot[] } = {
    past: [],
    future: [],
  };
  derived: DerivedAnalysisSlice = {
    fullShowReport: { exportReadiness: { status: "READY", blockers: [], warnings: [] } },
    transitionAnalysis: {},
    assignmentComparison: {},
    optimization: {},
    preShowPreview: {},
  };
  selectedClipId: string | null;
  selection: EditorClipSelectionState = EMPTY_EDITOR_CLIP_SELECTION;
  readonly maxHistoryEntries: number;

  constructor(
    project: ShowProject,
    options: {
      overrides?: Record<string, ClipTransitionOverride>;
      designs?: Record<string, TransitionDesignState>;
      referenceLayer?: ReferenceTrajectoryLayer | null;
      selectedClipId?: string | null;
      maxHistoryEntries?: number;
    } = {},
  ) {
    this.project = project;
    this.transitionOverrides = options.overrides ?? {};
    this.transitionDesigns = options.designs ?? {};
    this.referenceLayer = options.referenceLayer ?? null;
    this.selectedClipId = options.selectedClipId ?? project.timeline[0]?.id ?? null;
    this.maxHistoryEntries = options.maxHistoryEntries ?? TIMELINE_HISTORY_LIMIT;
  }

  apply(afterProject: ShowProject, report: GeometryApplyReadinessReport) {
    const prepared = prepareGeometryApplyCommand({
      beforeProject: this.project,
      afterProject,
      readiness: report,
      transitionOverrides: this.transitionOverrides,
      transitionDesigns: this.transitionDesigns,
      referenceLayer: this.referenceLayer,
      assignmentStrategy: STRATEGY,
      promotedAt: "2026-08-22T09:00:00.000Z",
    });
    if (!prepared.ok) return prepared;
    const installed = installPreparedGeometryApply(prepared, this.history, {
      maxHistoryEntries: this.maxHistoryEntries,
    });
    this.history = {
      past: boundHistory([...installed.history.past], this.maxHistoryEntries),
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

  /** Non-geometry authoring edit that participates in the SAME history stack. */
  editWithHistory(mutate: (project: ShowProject) => ShowProject) {
    this.history = {
      past: boundHistory([...this.history.past, this.snapshot()], this.maxHistoryEntries),
      future: [],
    };
    this.project = mutate(this.project);
    this.derived = {
      fullShowReport: null,
      transitionAnalysis: null,
      assignmentComparison: null,
      optimization: null,
      preShowPreview: null,
    };
    this.reconcileSelection();
  }

  snapshot(): TimelineHistorySnapshot {
    return {
      project: this.project,
      transitionOverrides: { ...this.transitionOverrides },
      transitionDesigns: { ...this.transitionDesigns },
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
    this.derived = {
      fullShowReport: null,
      transitionAnalysis: null,
      assignmentComparison: null,
      optimization: null,
      preShowPreview: null,
    };
    this.reconcileSelection();
  }

  reconcileSelection() {
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

export function showClip(project: ShowProject) {
  return project.timeline.find((c) => clipPhase(c) === "SHOW")!;
}

/** Deterministic vertical stagger; `phase` makes each cycle's geometry unique. */
export function staggered(points: readonly Vector3Tuple[], phase = 0): Vector3Tuple[] {
  return points.map(
    (p, i) =>
      [p[0], p[1], p[2] + (i % 2 === 0 ? 0.9 : -0.9) + phase * 0.05] as Vector3Tuple,
  );
}

export function identityOverride(count: number): ClipTransitionOverride {
  return {
    targetPointIndex: Array.from({ length: count }, (_, i) => i),
    startOffsets: Array.from({ length: count }, () => 0),
    laneOffsets: Array.from({ length: count }, () => 0),
    strategy: "test",
  };
}

export function sceneFixture(objectCount: 1 | 2): { project: ShowProject; scene: FormationScene } {
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

/** Imported ESSP project + reference layer (ownership round-trip coverage). */
export async function importedFixture() {
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
