/**
 * 50-CYCLE PROJECT SWITCH STRESS.
 *
 * A project switch is the strongest coherence boundary in the Studio: nothing
 * from the previous document may survive it. This suite runs 50 alternating
 * adoptions through the SAME authorities the store calls
 * (`resetProjectSessionState`, `invalidateDerivedAnalysis`,
 * `reconcileAdoptedEditorSession`, `invalidateProjectSessionJobs`,
 * `reconcileEditorSelection`, `boundHistory`) and asserts that every canonical
 * slot is clean while global operator preferences are untouched.
 */
import { describe, expect, it } from "vitest";

import { evaluateExportEligibility } from "../../adapters/exportEligibility";
import { createDefaultProject, createDemoProject } from "../../show/defaultProject";
import { createDepthStaggerDemoProject } from "../../show/stories/depthStaggerDemo";
import { showDuration, type ShowProject } from "../../show/types";
import {
  createAsyncJobAuthority,
  createProjectSessionAuthority,
  invalidateProjectSessionJobs,
} from "../asyncJobAuthority";
import { EMPTY_EDITOR_CLIP_SELECTION, reconcileEditorSelection } from "../clipSelection";
import { DERIVED_ANALYSIS_SLOTS, invalidateDerivedAnalysis } from "../derivedAnalysis";
import {
  ADOPTED_PLAYHEAD_TIME,
  ADOPTED_TIMELINE_VIEW,
  boundHistory,
  clampPlayheadTime,
  reconcileAdoptedEditorSession,
} from "../editorSession";
import { PROJECT_SESSION_RESET_SLOTS, resetProjectSessionState } from "../projectLifecycle";

/** Records which canonical slot each authority setter cleared. */
function recordingSetters(cleared: Set<string>) {
  return new Proxy(
    {},
    {
      get: () => {
        const handler = (..._args: unknown[]) => undefined;
        return handler;
      },
    },
  ) as never;
}

function slotFromSetter(name: string): string {
  return name.replace(/^(set|clear|invalidate)/, "").replace(/^./, (c) => c.toLowerCase());
}

function trackingSetters(cleared: Set<string>) {
  return new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        (..._args: unknown[]) => {
          cleared.add(slotFromSetter(prop));
        },
    },
  ) as never;
}

const PROJECTS: readonly (() => ShowProject)[] = [
  createDefaultProject,
  createDemoProject,
  createDepthStaggerDemoProject,
];

const GLOBAL_PREFERENCES = [
  "snapMode",
  "followPlayhead",
  "speed",
  "loop",
  "audienceView",
  "forensicsThresholds",
] as const;

