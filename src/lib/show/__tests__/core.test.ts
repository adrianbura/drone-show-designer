import { describe, expect, it } from "vitest";

import { headingFromVelocity, normalizeYawDeg } from "../coordinates";
import { createDefaultProject } from "../defaultProject";
import { droneIdForIndex } from "../drones";
import { buildShowPlan, sampleTrajectorySet, samplesAt } from "../trajectory";
import {
  separationViolations,
  separationViolationsBruteForce,
  validateShow,
} from "../safety";
import { showDuration } from "../types";

const project = createDefaultProject(48);

describe("coordinates", () => {
  it("normalises yaw into (-180, 180]", () => {
    expect(normalizeYawDeg(190)).toBeCloseTo(-170);
    expect(normalizeYawDeg(-540)).toBeCloseTo(180);
  });

  it("derives yaw 0 for +X motion", () => {
    expect(headingFromVelocity(1, 0)).toBeCloseTo(0);
  });
});

describe("plan determinism", () => {
  it("produces identical samples for identical input", () => {
    const a = sampleTrajectorySet(buildShowPlan(project), { sampleRate: 20 });
    const b = sampleTrajectorySet(buildShowPlan(project), { sampleRate: 20 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("keeps stable drone identity", () => {
    const plan = buildShowPlan(project);
    expect(plan.drones[0]!.id).toBe(droneIdForIndex(0));
    expect(plan.drones.length).toBe(project.droneCount);
  });

  it("covers the canonical show duration", () => {
    const set = sampleTrajectorySet(buildShowPlan(project), { sampleRate: 10 });
    expect(set.duration).toBeCloseTo(showDuration(project), 3);
  });

  it("starts and ends on the ground", () => {
    const plan = buildShowPlan(project);
    const first = samplesAt(plan, 0);
    const last = samplesAt(plan, showDuration(project));
    expect(Math.max(...first.map((s) => s.position[1]))).toBeLessThan(0.5);
    expect(Math.max(...last.map((s) => s.position[1]))).toBeLessThan(0.5);
  });
});

describe("separation", () => {
  it("spatial hash agrees with brute force", () => {
    const plan = buildShowPlan(project);
    for (const t of [4, 20, 45, 80]) {
      const positions = samplesAt(plan, t).map((s) => s.position);
      const fast = separationViolations(positions, project.limits.minSeparation)
        .map((v) => `${v.i}-${v.j}`)
        .sort();
      const slow = separationViolationsBruteForce(positions, project.limits.minSeparation)
        .map((v) => `${v.i}-${v.j}`)
        .sort();
      expect(fast).toEqual(slow);
    }
  });
});

describe("validation", () => {
  it("reports metrics for the demo show", () => {
    const plan = buildShowPlan(project);
    const set = sampleTrajectorySet(plan, { sampleRate: 20 });
    const report = validateShow(project, set, plan.drones);
    expect(report.metrics.invalidSamples).toBe(0);
    expect(report.droneReports.length).toBe(project.droneCount);
    expect(report.sampleRate).toBe(20);
  });
});
