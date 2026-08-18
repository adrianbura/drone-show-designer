/**
 * FULL-SHOW / PRE-SHOW CONSISTENCY.
 *
 * 1. windowStats() must map ABSOLUTE show time through TrajectorySet.startTime,
 *    which is negative whenever PRE_SHOW is enabled.
 * 2. Full-show home-pad validation must validate the homes the COMPOSED plan
 *    actually flies from (launch-grid pads under PRE_SHOW), never a second,
 *    independently derived footprint from the first formation.
 */
import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../defaultProject";
import { analyzeFullShow, composeFullShow, validateHomePads, windowStats } from "../fullshow";
import {
  DEFAULT_PRE_SHOW,
  launchHomePositions,
  patchPreShowConfig,
  resolvePreShowConfig,
  type PreShowConfig,
} from "../preshow";
import type { ShowProject, Vector3Tuple } from "../types";
import type { TrajectorySample, TrajectorySet } from "../trajectory/types";

const settings = { sampleRate: 10 as const };

function enabled(patch: Parameters<typeof patchPreShowConfig>[1] = {}): PreShowConfig {
  return patchPreShowConfig(DEFAULT_PRE_SHOW, { enabled: true, ...patch });
}

function projectWithPreShow(droneCount = 12): ShowProject {
  const project = createDefaultProject(droneCount);
  return { ...project, preShow: enabled() };
}

/** Synthetic set spanning [-4, 4] s with a velocity that encodes sample time. */
function syntheticSet(startTime: number, end: number, rate: number): TrajectorySet {
  const samples: TrajectorySample[] = [];
  for (let t = startTime; t <= end + 1e-9; t += 1 / rate) {
    const time = Math.round(t * 1e6) / 1e6;
    samples.push({
      t: time,
      position: [time, 10, 0] as Vector3Tuple,
      velocity: [Math.abs(time), 0, 0] as Vector3Tuple,
      acceleration: [0, 0, 0] as Vector3Tuple,
      jerk: [0, 0, 0] as Vector3Tuple,
      yaw: 0,
      yawRate: Math.abs(time),
    });
  }
  return {
    droneCount: 1,
    algorithmVersion: "test",
    sampleRate: rate,
    startTime,
    duration: end - startTime,
    drones: [{ droneId: "DRN-001", samples }],
  };
}

/** Independent reference implementation: filter by real timestamps. */
function referenceMaxVelocity(set: TrajectorySet, start: number, end: number): number {
  let max = 0;
  for (const drone of set.drones) {
    for (const s of drone.samples) {
      if (s.t < start - 1e-9 || s.t > end + 1e-9) continue;
      max = Math.max(max, Math.hypot(...s.velocity));
    }
  }
  return max;
}

describe("windowStats with a negative set start time", () => {
  const set = syntheticSet(-4, 4, 10);

  it("reads the negative-time samples for a PRE_SHOW window", () => {
    const stats = windowStats(set, -4, -2);
    expect(stats.maxVelocity).toBeCloseTo(referenceMaxVelocity(set, -4, -2), 6);
    expect(stats.maxVelocity).toBeCloseTo(4, 6);
    expect(stats.maxYawRate).toBeCloseTo(4, 6);
  });

  it("starts a TAKEOFF window at t = 0 on the correct sample", () => {
    const stats = windowStats(set, 0, 2);
    expect(stats.maxVelocity).toBeCloseTo(referenceMaxVelocity(set, 0, 2), 6);
    expect(stats.maxVelocity).toBeCloseTo(2, 6);
  });

  it("agrees with a direct timestamp-filtered calculation on every window", () => {
    for (const [a, b] of [
      [-4, 0],
      [-3, 1],
      [-1, 3],
      [0, 4],
      [1, 2],
    ] as const) {
      expect(windowStats(set, a, b).maxVelocity).toBeCloseTo(referenceMaxVelocity(set, a, b), 6);
    }
  });

  it("is unchanged for a set that starts at t = 0", () => {
    const zeroBased = syntheticSet(0, 4, 10);
    expect(windowStats(zeroBased, 0, 2).maxVelocity).toBeCloseTo(
      referenceMaxVelocity(zeroBased, 0, 2),
      6,
    );
  });
});

