/**
 * SHOW-WIDE TRANSITION DESIGN — one design over the whole timeline.
 *
 * Pins that the bulk path reuses the per-clip translation authority exactly
 * (identical overrides), reports ineligible clips instead of skipping silently,
 * and produces trajectories the canonical scheduler accepts.
 */
import { describe, expect, it } from "vitest";

import { createDemoProject } from "@/lib/show/defaultProject";
import {
  analyzeTransition,
  applyTransitionDesignToShow,
  buildDesignOverride,
  DEFAULT_TRANSITION_DESIGN,
  describeBulkTransitionResult,
  normalizeTransitionDesign,
  transitionInputForClip,
} from "@/lib/show/transition";
import { buildShowPlan } from "@/lib/show/trajectory/schedule";
import { clipPhase } from "@/lib/show/types";

const project = createDemoProject(24);
const plan = buildShowPlan(project, { assignmentStrategy: "optimalDistance" });
const options = { strategy: "optimalDistance", sampleRate: 25 } as const;

const staggered = normalizeTransitionDesign({
  ...DEFAULT_TRANSITION_DESIGN,
  mode: "STAGGERED",
  pattern: "LEFT_RIGHT",
  totalStagger: 2,
});

describe("applyTransitionDesignToShow", () => {
  it("covers every timeline clip exactly once", () => {
    const result = applyTransitionDesignToShow(project, plan, staggered, options);
    expect(result.outcomes).toHaveLength(project.timeline.length);
    expect(new Set(result.outcomes.map((o) => o.clipId)).size).toBe(project.timeline.length);
  });

  it("applies the stagger to at least one SHOW clip and reports the rest", () => {
    const result = applyTransitionDesignToShow(project, plan, staggered, options);
    expect(result.appliedCount).toBeGreaterThan(0);
    expect(
      result.appliedCount + result.clearedCount + result.skippedCount + result.failedCount,
    ).toBe(project.timeline.length);
    expect(result.failedCount).toBe(0);
    for (const outcome of result.outcomes) {
      if (outcome.status !== "skipped") continue;
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
    // TAKEOFF / LANDING keep their dedicated planners.
    const takeoff = project.timeline.find((c) => clipPhase(c) === "TAKEOFF");
    if (takeoff) {
      expect(result.outcomes.find((o) => o.clipId === takeoff.id)?.status).toBe("skipped");
    }
  });

  it("produces byte-identical overrides to the per-clip designer", () => {
    const result = applyTransitionDesignToShow(project, plan, staggered, options);
    for (const clipId of result.appliedClipIds) {
      const input = transitionInputForClip(project, plan, clipId, options);
      const expected = buildDesignOverride(analyzeTransition(input), staggered, input.duration);
      expect(result.overrides[clipId]).toEqual(expected);
    }
  });

  it("is deterministic for identical input", () => {
    const a = applyTransitionDesignToShow(project, plan, staggered, options);
    const b = applyTransitionDesignToShow(project, plan, staggered, options);
    expect(b.overrides).toEqual(a.overrides);
  });

  it("AUTO clears eligible clips instead of authoring offsets", () => {
    const result = applyTransitionDesignToShow(
      project,
      plan,
      normalizeTransitionDesign({ ...DEFAULT_TRANSITION_DESIGN, mode: "AUTO" }),
      options,
    );
    expect(Object.keys(result.overrides)).toHaveLength(0);
    expect(result.clearedCount).toBeGreaterThan(0);
  });

  it("refuses MANUAL as a show-wide pattern", () => {
    const result = applyTransitionDesignToShow(
      project,
      plan,
      normalizeTransitionDesign({ ...DEFAULT_TRANSITION_DESIGN, mode: "MANUAL" }),
      options,
    );
    expect(result.appliedCount).toBe(0);
    expect(result.skippedCount).toBe(project.timeline.length);
  });

  it("staggered overrides stay inside the scheduler bound", () => {
    const result = applyTransitionDesignToShow(project, plan, staggered, options);
    for (const clipId of result.appliedClipIds) {
      const clip = project.timeline.find((c) => c.id === clipId)!;
      const cap = clip.transition * 0.5 + 1e-9;
      for (const offset of result.overrides[clipId]!.startOffsets) {
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("the scheduler accepts the bulk overrides", () => {
    const result = applyTransitionDesignToShow(project, plan, staggered, options);
    const replanned = buildShowPlan(project, {
      assignmentStrategy: "optimalDistance",
      transitionOverrides: result.overrides,
    });
    expect(replanned.drones).toHaveLength(plan.drones.length);
  });

  it("summarises the outcome for the operator", () => {
    const result = applyTransitionDesignToShow(project, plan, staggered, options);
    expect(describeBulkTransitionResult(result)).toContain("applied");
  });
});
