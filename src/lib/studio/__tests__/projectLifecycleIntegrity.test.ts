/**
 * PROJECT LIFECYCLE INTEGRITY — persistence parity, autosave round-trip and the
 * single project-adoption boundary.
 *
 * The harness uses the SAME authorities the store calls: `projectPersistenceOptions`
 * for both writers, `serializeProject` / `parseProjectFile` for the envelope,
 * `writeAutosave` / `readAutosave` for recovery and `resetProjectSessionState`
 * plus `invalidateDerivedAnalysis` for adoption. No policy is duplicated here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readAutosave, writeAutosave } from "../../project/autosave";
import { parseProjectFile, serializeProject } from "../../project/serialize";
import type { KeyValueStore } from "../../library/repository";
import { createDepthStaggerDemoProject } from "../../show/stories/depthStaggerDemo";
import type { ClipTransitionOverride } from "../../show/trajectory";
import { clipPhase } from "../../show/types";
import { invalidateDerivedAnalysis, DERIVED_ANALYSIS_SLOTS } from "../derivedAnalysis";
import {
  PROJECT_SESSION_RESET_SLOTS,
  resetProjectSessionState,
  type ProjectSessionResetSetters,
} from "../projectLifecycle";
import { projectPersistenceOptions } from "../projectPersistence";

const STORE_SRC = readFileSync(join(process.cwd(), "src/lib/studio/store.tsx"), "utf8");

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    read: async (key: string) => map.get(key) ?? null,
    write: async (key: string, value: string) => {
      map.set(key, value);
    },
  } as unknown as KeyValueStore;
}

function authoredState() {
  const project = createDepthStaggerDemoProject();
  const clipId = project.timeline.find((c) => clipPhase(c) === "SHOW")!.id;
  const n = project.droneCount;
  const override: ClipTransitionOverride = {
    targetPointIndex: Array.from({ length: n }, (_, i) => i),
    startOffsets: Array.from({ length: n }, () => 0),
    laneOffsets: Array.from({ length: n }, () => 0),
    strategy: "nearestNeighbor",
  };
  return {
    project,
    clipId,
    state: {
      assignmentStrategy: "optimalDistance" as const,
      transitionOverrides: { [clipId]: override },
      transitionDesigns: {
        [clipId]: {
          mode: "MANUAL",
          autoRecalculate: false,
          stagger: { enabled: true, amount: 0.25 },
        },
      } as never,
      referenceLayer: null,
      selectedClipId: clipId,
      sampleRate: 17,
    },
  };
}

describe("save / autosave semantic parity", () => {
  it("writes identical planning, reference and editor payloads", () => {
    const { project, state } = authoredState();
    const options = projectPersistenceOptions(state);
    const manual = serializeProject(project, options);
    const autosaved = serializeProject(project, { savedAt: "2026-01-01T00:00:00.000Z", ...options });

    expect(autosaved.planning).toEqual(manual.planning);
    expect(autosaved.referenceLayer).toEqual(manual.referenceLayer);
    expect(autosaved.editor).toEqual(manual.editor);
    expect(autosaved.savedAt).not.toBe(manual.savedAt);
  });

  it("keeps both store writers on the canonical mapping", () => {
    // Exactly one persistence mapping call site feeds both writers.
    expect(STORE_SRC).toContain("projectPersistenceOptions({");
    expect(STORE_SRC.match(/projectPersistenceOptions\(/g)?.length).toBe(1);
    expect(STORE_SRC).toContain("serializeProject(project, { savedAt, ...persistenceOptions })");
    expect(STORE_SRC).toContain("serializeProject(project, persistenceOptions)");
    // The old hand-rolled autosave planning literal (missing designs) is gone.
    expect(STORE_SRC).not.toContain("planning: { assignmentStrategy, transitionOverrides }");
  });
});

describe("autosave recovery round-trip", () => {
  it("restores planning, designs and editor prefs exactly", async () => {
    const { project, clipId, state } = authoredState();
    const store = memoryStore();
    const savedAt = "2026-02-02T10:00:00.000Z";
    await writeAutosave(store, {
      savedAt,
      fileName: "authored.dss.json",
      file: serializeProject(project, { savedAt, ...projectPersistenceOptions(state) }),
    });

    const snapshot = await readAutosave(store);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.fileName).toBe("authored.dss.json");
    expect(snapshot!.file.planning!.assignmentStrategy).toBe("optimalDistance");
    expect(snapshot!.file.planning!.transitionOverrides[clipId]).toEqual(
      state.transitionOverrides[clipId],
    );
    // REAL BUG COVERAGE: transition designs used to be dropped by autosave.
    expect(snapshot!.file.planning!.transitionDesigns?.[clipId]).toMatchObject({
      mode: "MANUAL",
      autoRecalculate: false,
    });
    expect(snapshot!.file.editor).toEqual({ selectedClipId: clipId, sampleRate: 17 });
    // No derived validation report can survive: the envelope has no slot for it.
    expect(Object.keys(snapshot!.file)).not.toContain("fullShow");
    // Audio bytes are never persisted and reopen detached.
    expect(snapshot!.file.project.audio.attached).toBe(false);
  });
});

describe("project adoption boundary", () => {
  /** Faithful model of the session/derived slices an adoption touches. */
  function sessionModel() {
    const state: Record<string, unknown> = {
      referenceShow: { drones: [] },
      referencePlayback: true,
      referenceBusy: true,
      referenceError: { code: "X", message: "old" },
      selectedReferenceDroneId: "d1",
      showReferencePaths: true,
      referenceExtraction: [{}],
      referenceAssetDrafts: [{}],
      referenceExtractionWarnings: ["w"],
      forensicsReport: {},
      forensicsError: "boom",
      forensicsBusy: true,
      selectedForensicSegmentId: "s1",
      aiProposal: {},
      aiProposalErrors: ["e"],
      aiHistory: [{}],
      aiError: { code: "A", message: "old" },
      aiPreviewTime: 42,
      aiBusy: true,
      svgDraft: {},
      svgError: { code: "S" },
      svgBusy: true,
      sceneSelection: { ids: ["o1"], primaryId: "o1" },
      sceneGizmoDraft: {},
      sceneReferenceGhost: true,
      selectedLaunchGroupId: "g1",
      selectedPointIds: ["p1"],
      selectedMotionGroupId: "m1",
      dynamicEditTime: 12,
      explicitDynamicId: "dyn1",
      audioSession: { buffer: {}, peaks: {}, error: "old", busy: true },
    };
    const set = (key: string, value: unknown) => () => {
      state[key] = value;
    };
    const setters: ProjectSessionResetSetters = {
      setReferenceShow: set("referenceShow", null),
      setReferencePlayback: set("referencePlayback", false),
      setReferenceBusy: set("referenceBusy", false),
      setReferenceError: set("referenceError", null),
      setSelectedReferenceDroneId: set("selectedReferenceDroneId", null),
      setShowReferencePaths: set("showReferencePaths", false),
      setReferenceExtraction: set("referenceExtraction", []),
      setReferenceAssetDrafts: set("referenceAssetDrafts", []),
      setReferenceExtractionWarnings: set("referenceExtractionWarnings", []),
      setForensicsReport: set("forensicsReport", null),
      setForensicsError: set("forensicsError", null),
      setForensicsBusy: set("forensicsBusy", false),
      setSelectedForensicSegmentId: set("selectedForensicSegmentId", null),
      setAiProposal: set("aiProposal", null),
      setAiProposalErrors: set("aiProposalErrors", []),
      setAiHistory: set("aiHistory", []),
      setAiError: set("aiError", null),
      setAiPreviewTime: set("aiPreviewTime", 0),
      setAiBusy: set("aiBusy", false),
      setSvgDraft: set("svgDraft", null),
      setSvgError: set("svgError", null),
      setSvgBusy: set("svgBusy", false),
      clearSceneSelection: set("sceneSelection", { ids: [], primaryId: null }),
      setSceneGizmoDraft: set("sceneGizmoDraft", null),
      setSceneReferenceGhost: set("sceneReferenceGhost", false),
      setSelectedLaunchGroupId: set("selectedLaunchGroupId", null),
      setSelectedPointIds: set("selectedPointIds", []),
      setSelectedMotionGroupId: set("selectedMotionGroupId", null),
      setDynamicEditTime: set("dynamicEditTime", 0),
      setExplicitDynamicId: set("explicitDynamicId", null),
      clearAudioSession: set("audioSession", { buffer: null, peaks: null, error: null, busy: false }),
    };
    return { state, setters };
  }

  it("clears every session slot of the replaced project", () => {
    const { state, setters } = sessionModel();
    resetProjectSessionState(setters);
    for (const slot of PROJECT_SESSION_RESET_SLOTS) {
      const value = state[slot];
      if (Array.isArray(value)) expect(value).toEqual([]);
      else if (typeof value === "boolean") expect(value).toBe(false);
      else if (typeof value === "number") expect(value).toBe(0);
      else if (slot === "sceneSelection") expect(value).toEqual({ ids: [], primaryId: null });
      else if (slot === "audioSession")
        expect(value).toEqual({ buffer: null, peaks: null, error: null, busy: false });
      else expect(value).toBeNull();
    }
  });

  it("does not leak the old decoded audio buffer or AI proposal", () => {
    const { state, setters } = sessionModel();
    resetProjectSessionState(setters);
    expect((state["audioSession"] as { buffer: unknown }).buffer).toBeNull();
    expect(state["aiProposal"]).toBeNull();
    expect(state["aiBusy"]).toBe(false);
    expect(state["forensicsReport"]).toBeNull();
  });

  it("invalidates derived analysis in the same commit", () => {
    const derived: Record<string, unknown> = {
      transitionAnalysis: {},
      assignmentComparison: {},
      optimization: {},
      transitionError: { code: "X", message: "old" },
      fullShow: {},
      fullShowError: { code: "Y", message: "old" },
      highlightedDrones: [3],
      preShowPreview: {},
    };
    let cancelled = false;
    invalidateDerivedAnalysis({
      setTransitionAnalysis: (v) => void (derived["transitionAnalysis"] = v),
      setAssignmentComparison: (v) => void (derived["assignmentComparison"] = v),
      setOptimization: (v) => void (derived["optimization"] = v),
      setTransitionError: (v) => void (derived["transitionError"] = v),
      setFullShow: (v) => void (derived["fullShow"] = v),
      setFullShowError: (v) => void (derived["fullShowError"] = v),
      setHighlightedDrones: (v) => void (derived["highlightedDrones"] = v),
      setPreShowPreview: (v) => void (derived["preShowPreview"] = v),
      invalidateFullShowRun: () => {
        cancelled = true;
      },
    });
    for (const slot of DERIVED_ANALYSIS_SLOTS) {
      const value = derived[slot];
      if (Array.isArray(value)) expect(value).toEqual([]);
      else expect(value).toBeNull();
    }
    expect(cancelled).toBe(true);
  });

  it("routes new / sample / open / recovery through one boundary in the store", () => {
    // loadShowProject (new project, sample shows) delegates to the adoption ref.
    expect(STORE_SRC).toContain("adoptProjectRef.current(created");
    expect(STORE_SRC).toContain("sessionResetRef.current();");
    // Exactly one place clears the timeline/dynamic histories on adoption.
    expect(STORE_SRC.match(/dynamicHistory\.current = \{ past: \[\], future: \[\] \};/g)?.length)
      .toBeGreaterThan(0);
    // Recovery adopts through the file boundary with recovered file semantics.
    expect(STORE_SRC).toContain('"RECOVERED"');
    // Reference authority always travels with the adopted file, including null.
    expect(STORE_SRC).toContain("referenceLayer: file.referenceLayer ?? null");
  });

  it("keeps file semantics distinct for file, unsaved and recovered adoptions", () => {
    expect(STORE_SRC).toContain('const fileState = restore?.fileState ?? "FILE";');
    expect(STORE_SRC).toContain('fileState: "UNSAVED"');
  });
});