describe("PRE_SHOW phase metrics", () => {
  it("maps every phase window onto its actual absolute timestamps", () => {
    const project = projectWithPreShow();
    const { plan, report } = analyzeFullShow(project, settings);
    expect(plan.startTime).toBeLessThan(0);
    const set = plan.trajectorySet;

    for (const phase of report.phaseReports) {
      const direct = referenceMaxVelocity(set, phase.start, phase.end);
      expect(phase.maxVelocity).toBeCloseTo(direct, 6);
    }
    expect(report.phaseReports[0]!.phase).toBe("PRE_SHOW");
    expect(report.phaseReports[0]!.start).toBeCloseTo(plan.startTime, 6);
    // PRE_SHOW is real flight, so it must show real motion — the old index math
    // read post-show samples (or none) for negative windows.
    expect(report.phaseReports[0]!.maxVelocity).toBeGreaterThan(0);
  });
});

describe("full-show home-pad authority", () => {
  it("validates the composed plan's homes, not the first formation footprint", () => {
    const project = projectWithPreShow();
    const config = resolvePreShowConfig(project.preShow);
    const pads = launchHomePositions({
      droneCount: project.droneCount,
      config,
      limits: project.limits,
    });
    const plan = composeFullShow(project, settings);
    plan.drones.forEach((d, i) => {
      expect(d.homePosition[0]).toBeCloseTo(pads[i]![0], 6);
      expect(d.homePosition[2]).toBeCloseTo(pads[i]![2], 6);
    });

    const report = validateHomePads(project, plan.drones);
    const formationOnly = validateHomePads(project);
    expect(report.padCount).toBe(project.droneCount);
    // The two footprints differ, proving the composed homes are authoritative.
    expect(report.minSpacing).not.toBeCloseTo(formationOnly.minSpacing, 6);
  });

  it("reports invalid REAL launch pads", () => {
    const project: ShowProject = {
      ...createDefaultProject(12),
      preShow: enabled({ launch: { spacingX: 0.05, spacingZ: 0.05 } }),
    };
    const plan = composeFullShow(project, settings);
    const report = validateHomePads(project, plan.drones);
    expect(report.issues.length + (report.minSpacing < project.limits.minSeparation ? 1 : 0))
      .toBeGreaterThan(0);
    expect(report.minSpacing).toBeLessThan(project.limits.minSeparation);
  });

  it("does not let an obsolete formation footprint falsely block valid pads", () => {
    const base = projectWithPreShow();
    // Collapse the first formation's ground footprint: every drone would share a
    // pad if the obsolete formation-derived homes were validated.
    const broken: ShowProject = {
      ...base,
      formations: base.formations.map((f, i) =>
        i === 0 ? { ...f, points: f.points.map(() => [0, 30, 0] as Vector3Tuple) } : f,
      ),
    };
    const formationOnly = validateHomePads(broken);
    expect(formationOnly.duplicateCount).toBeGreaterThan(0);

    const plan = composeFullShow(broken, settings);
    const canonical = validateHomePads(broken, plan.drones);
    expect(canonical.duplicateCount).toBe(0);

    const { report } = analyzeFullShow(broken, settings);
    expect(report.homePads.duplicateCount).toBe(0);
  });

  it("leaves projects without a pre-show unchanged", () => {
    const project = createDefaultProject(12);
    const plan = composeFullShow(project, settings);
    const canonical = validateHomePads(project, plan.drones);
    const legacy = validateHomePads(project);
    expect(canonical.padCount).toBe(legacy.padCount);
    expect(canonical.minSpacing).toBeCloseTo(legacy.minSpacing, 6);
    expect(canonical.duplicateCount).toBe(legacy.duplicateCount);
  });
});
