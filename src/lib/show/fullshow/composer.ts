/**
 * FULL SHOW COMPOSER — timeline -> single continuous plan -> ONE canonical
 * TrajectorySet covering the whole show, TAKEOFF through LANDING.
 *
 * There is no per-clip trajectory format and no second sampling path: the
 * composer sequences the existing planner output and samples it once. Whatever
 * the viewport plays and the exporter writes is exactly this set.
 */
import { ASSIGNMENT_ALGORITHM_VERSION, type AssignmentStrategyId } from "../assignment";
import { CONFLICT_DETECTION_VERSION } from "../conflicts";
import { buildShowPlan } from "../trajectory/schedule";
import { sampleTrajectorySet, DEFAULT_SAMPLE_RATE } from "../trajectory/sampler";
import { TRANSITION_OPTIMIZER_VERSION } from "../transition/types";
import {
  clipPhase,
  showDuration,
  FORMATION_ALGORITHM_VERSION,
  SCHEMA_VERSION,
  TRAJECTORY_ALGORITHM_VERSION,
  type ShowPhase,
  type ShowProject,
} from "../types";
import { computeAnalysisRevision, showPackageId } from "./revision";
import {
  FULL_SHOW_ENGINE_VERSION,
  FullShowError,
  type ComposeFullShowOptions,
  type FullShowAlgorithmVersions,
  type FullShowIssue,
  type FullShowPlan,
  type PhaseWindow,
  type ShowHold,
  type ShowSegment,
  type ShowTransition,
  type TransitionStatus,
} from "./types";

/** Bytes per stored sample: t + 4 vec3 + yaw + yawRate, plus object overhead. */
const APPROX_BYTES_PER_SAMPLE = 260;

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function versions(): FullShowAlgorithmVersions {
  return {
    schema: SCHEMA_VERSION,
    fullShowEngine: FULL_SHOW_ENGINE_VERSION,
    trajectory: TRAJECTORY_ALGORITHM_VERSION,
    formation: FORMATION_ALGORITHM_VERSION,
    assignment: ASSIGNMENT_ALGORITHM_VERSION,
    optimizer: TRANSITION_OPTIMIZER_VERSION,
    conflictDetection: CONFLICT_DETECTION_VERSION,
  };
}

export function composeFullShow(
  project: ShowProject,
  options: ComposeFullShowOptions = {},
): FullShowPlan {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const assignmentStrategy: AssignmentStrategyId = options.assignmentStrategy ?? "nearestNeighbor";
  const overrides = options.transitionOverrides ?? {};
  const analyzed = new Set(options.analyzedClipIds ?? []);
  const unresolved = new Set(options.unresolvedClipIds ?? []);
  const errors: FullShowError[] = [];
  const warnings: FullShowIssue[] = [];

  const t0 = nowMs();
  const showPlan = buildShowPlan(project, { assignmentStrategy, transitionOverrides: overrides });
  const composeMs = nowMs() - t0;

  for (const err of showPlan.errors) {
    errors.push(
      new FullShowError("TRAJECTORY_COMPOSITION_FAILED", err.message, {
        clipId: err.details["clipId"] as string | undefined,
        droneId: err.droneId,
        code: err.code,
      }),
    );
  }

  const t1 = nowMs();
  const duration = Math.max(showDuration(project), 0);
  const trajectorySet = sampleTrajectorySet(showPlan, { sampleRate, duration });
  const samplingMs = nowMs() - t1;

  // Segments come from the planner itself (drone 0 carries the canonical time
  // layout) so the report can never disagree with the flown schedule.
  const clips = [...project.timeline].sort((a, b) => a.start - b.start);
  const clipById = new Map(clips.map((c) => [c.id, c] as const));
  const segments: ShowSegment[] = (showPlan.schedules[0]?.segments ?? []).map((seg) => ({
    clipId: seg.clipId,
    phase: seg.phase,
    kind: seg.kind,
    start: seg.start,
    end: seg.end,
    formationId: clipById.get(seg.clipId)?.formationId ?? null,
  }));

  const holds: ShowHold[] = segments
    .filter((s) => s.kind === "hold")
    .map((s) => ({ clipId: s.clipId, phase: s.phase, start: s.start, end: s.end }));

  const transitions: ShowTransition[] = clips.map((clip) => {
    const phase = clipPhase(clip);
    const formation = project.formations.find((f) => f.id === clip.formationId);
    const status: TransitionStatus = overrides[clip.id]
      ? unresolved.has(clip.id)
        ? "unresolved"
        : "optimized"
      : unresolved.has(clip.id)
        ? "unresolved"
        : analyzed.has(clip.id)
          ? "analyzed"
          : "notAnalyzed";
    return {
      clipId: clip.id,
      phase,
      formationId: clip.formationId,
      formationName: formation?.name ?? (phase === "LANDING" ? "Home pads" : null),
      start: clip.start,
      transition: clip.transition,
      hold: clip.hold,
      end: clip.start + clip.transition + clip.hold,
      status,
      assignmentStrategy:
        showPlan.assignments.find((a) => a.clipId === clip.id)?.strategy ?? assignmentStrategy,
    };
  });

  const phases: PhaseWindow[] = [];
  for (const clip of clips) {
    const phase: ShowPhase = clipPhase(clip);
    const end = clip.start + clip.transition + clip.hold;
    const last = phases[phases.length - 1];
    if (last && last.phase === phase) {
      phases[phases.length - 1] = {
        phase,
        start: last.start,
        end: Math.max(last.end, end),
        clipIds: [...last.clipIds, clip.id],
      };
    } else {
      phases.push({ phase, start: clip.start, end, clipIds: [clip.id] });
    }
  }

  if (duration <= 0) {
    errors.push(
      new FullShowError("INVALID_TIMELINE", "The show has zero duration: nothing to compose."),
    );
  }

  const sampleCount = trajectorySet.drones.reduce((n, d) => n + d.samples.length, 0);

  const revision = computeAnalysisRevision(project, {
    sampleRate,
    assignmentStrategy,
    transitionOverrides: overrides,
  });

  return {
    projectId: project.id,
    droneCount: project.droneCount,
    duration,
    sampleRate,
    drones: showPlan.drones,
    phases,
    segments,
    transitions,
    holds,
    trajectorySet,
    showPlan,
    metadata: {
      generatedAt: Date.now(),
      analysisRevision: revision,
      showPackageId: showPackageId(revision, FULL_SHOW_ENGINE_VERSION),
      assignmentStrategy,
      overriddenClipIds: Object.keys(overrides).sort(),
      compositionMs: composeMs,
      samplingMs,
      trajectoryMemoryEstimateBytes: sampleCount * APPROX_BYTES_PER_SAMPLE,
    },
    algorithmVersions: versions(),
    errors,
    warnings,
  };
}

/** Timeline context (clip + phase) for an absolute show time. */
export function segmentAt(plan: FullShowPlan, t: number): ShowSegment | null {
  for (const seg of plan.segments) {
    if (t >= seg.start - 1e-9 && t <= seg.end + 1e-9) return seg;
  }
  return null;
}

export function describeSegment(seg: ShowSegment | null): string {
  if (!seg) return "outside the show timeline";
  return `${seg.phase} ${seg.kind} of clip ${seg.clipId}`;
}
