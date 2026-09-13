/**
 * PHASE EDITOR PRESENTATION (pure) + open channel.
 *
 * A SHOW clip has exactly TWO operator-facing parts, and they are already
 * modelled: FORMATION (the incoming transition) and DISPLAY (the stable hold).
 * This module adds NO second phase model — it projects the canonical
 * `clip.transition` / `clip.hold` numbers and the existing
 * `ClipAuthoringPhase` (see `clipAuthoringPhase.ts`) into the small amount of
 * text and routing a compact workspace section needs.
 *
 * Nothing here mutates the project, plans trajectories, creates history or
 * touches persistence. Every shortcut points at an EXISTING canonical editor.
 */
import { clipPhase, type TimelineClip } from "@/lib/show/types";
import { clipAuthoringPhaseLabel, type ClipAuthoringPhase } from "./clipAuthoringPhase";
import type { StudioSurfaceId } from "./inspectorFocus";
import { requestWorkspaceSection } from "./workspaceSections";

export interface PhaseInterval {
  /** Show time where the phase starts. */
  readonly start: number;
  /** Show time where the phase ends (formation-ready time, or clip end). */
  readonly end: number;
  readonly duration: number;
}

/**
 * Canonical interval of one clip part. FORMATION runs from the clip start to
 * the formation-ready time (start + transition); DISPLAY runs from there to the
 * clip end (+ hold).
 */
export function phaseInterval(clip: TimelineClip, phase: ClipAuthoringPhase): PhaseInterval {
  const start = Number.isFinite(clip.start) ? clip.start : 0;
  const transition = Math.max(0, Number.isFinite(clip.transition) ? clip.transition : 0);
  const hold = Math.max(0, Number.isFinite(clip.hold) ? clip.hold : 0);
  const ready = start + transition;
  return phase === "FORMATION"
    ? { start, end: ready, duration: transition }
    : { start: ready, end: ready + hold, duration: hold };
}

/** Section header: the operator word for the part, nothing more. */
export function phaseEditorHeader(phase: ClipAuthoringPhase): string {
  return clipAuthoringPhaseLabel(phase);
}

/** Plain-language description of what the interval bounds mean. */
export function phaseIntervalMeaning(phase: ClipAuthoringPhase): string {
  return phase === "FORMATION"
    ? "Clip start to formation-ready time"
    : "Formation-ready time to clip end";
}

/** One shortcut into an editor that already exists. */
export type PhaseShortcut =
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: "SURFACE";
      readonly surface: StudioSurfaceId;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: "SECTION";
      readonly control: string;
    };

/**
 * FORMATION offers transition authoring only: no regular scene Motion effects
 * and no formation colour, because neither exists for the incoming transition.
 * DISPLAY offers the everyday visual authoring sections.
 */
export function phaseShortcuts(phase: ClipAuthoringPhase): readonly PhaseShortcut[] {
  if (phase === "FORMATION") {
    return [
      { id: "TRANSITION_DESIGN", label: "Formation style", kind: "SURFACE", surface: "TRANSITION" },
      { id: "REPLAN_ASSIGNMENT", label: "Assignment", kind: "SURFACE", surface: "TRANSITION" },
      { id: "TRANSITION_DURATION", label: "Formation duration", kind: "SURFACE", surface: "CLIP" },
    ];
  }
  return [
    { id: "VISUALS", label: "Visuals", kind: "SECTION", control: "composer-add-visual" },
    { id: "CATALOG", label: "Effect catalog", kind: "SECTION", control: "effect-catalog-search" },
    { id: "COLOUR", label: "Colour", kind: "SECTION", control: "effect-stack-presets" },
    { id: "MOTION", label: "Motion", kind: "SECTION", control: "motion-stack-presets" },
    { id: "STATES", label: "Saved states", kind: "SECTION", control: "visual-states" },
  ];
}

/** True only for a SHOW clip: flight phases have no authoring parts. */
export function canOpenPhaseEditor(clip: TimelineClip | null | undefined): boolean {
  return !!clip && clipPhase(clip) === "SHOW";
}

// ---- OPEN CHANNEL (navigation only) --------------------------------------

export interface PhaseEditorRequest {
  readonly clipId: string;
  readonly phase: ClipAuthoringPhase;
  /** Monotonic — the same request still re-opens the section. */
  readonly requestId: number;
}

const EVENT = "studio:open-phase-editor";
let counter = 0;

/**
 * Asks the workspace to reveal the Phase Editor for one clip part. Opening
 * mutates nothing: it selects nothing, plans nothing and creates no history.
 */
export function requestPhaseEditor(clipId: string, phase: ClipAuthoringPhase): PhaseEditorRequest {
  const request: PhaseEditorRequest = { clipId, phase, requestId: ++counter };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<PhaseEditorRequest>(EVENT, { detail: request }));
  }
  requestWorkspaceSection("phase-editor-header");
  return request;
}

export function onPhaseEditorRequest(handler: (request: PhaseEditorRequest) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<PhaseEditorRequest>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
