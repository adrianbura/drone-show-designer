/**
 * TRANSITION DESIGN — designer intent translated into the EXISTING override.
 *
 * These tests pin the contract that makes the designer-facing modes safe:
 * the canonical assignment is never re-derived, offsets come from the canonical
 * source geometry of the analysis, clamping follows the scheduler bound, and the
 * authored design round-trips through the project planning schema without
 * changing the flown trajectory.
 */
import { describe, expect, it } from "vitest";

import { createDemoProject } from "@/lib/show/defaultProject";
import {
  analyzeTransition,
  buildDesignOverride,
  DEFAULT_TRANSITION_DESIGN,
  departureGroups,
  describeTransitionDesign,
  deriveTransitionMode,
  normalizeTransitionDesign,
  staggerStartOffsets,
  transitionInputForClip,
  type TransitionDesignState,
} from "@/lib/show/transition";
import { buildShowPlan } from "@/lib/show/trajectory/schedule";
import { sampleTrajectorySet } from "@/lib/show/trajectory/sampler";
import { clipPhase } from "@/lib/show/types";
import {
  computeOverrideBasis,
  pruneTransitionOverrides,
} from "@/lib/studio/planningIntegrity";
import { migratePlanningState, serializeProject } from "@/lib/project/serialize";

const project = createDemoProject(24);
const plan = buildShowPlan(project, { assignmentStrategy: "optimalDistance" });
const showClip = project.timeline.find((c) => clipPhase(c) === "SHOW" && c.transition > 0)!;

function analysisFor(duration?: number) {
  const input = transitionInputForClip(project, plan, showClip.id, {
    strategy: "optimalDistance",
    sampleRate: 25,
    ...(duration !== undefined ? { duration } : {}),
  });
  return { input, analysis: analyzeTransition(input) };
}

function design(patch: Partial<TransitionDesignState>): TransitionDesignState {
  return normalizeTransitionDesign({ ...DEFAULT_TRANSITION_DESIGN, ...patch });
}

describe("transition design modes", () => {
  it("AUTO authors no override (planner baseline is untouched)", () => {
    const { analysis, input } = analysisFor();
    expect(buildDesignOverride(analysis, design({ mode: "AUTO" }), input.duration)).toBeNull();
  });

  it("MANUAL never fabricates offsets — it edits existing override data", () => {
    const { analysis, input } = analysisFor();
    expect(buildDesignOverride(analysis, design({ mode: "MANUAL" }), input.duration)).toBeNull();
  });

  it("SYNCHRONIZED gives common starts and preserves canonical assignment", () => {
    const { analysis, input } = analysisFor();
    const override = buildDesignOverride(analysis, design({ mode: "SYNCHRONIZED" }), input.duration)!;
    expect(override.startOffsets.every((v) => v === 0)).toBe(true);
    expect(override.laneOffsets.every((v) => v === 0)).toBe(true);
    expect(override.targetPointIndex).toEqual(analysis.dronePlans.map((p) => p.targetPointIndex));
  });

  it("L→R stagger is monotonic in canonical world X and R→L reverses it", () => {
    const { analysis, input } = analysisFor();
    const from = analysis.dronePlans.map((p) => p.from);
    const lr = staggerStartOffsets(from, "LEFT_RIGHT", 3, input.duration);
    const rl = staggerStartOffsets(from, "RIGHT_LEFT", 3, input.duration);

    const byX = from
      .map((p, i) => ({ x: p[0], i }))
      .sort((a, b) => a.x - b.x || a.i - b.i);
    for (let k = 1; k < byX.length; k++) {
      expect(lr[byX[k]!.i]!).toBeGreaterThanOrEqual(lr[byX[k - 1]!.i]! - 1e-9);
      expect(rl[byX[k]!.i]!).toBeLessThanOrEqual(rl[byX[k - 1]!.i]! + 1e-9);
    }
    const cap = Math.min(3, input.duration * 0.5);
    expect(Math.max(...lr)).toBeCloseTo(cap, 6);
    expect(Math.max(...rl)).toBeCloseTo(cap, 6);
  });

  it("FRONT→BACK / BACK→FRONT rank on world Z", () => {
    const from = analysisFor().analysis.dronePlans.map((p) => p.from);
    const fb = staggerStartOffsets(from, "FRONT_BACK", 2, 10);
    const bf = staggerStartOffsets(from, "BACK_FRONT", 2, 10);
    const byZ = from.map((p, i) => ({ z: p[2], i })).sort((a, b) => a.z - b.z || a.i - b.i);
    for (let k = 1; k < byZ.length; k++) {
      expect(fb[byZ[k]!.i]!).toBeGreaterThanOrEqual(fb[byZ[k - 1]!.i]! - 1e-9);
      expect(bf[byZ[k]!.i]!).toBeLessThanOrEqual(bf[byZ[k - 1]!.i]! + 1e-9);
    }
  });

  it("CENTER→OUT is deterministic and the inverse ranking of OUTSIDE→IN", () => {
    const from = analysisFor().analysis.dronePlans.map((p) => p.from);
    const a = staggerStartOffsets(from, "CENTER_OUT", 2, 10);
    const b = staggerStartOffsets(from, "CENTER_OUT", 2, 10);
    expect(a).toEqual(b);
    const inward = staggerStartOffsets(from, "OUTSIDE_IN", 2, 10);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]! + inward[i]!).toBeCloseTo(2, 4);
    }
  });

  it("total stagger is clamped to half the transition duration", () => {
    const from = analysisFor().analysis.dronePlans.map((p) => p.from);
    const offsets = staggerStartOffsets(from, "LEFT_RIGHT", 10, 4);
    expect(Math.max(...offsets)).toBeCloseTo(2, 6);
    expect(Math.min(...offsets)).toBe(0);
    expect(staggerStartOffsets(from, "LEFT_RIGHT", 3, 0)).toEqual(from.map(() => 0));
  });

  it("summary and derived mode read the same data the planner flies", () => {
    expect(describeTransitionDesign(design({ mode: "STAGGERED", totalStagger: 3 }))).toBe(
      "STAGGER 3.0s L→R",
    );
    expect(describeTransitionDesign(design({ mode: "SYNCHRONIZED" }))).toBe("SYNC");
    expect(deriveTransitionMode(undefined)).toBe("AUTO");

    const { analysis, input } = analysisFor();
    const sync = buildDesignOverride(analysis, design({ mode: "SYNCHRONIZED" }), input.duration)!;
    expect(deriveTransitionMode(sync)).toBe("SYNCHRONIZED");
    const staggered = buildDesignOverride(
      analysis,
      design({ mode: "STAGGERED", totalStagger: 2 }),
      input.duration,
    )!;
    expect(deriveTransitionMode(staggered)).toBe("MANUAL");
    const groups = departureGroups(staggered.startOffsets);
    expect(groups.early + groups.middle + groups.late).toBe(project.droneCount);
    expect(groups.maxOffset).toBeGreaterThan(0);
  });

  it("normalisation rejects unknown/unsafe payloads deterministically", () => {
    expect(normalizeTransitionDesign({ mode: "NOPE", totalStagger: 1e9 })).toEqual({
      mode: "AUTO",
      pattern: "LEFT_RIGHT",
      totalStagger: 10,
      distribution: "linear",
    });
  });
});

