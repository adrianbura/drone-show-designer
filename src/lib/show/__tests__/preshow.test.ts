import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../defaultProject";
import { buildDroneDefinitions } from "../drones";
import { detectConflicts } from "../conflicts";
import { analyzeFullShow } from "../fullshow";
import { buildShowPlan, sampleTrajectorySet } from "../trajectory";
import {
  analyzePreShow,
  buildLaunchGroups,
  buildLaunchLayout,
  buildStagingLayout,
  compareGroupOrders,
  composePreShow,
  DEFAULT_PRE_SHOW,
  launchHomePositions,
  patchPreShowConfig,
  resolvePreShowConfig,
  rotateXZ,
  suggestGroupInterval,
  toShowTime,
  validatePreShow,
  type PreShowConfig,
} from "../preshow";
import type { ShowProject } from "../types";

function enabled(patch: Parameters<typeof patchPreShowConfig>[1] = {}): PreShowConfig {
  return patchPreShowConfig(DEFAULT_PRE_SHOW, { enabled: true, ...patch });
}

function projectWithPreShow(patch: Parameters<typeof patchPreShowConfig>[1] = {}): ShowProject {
  const project = createDefaultProject(24);
  return { ...project, preShow: enabled(patch) };
}

describe("launch grid", () => {
  it("produces exactly one pad per drone regardless of grid capacity", () => {
    for (const count of [1, 7, 23, 60, 200]) {
      const layout = buildLaunchLayout(count, DEFAULT_PRE_SHOW.launch);
      expect(layout.pads).toHaveLength(count);
      expect(new Set(layout.pads.map((p) => p.id)).size).toBe(count);
      expect(layout.pads.map((p) => p.index)).toEqual(Array.from({ length: count }, (_, i) => i));
    }
  });

  it("keeps every pad on the ground plane and reports spacing", () => {
    const layout = buildLaunchLayout(30, { ...DEFAULT_PRE_SHOW.launch, spacingX: 4, spacingZ: 5 });
    for (const pad of layout.pads) expect(pad.position[1]).toBe(0);
    expect(layout.minPadSpacing).toBeCloseTo(4, 6);
    expect(layout.duplicatePads).toHaveLength(0);
  });

  it("rotates the grid deterministically about +Y", () => {
    const [x, z] = rotateXZ(1, 0, 90);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(1, 6);
    const a = buildLaunchLayout(12, { ...DEFAULT_PRE_SHOW.launch, rotationDeg: 37 });
    const b = buildLaunchLayout(12, { ...DEFAULT_PRE_SHOW.launch, rotationDeg: 37 });
    expect(a.pads).toEqual(b.pads);
  });
});

describe("staging", () => {
  it("generates exactly N staging targets at the configured altitude", () => {
    const layout = buildLaunchLayout(24, DEFAULT_PRE_SHOW.launch);
    const staging = buildStagingLayout(24, DEFAULT_PRE_SHOW.staging, layout);
    expect(staging.targets).toHaveLength(24);
    for (const t of staging.targets) expect(t[1]).toBeCloseTo(DEFAULT_PRE_SHOW.staging.altitude, 6);
  });

  it("is deterministic for identical configuration", () => {
    const layout = buildLaunchLayout(31, DEFAULT_PRE_SHOW.launch);
    const a = buildStagingLayout(31, DEFAULT_PRE_SHOW.staging, layout);
    const b = buildStagingLayout(31, DEFAULT_PRE_SHOW.staging, layout);
    expect(a.targets).toEqual(b.targets);
  });
});

