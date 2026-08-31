/**
 * SHOW-WIDE TRANSITION DESIGN APPLICATION.
 *
 * Authoring one clip at a time is not viable for a real show with dozens of
 * transitions, so this module applies ONE design to every eligible clip.
 *
 * It adds no planner and no parallel offset storage: for each eligible clip it
 * reuses the canonical `transitionInputForClip` + `analyzeTransition` +
 * `buildDesignOverride` chain, i.e. exactly what the per-clip designer does.
 * Ineligible clips (TAKEOFF/LANDING, partial-fleet participation, non-permutable
 * targets) are reported, never silently skipped.
 */
import type { ShowPlan, ClipTransitionOverride } from "../trajectory/schedule";
import type { ShowProject } from "../types";
import type { AssignmentStrategyId } from "../assignment";
import { analyzeTransition } from "./optimizer";
import { buildDesignOverride, type TransitionDesignState } from "./design";
import { transitionInputForClip, clipOptimizabilityReason } from "./project";
import { DEFAULT_OPTIMIZATION_SETTINGS } from "./types";
import { describeTransitionError } from "./types";

export interface BulkTransitionDesignOptions {
  readonly strategy: AssignmentStrategyId;
  readonly sampleRate?: number;
}

export type BulkClipOutcome =
  | { readonly clipId: string; readonly status: "applied"; readonly override: ClipTransitionOverride }
  /** AUTO / SYNCHRONIZED with no derivable override: authored design, no offsets. */
  | { readonly clipId: string; readonly status: "cleared" }
  | { readonly clipId: string; readonly status: "skipped"; readonly reason: string }
  | { readonly clipId: string; readonly status: "failed"; readonly reason: string };

export interface BulkTransitionDesignResult {
  readonly design: TransitionDesignState;
  readonly outcomes: readonly BulkClipOutcome[];
  readonly appliedClipIds: readonly string[];
  readonly overrides: Readonly<Record<string, ClipTransitionOverride>>;
  readonly appliedCount: number;
  readonly clearedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
}

/**
 * Deterministically computes the override for every timeline clip under one
 * design. Pure: reads a project + plan and returns data.
 *
 * MANUAL is not a bulk-applicable mode (it edits existing per-drone data), so
 * callers must reject it before calling; it is treated as "skipped" here.
 */
export function applyTransitionDesignToShow(
  project: ShowProject,
  plan: ShowPlan,
  design: TransitionDesignState,
  options: BulkTransitionDesignOptions,
): BulkTransitionDesignResult {
  const outcomes: BulkClipOutcome[] = [];
  const overrides: Record<string, ClipTransitionOverride> = {};

  for (const clip of project.timeline) {
    if (design.mode === "MANUAL") {
      outcomes.push({
        clipId: clip.id,
        status: "skipped",
        reason: "MANUAL is authored per drone and cannot be applied show-wide.",
      });
      continue;
    }
    const eligibility = clipOptimizabilityReason(project, clip.id, plan);
    if (!eligibility.optimizable) {
      outcomes.push({ clipId: clip.id, status: "skipped", reason: eligibility.message });
      continue;
    }
    if (design.mode === "AUTO") {
      outcomes.push({ clipId: clip.id, status: "cleared" });
      continue;
    }
    try {
      const input = transitionInputForClip(project, plan, clip.id, {
        strategy: options.strategy,
        ...(options.sampleRate !== undefined ? { sampleRate: options.sampleRate } : {}),
      });
      const analysis = analyzeTransition(input, DEFAULT_OPTIMIZATION_SETTINGS);
      const override = buildDesignOverride(analysis, design, input.duration);
      if (override) {
        overrides[clip.id] = override;
        outcomes.push({ clipId: clip.id, status: "applied", override });
      } else {
        outcomes.push({ clipId: clip.id, status: "cleared" });
      }
    } catch (err) {
      outcomes.push({
        clipId: clip.id,
        status: "failed",
        reason: describeTransitionError(err).message,
      });
    }
  }

  return {
    design,
    outcomes,
    appliedClipIds: outcomes.filter((o) => o.status === "applied").map((o) => o.clipId),
    overrides,
    appliedCount: outcomes.filter((o) => o.status === "applied").length,
    clearedCount: outcomes.filter((o) => o.status === "cleared").length,
    skippedCount: outcomes.filter((o) => o.status === "skipped").length,
    failedCount: outcomes.filter((o) => o.status === "failed").length,
  };
}

/** One-line operator summary, e.g. "12 applied · 3 skipped". */
export function describeBulkTransitionResult(result: BulkTransitionDesignResult): string {
  const parts: string[] = [];
  if (result.appliedCount) parts.push(`${result.appliedCount} applied`);
  if (result.clearedCount) parts.push(`${result.clearedCount} planner-owned`);
  if (result.skippedCount) parts.push(`${result.skippedCount} skipped`);
  if (result.failedCount) parts.push(`${result.failedCount} failed`);
  return parts.length ? parts.join(" · ") : "no clips";
}