describe("transition design invalidation", () => {
  const { analysis, input } = analysisFor();
  const override = buildDesignOverride(
    analysis,
    design({ mode: "STAGGERED", totalStagger: 2 }),
    input.duration,
  )!;
  const overrides = { [showClip.id]: override };
  const basis = computeOverrideBasis(project, overrides);

  it("hold-only edits keep the authored transition", () => {
    const next = {
      ...project,
      timeline: project.timeline.map((c) =>
        c.id === showClip.id ? { ...c, hold: c.hold + 3 } : c,
      ),
    };
    const pruned = pruneTransitionOverrides(next, overrides, basis);
    expect(pruned.invalidated).toEqual([]);
    expect(pruned.overrides[showClip.id]).toEqual(override);
  });

  it("geometry changes invalidate the authored transition", () => {
    const next = {
      ...project,
      formations: project.formations.map((f) =>
        f.id === showClip.formationId
          ? { ...f, points: f.points.map((p) => [p[0] + 7, p[1], p[2]] as [number, number, number]) }
          : f,
      ),
    };
    const pruned = pruneTransitionOverrides(next, overrides, basis);
    expect(pruned.invalidated).toEqual([showClip.id]);
    expect(pruned.overrides[showClip.id]).toBeUndefined();
  });
});

describe("transition design persistence", () => {
  const { analysis, input } = analysisFor();
  const designed = design({ mode: "STAGGERED", totalStagger: 2.5, pattern: "FRONT_BACK" });
  const override = buildDesignOverride(analysis, designed, input.duration)!;

  it("round-trips through the planning schema with identical trajectories", () => {
    const file = serializeProject(project, {
      planning: {
        assignmentStrategy: "optimalDistance",
        transitionOverrides: { [showClip.id]: override },
        transitionDesigns: { [showClip.id]: designed },
      },
    });
    const reopened = migratePlanningState(JSON.parse(JSON.stringify(file)).planning, { project });
    expect(reopened.transitionDesigns?.[showClip.id]).toEqual(designed);
    expect(reopened.transitionOverrides[showClip.id]).toEqual(override);

    const before = sampleTrajectorySet(
      buildShowPlan(project, {
        assignmentStrategy: "optimalDistance",
        transitionOverrides: { [showClip.id]: override },
      }),
      { sampleRate: 25 },
    );
    const after = sampleTrajectorySet(
      buildShowPlan(project, {
        assignmentStrategy: reopened.assignmentStrategy,
        transitionOverrides: reopened.transitionOverrides,
      }),
      { sampleRate: 25 },
    );
    expect(after.drones).toEqual(before.drones);
  });

  it("legacy planning sections without designs open deterministically", () => {
    const legacy = migratePlanningState({
      assignmentStrategy: "optimalDistance",
      transitionOverrides: {},
    });
    expect(legacy.transitionDesigns).toEqual({});
    expect(migratePlanningState(undefined).transitionDesigns).toEqual({});
  });
});