describe("launch groups", () => {
  it("partitions every drone exactly once", () => {
    const layout = buildLaunchLayout(37, DEFAULT_PRE_SHOW.launch);
    for (const strategy of ["ROWS", "COLUMNS", "BLOCKS"] as const) {
      const groups = buildLaunchGroups(layout, {
        ...DEFAULT_PRE_SHOW.grouping,
        strategy,
      });
      const seen = groups.flatMap((g) => g.droneIndices);
      expect(seen.slice().sort((a, b) => a - b)).toEqual(
        Array.from({ length: 37 }, (_, i) => i),
      );
      expect(new Set(seen).size).toBe(37);
    }
  });

  it("staggers group start times by the configured interval", () => {
    const layout = buildLaunchLayout(20, DEFAULT_PRE_SHOW.launch);
    const groups = buildLaunchGroups(layout, {
      ...DEFAULT_PRE_SHOW.grouping,
      groupIntervalSeconds: 3,
    });
    groups.forEach((g, i) => expect(g.startTime).toBeCloseTo(i * 3, 6));
  });
});

describe("pre-show composition", () => {
  it("starts every drone on its pad and ends at its staging target", () => {
    const project = projectWithPreShow();
    const config = resolvePreShowConfig(project.preShow);
    const drones = buildDroneDefinitions(
      project,
      launchHomePositions({ droneCount: project.droneCount, config, limits: project.limits }),
    );
    const composed = composePreShow(
      { droneCount: project.droneCount, config, limits: project.limits },
      drones,
    );
    expect(composed.plan.duration).toBeGreaterThan(0);
    expect(composed.schedules).toHaveLength(project.droneCount);
    composed.schedules.forEach((schedule, i) => {
      const first = schedule.segments[0]!;
      expect(first.start).toBeLessThanOrEqual(0);
      const target = composed.plan.targetByDrone[i]!;
      const last = schedule.segments[schedule.segments.length - 1]!;
      expect(last.end).toBeCloseTo(0, 6);
      expect(target[1]).toBeCloseTo(config.staging.altitude, 6);
    });
    expect(toShowTime(composed.plan, composed.plan.duration)).toBeCloseTo(0, 6);
  });

  it("keeps drones on the ground until their group start time", () => {
    const { plan, set } = analyzePreShow(projectWithPreShow({ grouping: { groupIntervalSeconds: 4 } }));
    const lateGroup = plan.groups[plan.groups.length - 1]!;
    const index = lateGroup.droneIndices[0]!;
    const showTimeOfLiftoff = lateGroup.startTime - plan.duration;
    const grounded = set.drones[index]!.samples.filter((s) => s.t < showTimeOfLiftoff - 0.2);
    expect(grounded.length).toBeGreaterThan(0);
    for (const s of grounded) expect(s.position[1]).toBeCloseTo(0, 3);
  });

  it("is deterministic: identical input produces identical samples", () => {
    const project = projectWithPreShow();
    const a = analyzePreShow(project, { sampleRate: 10 });
    const b = analyzePreShow(project, { sampleRate: 10 });
    expect(b.set.drones[0]!.samples).toEqual(a.set.drones[0]!.samples);
    // planningMs is wall-clock instrumentation, not part of the deterministic result.
    const { planningMs: _a, ...ma } = a.report.metrics;
    const { planningMs: _b, ...mb } = b.report.metrics;
    expect(mb).toEqual(ma);
  });
});

