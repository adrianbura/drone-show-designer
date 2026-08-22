/**
 * LIGHTING SELECTION LIFECYCLE (long-session acceptance).
 *
 * The lighting inspector selection is EDITOR state. It must never survive its
 * subject: deleting the effect, switching clip, undo/redo of the deletion or a
 * project switch. It must equally survive commands that do not touch it (a
 * geometry apply on the same clip).
 *
 * Everything here runs through the canonical authorities
 * (`reconcileEditorSelection`, `boundHistory`, the geometry apply harness); the
 * store wiring is pinned by source assertions so it cannot drift out.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createEffectFromPreset, findLightingPreset } from "../../show/lighting";
import { createDemoProject } from "../../show/defaultProject";
import { clipPhase, type ShowProject } from "../../show/types";
import {
  EMPTY_EDITOR_CLIP_SELECTION,
  reconcileEditorSelection,
  type EditorClipSelectionState,
} from "../clipSelection";
import { boundHistory } from "../editorSession";
import { ApplyHarness, readiness, showClip, staggered } from "./support/geometryApplyHarness";
import { projectWithFormationPoints } from "../../show/diagnostics";

const STORE_SRC = readFileSync(join(process.cwd(), "src/lib/studio/store.tsx"), "utf8");

function withEffect(project: ShowProject, clipId: string, id: string): ShowProject {
  const preset = findLightingPreset("PULSE_2")!;
  return {
    ...project,
    lighting: {
      schemaVersion: 1,
      effects: [
        ...(project.lighting?.effects ?? []),
        { ...createEffectFromPreset(preset, { kind: "SCENE", clipId }, { idSeed: 1 }), id },
      ],
    },
  };
}

/** Minimal model of the store slots involved in lighting selection. */
class LightingSession {
  project: ShowProject;
  selectedClipId: string;
  selection: EditorClipSelectionState = EMPTY_EDITOR_CLIP_SELECTION;
  past: ShowProject[] = [];
  future: ShowProject[] = [];

  constructor(project: ShowProject, clipId: string) {
    this.project = project;
    this.selectedClipId = clipId;
  }

  select(id: string | null) {
    this.selection = { ...this.selection, selectedLightingEffectId: id };
  }

  /** Same discipline as the store: delete clears a selection of the subject. */
  removeEffect(id: string) {
    this.past = boundHistory([...this.past, this.project]);
    this.future = [];
    this.project = {
      ...this.project,
      lighting: {
        schemaVersion: 1,
        effects: (this.project.lighting?.effects ?? []).filter((e) => e.id !== id),
      },
    };
    if (this.selection.selectedLightingEffectId === id) this.select(null);
    this.reconcile();
  }

  selectClip(id: string) {
    const previous = this.selectedClipId;
    this.selectedClipId = id;
    this.selection = reconcileEditorSelection(this.project, id, this.selection, previous);
  }

  reconcile() {
    this.selection = reconcileEditorSelection(
      this.project,
      this.selectedClipId,
      this.selection,
      this.selectedClipId,
    );
  }

  undo() {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.project);
    this.project = previous;
    this.reconcile();
    return true;
  }

  redo() {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.project);
    this.project = next;
    this.reconcile();
    return true;
  }
}

describe("lighting selection lifecycle", () => {
  it("clears the selection when the selected effect is deleted, and undo/redo never resurrects it", () => {
    const base = createDemoProject();
    const clip = showClip(base);
    const session = new LightingSession(withEffect(base, clip.id, "fx-1"), clip.id);
    session.select("fx-1");
    session.reconcile();
    expect(session.selection.selectedLightingEffectId).toBe("fx-1");

    session.removeEffect("fx-1");
    expect(session.selection.selectedLightingEffectId).toBeNull();

    // Undo brings the EFFECT back as project content, but not the selection.
    expect(session.undo()).toBe(true);
    expect(session.project.lighting!.effects.some((e) => e.id === "fx-1")).toBe(true);
    expect(session.selection.selectedLightingEffectId).toBeNull();

    // Redo removes it again; a stale selection can never reappear.
    expect(session.redo()).toBe(true);
    expect(session.project.lighting!.effects.some((e) => e.id === "fx-1")).toBe(false);
    expect(session.selection.selectedLightingEffectId).toBeNull();
  });

  it("drops a selection that belongs to another clip and never resurrects it on return", () => {
    const base = createDemoProject();
    const clips = base.timeline.filter((c) => clipPhase(c) === "SHOW");
    const [a, b] = [clips[0]!, clips[1]!];
    const session = new LightingSession(withEffect(base, a.id, "fx-a"), a.id);
    session.select("fx-a");
    session.reconcile();

    session.selectClip(b.id);
    expect(session.selection.selectedLightingEffectId).toBeNull();

    session.selectClip(a.id);
    expect(session.selection.selectedLightingEffectId).toBeNull();
  });

  it("refuses an effect id that no longer exists in the project", () => {
    const base = createDemoProject();
    const clip = showClip(base);
    const session = new LightingSession(base, clip.id);
    session.select("fx-never-existed");
    session.reconcile();
    expect(session.selection.selectedLightingEffectId).toBeNull();
  });

  it("keeps a valid lighting selection across a geometry apply on the same clip", () => {
    const base = createDemoProject();
    const clip = showClip(base);
    const project = withEffect(base, clip.id, "fx-keep");
    const formation = project.formations.find((f) => f.id === clip.formationId)!;
    const after = projectWithFormationPoints(project, formation.id, staggered(formation.points));

    const store = new ApplyHarness(project, { selectedClipId: clip.id });
    store.selection = { ...store.selection, selectedLightingEffectId: "fx-keep" };
    expect(store.apply(after, readiness("READY")).ok).toBe(true);
    expect(store.selection.selectedLightingEffectId).toBe("fx-keep");

    expect(store.undo()).toBe(true);
    expect(store.selection.selectedLightingEffectId).toBe("fx-keep");
  });

  it("store wiring: effect deletion clears the selection at the command boundary", () => {
    const removal = STORE_SRC.slice(STORE_SRC.indexOf("const removeLightingEffect"));
    expect(removal.slice(0, 400)).toContain("setSelectedLightingEffectId");
  });
});
