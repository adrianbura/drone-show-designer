/**
 * GUIDED SHOW SETUP — PURE PRESENTATION PROJECTION.
 *
 * One ordered checklist that mirrors the industry authoring order (site ->
 * launch grid -> take-off -> formations -> storyboard -> transitions -> landing
 * -> safety -> lights -> export).
 *
 * It recomputes NOTHING: every fact is read from the canonical project document
 * and from `ShowReadinessModel` (which itself only reads the full-show report and
 * the single export gate). It mutates nothing, creates no history and never
 * claims a show is safe to fly.
 */
import type { ShowReadinessModel } from "@/lib/adapters/showReadiness";
import { clipPhase } from "@/lib/show/types";
import type { ShowProject } from "@/lib/show/types";

export type SetupStepId =
  | "SITE"
  | "LAUNCH"
  | "TAKEOFF"
  | "FORMATIONS"
  | "STORYBOARD"
  | "TRANSITIONS"
  | "LANDING"
  | "SAFETY"
  | "LIGHTS"
  | "EXPORT";

export type SetupStepState = "OK" | "WARNING" | "BLOCKED" | "TODO";

/** UI intents only — each is routed to the ONE panel that already owns the work. */
export type SetupActionId =
  | "CONFIGURE_SITE"
  | "CONFIGURE_LAUNCH"
  | "ADD_VISUAL"
  | "EDIT_CLIP"
  | "ADD_TAKEOFF"
  | "ADD_LANDING"
  | "EDIT_TRANSITION"
  | "EDIT_LIGHTING"
  | "ANALYZE_FULL_SHOW"
  | "OPEN_BLOCKING_ISSUES"
  | "OPEN_EXPORT";

export interface SetupStep {
  readonly id: SetupStepId;
  /** 1-based position in the guided order. */
  readonly index: number;
  readonly label: string;
  readonly state: SetupStepState;
  readonly detail: string;
  readonly action: { readonly id: SetupActionId; readonly label: string } | null;
}

export interface ShowSetupModel {
  readonly steps: readonly SetupStep[];
  readonly doneCount: number;
  readonly totalCount: number;
  /** First step that is not OK — the one thing to do next. */
  readonly nextStep: SetupStep | null;
  readonly headline: string;
}

export interface ShowSetupInput {
  readonly project: ShowProject;
  readonly readiness: ShowReadinessModel;
  readonly hasFlightSite: boolean;
}

function phaseCount(project: ShowProject, phase: "TAKEOFF" | "SHOW" | "LANDING"): number {
  return project.timeline.filter((c) => clipPhase(c) === phase).length;
}