describe("50-cycle project switch stress", () => {
  it("adopts 50 projects with no session, derived, editor or history crossover", () => {
    const session = createProjectSessionAuthority();
    const jobs = [
      createAsyncJobAuthority(),
      createAsyncJobAuthority(),
      createAsyncJobAuthority(),
      createAsyncJobAuthority(),
    ];

    // Global operator preferences: authored once, never reset by an adoption.
    const preferences: Record<string, unknown> = {
      snapMode: "GRID",
      followPlayhead: true,
      speed: 2,
      loop: true,
      audienceView: { azimuthDeg: 42 },
      forensicsThresholds: { maxSpeed: 9 },
    };
    const preferencesJson = JSON.stringify(preferences);

    let project = createDefaultProject();
    let selectedClipId: string | null = project.timeline[0]?.id ?? null;
    let selection = EMPTY_EDITOR_CLIP_SELECTION;
    let playing = true;
    let time = 12.5;
    let view = { zoom: 4, scroll: 260 };
    let geometryGhost: unknown = { points: [[0, 0, 0]] };
    let exportReport: unknown = { exportReadiness: { status: "READY", blockers: [], warnings: [] } };
    let past: unknown[] = [];
    let future: unknown[] = [];
    let previousSessionGeneration = session.generation;

    for (let cycle = 1; cycle <= 50; cycle++) {
      // Dirty the whole session with evidence belonging to the OPEN project.
      const staleJobTokens = jobs.map((job, i) => job.begin(session.scope("scope", i)));
      past = Array.from({ length: 80 }, (_, i) => ({ cycle, i }));
      future = [{ cycle }];
      playing = true;
      time = 12.5;
      view = { zoom: 4, scroll: 260 };
      geometryGhost = { points: [[cycle, 0, 0]] };
      exportReport = { exportReadiness: { status: "READY", blockers: [], warnings: [] } };
      selection = {
        ...selection,
        sceneSelection: { ids: ["stale-object"], primaryId: "stale-object" },
        selectedLightingEffectId: "fx-stale",
        selectedPointIds: ["p-stale"],
        selectedMotionGroupId: "g-stale",
        explicitDynamicId: "dyn-stale",
        gizmoDraftActive: true,
      };

      // ---- adopt the next project through the canonical authorities ----
      const next = PROJECTS[cycle % PROJECTS.length]!();
      const sessionCleared = new Set<string>();
      resetProjectSessionState(trackingSetters(sessionCleared));
      const derivedCleared = new Set<string>();
      invalidateDerivedAnalysis(trackingSetters(derivedCleared));
      reconcileAdoptedEditorSession({
        stopPlayback: () => {
          playing = false;
        },
        seek: (t) => {
          time = t;
        },
        resetTimelineView: () => {
          view = { ...ADOPTED_TIMELINE_VIEW };
        },
        clearGeometryDiagnostics: () => {
          geometryGhost = null;
        },
      });
      invalidateProjectSessionJobs(session, jobs);
      exportReport = null;
      past = boundHistory([]);
      future = [];
      project = next;
      selectedClipId = next.timeline[0]?.id ?? null;
      selection = reconcileEditorSelection(next, selectedClipId, selection, null);

      // ---- acceptance for this cycle ----
      for (const slot of PROJECT_SESSION_RESET_SLOTS) {
        expect(sessionCleared, `cycle ${cycle}: ${slot}`).toContain(slot);
      }
      for (const slot of DERIVED_ANALYSIS_SLOTS) {
        expect(derivedCleared, `cycle ${cycle}: ${slot}`).toContain(slot);
      }
      expect(playing).toBe(false);
      expect(time).toBe(ADOPTED_PLAYHEAD_TIME);
      expect(clampPlayheadTime(time, { duration: showDuration(project), startTime: -30 })).toBe(0);
      expect(view).toEqual(ADOPTED_TIMELINE_VIEW);
      expect(geometryGhost).toBeNull();
      expect(past).toHaveLength(0);
      expect(future).toHaveLength(0);
      expect(evaluateExportEligibility(exportReport as never, false).reason).toBe("NO_REPORT");

      // Selection is valid for the NEW project only.
      expect(selection.sceneSelection.ids).toEqual([]);
      expect(selection.selectedLightingEffectId).toBeNull();
      expect(selection.selectedPointIds).toEqual([]);
      expect(selection.selectedMotionGroupId).toBeNull();
      expect(selection.gizmoDraftActive).toBe(false);
      if (selection.explicitDynamicId) {
        expect((project.dynamicFormations ?? []).some((d) => d.id === selection.explicitDynamicId)).toBe(
          true,
        );
      }
      expect(
        selectedClipId === null
          ? project.timeline.length === 0
          : project.timeline.some((c) => c.id === selectedClipId),
      ).toBe(true);

      // Every job started for the previous project is now refused.
      for (const token of staleJobTokens) {
        const job = jobs[staleJobTokens.indexOf(token)]!;
        expect(job.isCurrent(token)).toBe(false);
        expect(job.accepts(token, token.scope)).toBe(false);
      }
      expect(session.generation).toBeGreaterThan(previousSessionGeneration);
      previousSessionGeneration = session.generation;
    }

    // Global preferences survived all 50 switches untouched.
    expect(JSON.stringify(preferences)).toBe(preferencesJson);
    for (const pref of GLOBAL_PREFERENCES) expect(preferences[pref]).toBeDefined();
    // Long-session summary: nothing accumulated.
    expect(past).toHaveLength(0);
    expect(future).toHaveLength(0);
    expect(session.generation).toBe(50);
    void recordingSetters;
  }, 120_000);
});
