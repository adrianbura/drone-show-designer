/**
 * VISUAL STATE CUE SAFETY — presentation-level projection of the CANONICAL
 * full-show validation report onto saved-state cues.
 *
 * There is NO safety maths here: velocity, acceleration and separation values
 * are read verbatim from `FullShowIssue` records produced by the one canonical
 * validator (`analyzeFullShow`). This module only decides WHICH canonical issues
 * belong to WHICH cue transition window, and how to label that for an operator.
 *
 * A cue's absolute transition window is:
 *   clip.start + clip.transition + cue.time - cue.transitionDuration
 *   .. clip.start + clip.transition + cue.time
 */
import type { FullShowIssue, FullShowValidationReport } from "@/lib/show/fullshow/types";
import type { SceneVisualStateCue } from "@/lib/show/scene/types";
import type { TimelineClip } from "@/lib/show/types";


export type VisualStateCueSafetyStatus = "SAFE" | "WARNING" | "BLOCKED" | "NEEDS_CHECK";

export interface VisualStateCueSafety {
  readonly cueId: string;
  readonly status: VisualStateCueSafetyStatus;
  /** Absolute show-time window of the cue transition. */
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly errors: readonly FullShowIssue[];
  readonly warnings: readonly FullShowIssue[];
  /** Canonical reported extremes inside the window, when the report has them. */
  readonly maxVelocity: number | null;
  readonly maxAcceleration: number | null;
  readonly minSeparation: number | null;
  /** Operator guidance. Never applied automatically. */
  readonly guidance: string | null;
}

export const VISUAL_STATE_CUE_SAFETY_LABEL: Record<VisualStateCueSafetyStatus, string> = {
  SAFE: "Safe",
  WARNING: "Warning",
  BLOCKED: "Blocked",
  NEEDS_CHECK: "Needs check",
};

const EPS = 1e-6;

/** Matches an issue to the cue window: same clip and time inside the window. */
function matches(issue: FullShowIssue, clipId: string, start: number, end: number): boolean {
  if (issue.clipId !== clipId) return false;
  if (typeof issue.time !== "number") return false;
  return issue.time >= start - EPS && issue.time <= end + EPS;
}

function extreme(issues: readonly FullShowIssue[], code: string): number | null {
  let best: number | null = null;
  for (const issue of issues) {
    if (issue.code !== code) continue;
    if (typeof issue.value !== "number" || !Number.isFinite(issue.value)) continue;
    best = best === null ? issue.value : Math.max(best, issue.value);
  }
  return best;
}

function minimum(issues: readonly FullShowIssue[], code: string): number | null {
  let best: number | null = null;
  for (const issue of issues) {
    if (issue.code !== code) continue;
    if (typeof issue.value !== "number" || !Number.isFinite(issue.value)) continue;
    best = best === null ? issue.value : Math.min(best, issue.value);
  }
  return best;
}

export interface VisualStateCueSafetyInput {
  readonly report: FullShowValidationReport | null;
  readonly stale: boolean;
  readonly clip: TimelineClip | null;
  readonly cues: readonly SceneVisualStateCue[];
}

/** One projection per cue. Never mutates and never re-simulates anything. */
export function deriveVisualStateCueSafety(
  input: VisualStateCueSafetyInput,
): ReadonlyMap<string, VisualStateCueSafety> {
  const map = new Map<string, VisualStateCueSafety>();
  const { report, stale, clip, cues } = input;
  if (!clip) return map;
  const formationReady = clip.start + clip.transition;
  const fresh = !!report && !stale;

  for (const cue of cues) {
    const windowEnd = formationReady + cue.time;
    const windowStart = windowEnd - Math.max(0, cue.transitionDuration);
    if (!fresh) {
      map.set(cue.id, {
        cueId: cue.id,
        status: "NEEDS_CHECK",
        windowStart,
        windowEnd,
        errors: [],
        warnings: [],
        maxVelocity: null,
        maxAcceleration: null,
        minSeparation: null,
        guidance: null,
      });
      continue;
    }
    const relevant = report!.issues.filter((issue) =>
      matches(issue, clip.id, windowStart, windowEnd),
    );
    const errors = relevant.filter((issue) => issue.severity === "error");
    const warnings = relevant.filter((issue) => issue.severity === "warning");
    const maxVelocity = extreme(relevant, "VELOCITY");
    const maxAcceleration = extreme(relevant, "ACCELERATION");
    const minSeparation = minimum(relevant, "PROXIMITY");
    const kinematic = relevant.some(
      (issue) => issue.code === "ACCELERATION" || issue.code === "VELOCITY",
    );
    map.set(cue.id, {
      cueId: cue.id,
      status: errors.length > 0 ? "BLOCKED" : warnings.length > 0 ? "WARNING" : "SAFE",
      windowStart,
      windowEnd,
      errors,
      warnings,
      maxVelocity,
      maxAcceleration,
      minSeparation,
      guidance: kinematic
        ? "Increase the transition duration so the drones have more time to reach the saved state."
        : null,
    });
  }
  return map;
}