export function buildShowSetup(input: ShowSetupInput): ShowSetupModel {
  const { project, readiness, hasFlightSite } = input;

  const takeoffClips = phaseCount(project, "TAKEOFF");
  const showClips = phaseCount(project, "SHOW");
  const landingClips = phaseCount(project, "LANDING");
  const showTimeline = project.timeline.filter((c) => clipPhase(c) === "SHOW");
  const withoutTransition = showTimeline.filter((c) => c.transition <= 0).length;
  const lightingEffects = project.lighting?.effects.length ?? 0;
  const launchEnabled = project.preShow?.enabled === true;

  const item = (id: string) => readiness.items.find((i) => i.id === id) ?? null;
  const analysis = item("ANALYSIS");
  const trajectory = item("TRAJECTORY");
  const geofence = item("GEOFENCE");
  const handoff = item("HANDOFF");

  const safetyState: SetupStepState =
    trajectory?.state === "BLOCKED" || geofence?.state === "BLOCKED"
      ? "BLOCKED"
      : analysis?.state === "BLOCKED" || analysis?.state === "TODO"
        ? "TODO"
        : geofence?.state === "WARNING"
          ? "WARNING"
          : "OK";

  const steps: SetupStep[] = [
    {
      id: "SITE",
      index: 1,
      label: "Flight site and perimeter",
      state: hasFlightSite ? "OK" : "TODO",
      detail: hasFlightSite
        ? "Take-off coordinates, authorised perimeter and ceiling are authored."
        : "Without a site the authorised area cannot be checked at all.",
      action: hasFlightSite ? null : { id: "CONFIGURE_SITE", label: "Configure site" },
    },
    {
      id: "LAUNCH",
      index: 2,
      label: "Launch grid",
      state: launchEnabled ? "OK" : "TODO",
      detail: launchEnabled
        ? "Ground positions, spacing and launch groups are configured."
        : "No launch grid yet: the drones have no authored ground positions.",
      action: {
        id: "CONFIGURE_LAUNCH",
        label: launchEnabled ? "Review launch grid" : "Set up launch grid",
      },
    },
    {
      id: "TAKEOFF",
      index: 3,
      label: "Take-off",
      state: takeoffClips > 0 ? "OK" : "TODO",
      detail:
        takeoffClips > 0
          ? `${takeoffClips} take-off segment(s) on the timeline.`
          : "The show has no take-off segment yet.",
      action: takeoffClips > 0 ? null : { id: "ADD_TAKEOFF", label: "Add take-off" },
    },
    {
      id: "FORMATIONS",
      index: 4,
      label: "Formations",
      state: project.formations.length > 0 ? "OK" : "TODO",
      detail:
        project.formations.length > 0
          ? `${project.formations.length} formation(s) available.`
          : "Create the shapes the drones should fly.",
      action:
        project.formations.length > 0 ? null : { id: "ADD_VISUAL", label: "Create a formation" },
    },
    {
      id: "STORYBOARD",
      index: 5,
      label: "Storyboard",
      state: showClips > 0 ? "OK" : "TODO",
      detail:
        showClips > 0
          ? `${showClips} show segment(s) scheduled.`
          : "Place formations on the timeline in the order they should appear.",
      action: showClips > 0 ? null : { id: "ADD_VISUAL", label: "Add a show segment" },
    },
    {
      id: "TRANSITIONS",
      index: 6,
      label: "Transitions",
      state: showClips === 0 ? "TODO" : withoutTransition > 0 ? "WARNING" : "OK",
      detail:
        showClips === 0
          ? "Transitions exist once the storyboard has show segments."
          : withoutTransition > 0
            ? `${withoutTransition} show segment(s) have no transition time — the drones would have to jump.`
            : "Every show segment has authored transition time.",
      action:
        showClips === 0
          ? null
          : {
              id: "EDIT_TRANSITION",
              label: withoutTransition > 0 ? "Fix transitions" : "Review transitions",
            },
    },
    {
      id: "LANDING",
      index: 7,
      label: "Landing",
      state: landingClips > 0 ? "OK" : "TODO",
      detail:
        landingClips > 0
          ? `${landingClips} landing segment(s) on the timeline.`
          : "The show does not bring the drones back down yet.",
      action: landingClips > 0 ? null : { id: "ADD_LANDING", label: "Add landing" },
    },
    {
      id: "SAFETY",
      index: 8,
      label: "Safety check",
      state: safetyState,
      detail:
        safetyState === "BLOCKED"
          ? ((trajectory?.state === "BLOCKED" ? trajectory.detail : geofence?.detail) ??
            "Blocking findings remain.")
          : safetyState === "TODO"
            ? (analysis?.detail ?? "Run the full-show analysis.")
            : safetyState === "WARNING"
              ? (geofence?.detail ?? "Warnings recorded.")
              : "Full-show analysis is fresh with no blocking finding. This does not authorise a flight.",
      action:
        safetyState === "BLOCKED"
          ? { id: "OPEN_BLOCKING_ISSUES", label: "Open blocking issues" }
          : safetyState === "TODO"
            ? { id: "ANALYZE_FULL_SHOW", label: "Analyze full show" }
            : null,
    },
    {
      id: "LIGHTS",
      index: 9,
      label: "Lights",
      state: lightingEffects > 0 ? "OK" : "TODO",
      detail:
        lightingEffects > 0
          ? `${lightingEffects} lighting effect(s) authored.`
          : "Colours and light effects are not authored yet.",
      action: { id: "EDIT_LIGHTING", label: lightingEffects > 0 ? "Review lights" : "Add lights" },
    },
    {
      id: "EXPORT",
      index: 10,
      label: "Export",
      state:
        handoff?.state === "OK"
          ? "OK"
          : handoff?.state === "WARNING"
            ? "WARNING"
            : handoff?.state === "BLOCKED"
              ? "BLOCKED"
              : "TODO",
      detail: handoff?.detail ?? "Export opens after a fresh full-show analysis.",
      action: { id: "OPEN_EXPORT", label: "Open export" },
    },
  ];

  const doneCount = steps.filter((s) => s.state === "OK").length;
  const nextStep = steps.find((s) => s.state !== "OK") ?? null;
  const headline = nextStep
    ? `Step ${nextStep.index} of ${steps.length} — ${nextStep.label}`
    : "Every guided step is complete. This does not authorise a flight.";

  return { steps, doneCount, totalCount: steps.length, nextStep, headline };
}
