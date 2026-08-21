/**
 * EDITOR STATE INTEGRITY + LONG SESSION STABILITY.
 *
 * Deterministic, sleep-free coverage of the pure authorities that keep the
 * Studio coherent across long sessions: history bounds, adopted playhead /
 * timeline-view reconciliation, selection reconciliation and the project
 * session reset lists. No safety limits, export policy or geometry maths here.
 */
import { describe, expect, it } from "vitest";

import {
  ADOPTED_EDITOR_SESSION_SLOTS,
  ADOPTED_PLAYHEAD_TIME,
  ADOPTED_TIMELINE_VIEW,
  TIMELINE_HISTORY_LIMIT,
  boundHistory,
  clampPlayheadTime,
  reconcileAdoptedEditorSession,
} from "../editorSession";
import {
  EMPTY_EDITOR_CLIP_SELECTION,
  reconcileEditorSelection,
  type EditorClipSelectionState,
} from "../clipSelection";
import { PROJECT_SESSION_RESET_SLOTS } from "../projectLifecycle";
import { DERIVED_ANALYSIS_SLOTS } from "../derivedAnalysis";
import { createDefaultProject } from "../../show/defaultProject";
import { createDepthStaggerDemoProject } from "../../show/stories/depthStaggerDemo";
import { showDuration } from "../../show/types";

describe("history bounds", () => {
  it("bounds a timeline history at the configured limit over >100 operations", () => {
    const past: number[] = [];
    for (let i = 0; i < 140; i++) {
      past.push(i);
      boundHistory(past);
      expect(past.length).toBeLessThanOrEqual(TIMELINE_HISTORY_LIMIT);
    }
    // Newest entries are kept, oldest are dropped.
    expect(past[past.length - 1]).toBe(139);
    expect(past[0]).toBe(140 - TIMELINE_HISTORY_LIMIT);
  });

  it("uses the same bound as the dynamic-formation history", () => {
    expect(TIMELINE_HISTORY_LIMIT).toBe(50);
  });
});

describe("adopted playhead", () => {
  it("time 0 is playable in every project range", () => {
    const projects = [createDefaultProject(), createDepthStaggerDemoProject()];
    for (const project of projects) {
      const duration = showDuration(project);
      expect(clampPlayheadTime(ADOPTED_PLAYHEAD_TIME, { duration, startTime: -30 })).toBe(0);
    }
  });

  it("clamps a time from a long project into a short one", () => {
    expect(clampPlayheadTime(900, { duration: 60, startTime: -20 })).toBe(60);
    expect(clampPlayheadTime(-900, { duration: 60, startTime: -20 })).toBe(-20);
    expect(clampPlayheadTime(Number.NaN, { duration: 60, startTime: -20 })).toBe(-20);
    expect(clampPlayheadTime(12, { duration: 60, startTime: -20 })).toBe(12);
  });
});

describe("adopted editor session reconciliation", () => {
  it("stops playback, rewinds, fits the timeline and drops geometry diagnostics", () => {
    const calls: string[] = [];
    let seeked = -1;
    reconcileAdoptedEditorSession({
      stopPlayback: () => calls.push("stop"),
      seek: (t) => {
        seeked = t;
        calls.push("seek");
      },
      resetTimelineView: () => calls.push("view"),
      clearGeometryDiagnostics: () => calls.push("ghost"),
    });
    expect(calls).toEqual(["stop", "seek", "view", "ghost"]);
    expect(seeked).toBe(ADOPTED_PLAYHEAD_TIME);
    expect(ADOPTED_TIMELINE_VIEW).toEqual({ zoom: 1, scroll: 0 });
    expect([...ADOPTED_EDITOR_SESSION_SLOTS]).toEqual([
      "playing",
      "time",
      "timelineZoom",
      "timelineScroll",
      "geometryDiagnostics",
    ]);
  });

  it("keeps global preference slots out of every reset list", () => {
    const all = [
      ...ADOPTED_EDITOR_SESSION_SLOTS,
      ...PROJECT_SESSION_RESET_SLOTS,
      ...DERIVED_ANALYSIS_SLOTS,
    ] as readonly string[];
    for (const pref of ["snapMode", "followPlayhead", "speed", "loop", "audienceView", "forensicsThresholds"]) {
      expect(all).not.toContain(pref);
    }
  });
});

describe("selection integrity across long sessions", () => {
  it("clears stale scene, lighting and dynamic selections on a clip switch", () => {
    const project = createDepthStaggerDemoProject();
    const first = project.timeline[0]!.id;
    const second = project.timeline[1]!.id;
    const next = reconcileEditorSelection(
      project,
      second,
      {
        ...EMPTY_EDITOR_CLIP_SELECTION,
        sceneSelection: { ids: ["ghost-object"], primaryId: "ghost-object" },
        selectedLightingEffectId: "fx-gone",
        selectedPointIds: ["p-gone"],
        selectedMotionGroupId: "g-gone",
        gizmoDraftActive: true,
      },
      first,
    );
    expect(next.sceneSelection.ids).toEqual([]);
    expect(next.sceneSelection.primaryId).toBeNull();
    expect(next.selectedLightingEffectId).toBeNull();
    expect(next.selectedPointIds).toEqual([]);
    expect(next.selectedMotionGroupId).toBeNull();
    expect(next.gizmoDraftActive).toBe(false);
  });

  it("stays clean over 50 alternating clip switches", () => {
    const project = createDepthStaggerDemoProject();
    const ids = project.timeline.map((c) => c.id);
    let state: EditorClipSelectionState = {
      ...EMPTY_EDITOR_CLIP_SELECTION,
      sceneSelection: { ids: ["stale"], primaryId: "stale" },
      selectedLightingEffectId: "fx-stale",
    };
    let previous: string | null = null;
    for (let cycle = 0; cycle < 50; cycle++) {
      const nextClip = ids[cycle % ids.length]!;
      state = reconcileEditorSelection(project, nextClip, state, previous);
      previous = nextClip;
      expect(state.sceneSelection.ids.every((id) => id !== "stale")).toBe(true);
      expect(state.selectedLightingEffectId).toBeNull();
      expect(state.selectedPointIds).toEqual([]);
      expect(state.gizmoDraftActive).toBe(false);
    }
  });
});
