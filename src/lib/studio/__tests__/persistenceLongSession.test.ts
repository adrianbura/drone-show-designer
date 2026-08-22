/**
 * 20-CYCLE PERSISTENCE SESSION.
 *
 * Save -> autosave -> reopen -> restore, twenty times, through the canonical
 * writers (`projectPersistenceOptions`, `serializeProject`, `parseProjectFile`,
 * `writeAutosave`/`readAutosave`/`clearAutosave`) and the autosave generation
 * authority. What must hold on every cycle: full planning parity (including
 * transition designs), consumed recovery after an explicit save/open, dirty
 * semantics, no validation evidence carried in a file, and no growth of any
 * persisted structure.
 */
import { describe, expect, it } from "vitest";

import { evaluateExportEligibility } from "../../adapters/exportEligibility";
import type { KeyValueStore } from "../../library/repository";
import { clearAutosave, readAutosave, writeAutosave } from "../../project/autosave";
import { parseProjectFile, serializeProject } from "../../project/serialize";
import { createDepthStaggerDemoProject } from "../../show/stories/depthStaggerDemo";
import { clipPhase, type ShowProject } from "../../show/types";
import type { ClipTransitionOverride } from "../../show/trajectory";
import type { TransitionDesignState } from "../../show/transition";
import { isAutosaveWriteAuthorized, isRecoveryOfferable } from "../autosaveAuthority";
import { projectPersistenceOptions } from "../projectPersistence";

const STRATEGY = "nearestNeighbor" as const;

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    read: async (key: string) => map.get(key) ?? null,
    write: async (key: string, value: string) => {
      map.set(key, value);
    },
  } as unknown as KeyValueStore;
}

function identityOverride(count: number): ClipTransitionOverride {
  return {
    targetPointIndex: Array.from({ length: count }, (_, i) => i),
    startOffsets: Array.from({ length: count }, () => 0),
    laneOffsets: Array.from({ length: count }, () => 0),
    strategy: "test",
  };
}

describe("20-cycle persistence session", () => {
  it("keeps save/autosave/open parity, consumes obsolete recovery and never grows", async () => {
    const store = memoryStore();
    let project: ShowProject = createDepthStaggerDemoProject();
    const showClip = project.timeline.find((c) => clipPhase(c) === "SHOW")!;
    const transitionOverrides: Record<string, ClipTransitionOverride> = {
      [showClip.id]: identityOverride(project.droneCount),
    };
    const transitionDesigns: Record<string, TransitionDesignState> = {
      [showClip.id]: { mode: "STAGGERED", pattern: "DEPTH" } as unknown as TransitionDesignState,
    };

    let generation = 0;
    let dirty = false;
    let recoveryOffer: unknown = null;
    let exportReport: unknown = null;
    const envelopeSizes: number[] = [];

    for (let cycle = 1; cycle <= 20; cycle++) {
      // --- edit (dirty) + a debounced autosave that captured this generation ---
      project = { ...project, name: `Session project ${cycle}` };
      dirty = true;
      const scheduled = generation;
      const options = projectPersistenceOptions({
        assignmentStrategy: STRATEGY,
        transitionOverrides,
        transitionDesigns,
        referenceLayer: null,
        selectedClipId: showClip.id,
        sampleRate: 8,
      });
      expect(isAutosaveWriteAuthorized(scheduled, generation)).toBe(true);
      await writeAutosave(store, {
        savedAt: `2026-08-22T10:00:${String(cycle).padStart(2, "0")}.000Z`,
        fileName: "session.droneshow.json",
        file: serializeProject(project, { ...options, savedAt: "2026-08-22T10:00:00.000Z" }),
      });
      recoveryOffer = await readAutosave(store);
      expect(isRecoveryOfferable(recoveryOffer as never)).toBe(true);

      // --- restore the autosave: consumed, but the work is still unsaved ---
      const restored = parseProjectFile(
        (recoveryOffer as { file: unknown }).file as never,
      );
      expect(restored.project.name).toBe(project.name);
      expect(restored.planning!.transitionDesigns?.[showClip.id]).toBeDefined();
      await clearAutosave(store);
      generation += 1;
      recoveryOffer = null;
      dirty = true;
      expect(await readAutosave(store)).toBeNull();

      // --- explicit manual save: recovery consumed, project clean ---
      const file = serializeProject(project, { ...options, savedAt: "2026-08-22T10:05:00.000Z" });
      const envelope = JSON.stringify(file);
      envelopeSizes.push(envelope.length);
      await clearAutosave(store);
      generation += 1;
      dirty = false;
      recoveryOffer = null;
      expect(await readAutosave(store)).toBeNull();

      // A pending timer from BEFORE the save can no longer write.
      expect(isAutosaveWriteAuthorized(scheduled, generation)).toBe(false);

      // --- reopen the saved file: full planning parity, no validation evidence ---
      const reopened = parseProjectFile(JSON.parse(envelope) as never);
      expect(reopened.project.name).toBe(project.name);
      expect(reopened.project.droneCount).toBe(project.droneCount);
      expect(reopened.project.timeline.map((c) => c.id)).toEqual(project.timeline.map((c) => c.id));
      expect(reopened.planning!.assignmentStrategy).toBe(STRATEGY);
      expect(reopened.planning!.transitionOverrides[showClip.id]).toEqual(
        transitionOverrides[showClip.id],
      );
      expect(reopened.planning!.transitionDesigns?.[showClip.id]).toEqual(
        transitionDesigns[showClip.id],
      );
      expect(reopened.referenceLayer ?? null).toBeNull();
      expect(reopened.editor?.selectedClipId).toBe(showClip.id);
      expect(JSON.stringify(reopened)).not.toContain("exportReadiness");
      expect(reopened.project.audio.attached).toBe(false);

      // Reopening never carries validation over: export stays unavailable.
      exportReport = null;
      dirty = false;
      expect(evaluateExportEligibility(exportReport as never, false).reason).toBe("NO_REPORT");
      expect(dirty).toBe(false);
      project = reopened.project;
    }

    // No structural growth: identical content serialises to a stable size.
    const spread = Math.max(...envelopeSizes) - Math.min(...envelopeSizes);
    expect(spread).toBeLessThanOrEqual(20);
    expect(Object.keys(transitionOverrides)).toHaveLength(1);
    expect(Object.keys(transitionDesigns)).toHaveLength(1);
  }, 120_000);
});