describe("pre-show validation", () => {
  it("reports a status, per-group metrics and an honest statement", () => {
    const { report, plan } = analyzePreShow(projectWithPreShow());
    expect(["VALID", "WARNING", "FAIL"]).toContain(report.status);
    expect(report.groupMetrics).toHaveLength(plan.groups.length);
    expect(report.statement).toMatch(/not an authorisation to launch/i);
    expect(report.metrics.droneCount).toBe(24);
    expect(report.launchGrid.padCount).toBe(24);
  });

  it("flags staging above the configured ceiling instead of clamping it", () => {
    const project = projectWithPreShow({ staging: { altitude: 500 } });
    const { report } = analyzePreShow(project);
    expect(report.status).toBe("FAIL");
    expect(report.errors.some((e) => e.code === "STAGING_ABOVE_CEILING")).toBe(true);
  });

  it("flags an ascent that is too fast for the configured velocity limit", () => {
    const project = projectWithPreShow({ ascentDuration: 0.5, transitDuration: 0.5 });
    const { report } = analyzePreShow(project);
    expect(report.errors.some((e) => e.code === "PRE_SHOW_VELOCITY")).toBe(true);
  });

  it("detects pre-show proximity conflicts through the shared detector", () => {
    const project = projectWithPreShow({ launch: { spacingX: 1, spacingZ: 1 } });
    const { plan, set } = analyzePreShow(project);
    const conflicts = detectConflicts(set, { minSeparation: project.limits.minSeparation });
    const report = validatePreShow({ project, plan, set, conflicts });
    expect(report.metrics.totalConflicts).toBe(
      conflicts.conflicts.filter((c) => c.timeOfClosestApproach <= 1e-9).length,
    );
    expect(report.launchGrid.minPadSpacing).toBeCloseTo(1, 6);
  });
});

describe("show integration", () => {
  it("extends the composed show into negative time without moving show time zero", () => {
    const project = projectWithPreShow();
    const plan = buildShowPlan(project);
    expect(plan.startTime).toBeLessThan(0);
    expect(plan.showStartOperationalTime).toBeCloseTo(-plan.startTime, 6);
    const set = sampleTrajectorySet(plan, {
      sampleRate: 10,
      startTime: plan.startTime,
      duration: plan.duration - plan.startTime,
    });
    const samples = set.drones[0]!.samples;
    expect(samples[0]!.t).toBeCloseTo(plan.startTime, 6);
    expect(samples.some((s) => Math.abs(s.t) < 1e-6)).toBe(true);
  });

  it("makes the launch pads the landing home positions", () => {
    const project = projectWithPreShow();
    const plan = buildShowPlan(project);
    const config = resolvePreShowConfig(project.preShow);
    const pads = launchHomePositions({
      droneCount: project.droneCount,
      config,
      limits: project.limits,
    });
    plan.drones.forEach((d, i) => {
      expect(d.homePosition[0]).toBeCloseTo(pads[i]![0], 6);
      expect(d.homePosition[2]).toBeCloseTo(pads[i]![2], 6);
    });
  });

  it("includes a PRE_SHOW phase and pre-show section in the full-show report", () => {
    const project = projectWithPreShow();
    const { plan, report } = analyzeFullShow(project, { sampleRate: 10 });
    expect(plan.preShow).not.toBeNull();
    expect(plan.startTime).toBeLessThan(0);
    expect(plan.phases[0]!.phase).toBe("PRE_SHOW");
    expect(report.preShow).not.toBeNull();
    expect(report.preShow!.metrics.groupCount).toBeGreaterThan(0);
  });

  it("leaves projects without a pre-show completely unchanged", () => {
    const project = createDefaultProject(12);
    const plan = buildShowPlan(project);
    expect(plan.preShow).toBeNull();
    expect(plan.startTime).toBe(0);
    const { report } = analyzeFullShow(project, { sampleRate: 10 });
    expect(report.preShow).toBeNull();
  });
});

describe("deterministic suggestions", () => {
  it("returns a bounded interval search that is never presented as a guarantee", () => {
    const result = suggestGroupInterval(projectWithPreShow(), {
      minInterval: 1,
      maxInterval: 2,
      step: 0.5,
      sampleRate: 10,
    });
    expect(result.bounded).toBe(true);
    expect(result.tried.length).toBeGreaterThan(0);
    expect(result.statement).toMatch(/not a real-world safety guarantee/i);
  });

  it("compares deterministic group orders", () => {
    const comparison = compareGroupOrders(projectWithPreShow(), ["forward", "reverse"], 10);
    expect(comparison).toHaveLength(2);
    expect(comparison.map((c) => c.order)).toEqual(["forward", "reverse"]);
  });
});