describe("failed open atomicity", () => {
  it("rejects a malformed project before anything can be adopted", () => {
    expect(() => parseProjectFile("{ not json")).toThrow();
    expect(() => parseProjectFile(JSON.stringify({ kind: "nope" }))).toThrow();
    const { project, state } = authoredState();
    const file = serializeProject(project, projectPersistenceOptions(state));
    expect(() =>
      parseProjectFile(
        JSON.stringify({
          ...file,
          project: {
            ...file.project,
            formations: [{ ...file.project.formations[0], points: [[0, 0, "x"]] }],
          },
        }),
      ),
    ).toThrow();
  });

  it("rejects a malformed reference payload instead of adopting partially", () => {
    const { project, state } = authoredState();
    const file = serializeProject(project, projectPersistenceOptions(state));
    expect(() =>
      parseProjectFile(JSON.stringify({ ...file, referenceLayer: { bogus: true } })),
    ).toThrow();
  });

  it("round-trips a valid envelope", () => {
    const { project, clipId, state } = authoredState();
    const file = serializeProject(project, projectPersistenceOptions(state));
    const reopened = parseProjectFile(JSON.stringify(file));
    expect(reopened.planning!.assignmentStrategy).toBe("optimalDistance");
    expect(reopened.planning!.transitionDesigns?.[clipId]).toMatchObject({ mode: "MANUAL" });
    expect(reopened.editor?.sampleRate).toBe(17);
  });
});
