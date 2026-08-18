import { describe, expect, it } from "vitest";

import { createDemoProject } from "../defaultProject";
import { makeFormation } from "../formations";
import {
  analyzeFullShow,
  composeFullShow,
  computeAnalysisRevision,
  segmentAt,
  validateContinuity,
  validateHomePads,
  validateLightProgram,
  validateTimelineStructure,
  segmentBoundaries,
} from "../fullshow";
import { detectConflicts } from "../conflicts";
import type { ShowProject, TimelineClip } from "../types";
import { showDuration } from "../types";

const settings = { sampleRate: 10, assignmentStrategy: "nearestNeighbor" as const };

function smallProject(droneCount = 12): ShowProject {
  const base = createDemoProject();
  const project: ShowProject = { ...base, droneCount };
  return {
    ...project,
    formations: project.formations.map((f) =>
      makeFormation(f.id, f.name, f.kind, droneCount, project.area, f.params),
    ),
  };
}

describe("full show composition", () => {
  it("composes one continuous trajectory set covering the whole show", () => {
    const project = smallProject();
    const plan = composeFullShow(project, settings);
    expect(plan.trajectorySet.drones).toHaveLength(project.droneCount);
    expect(plan.duration).toBeCloseTo(showDuration(project), 6);
    const samples = plan.trajectorySet.drones[0]!.samples;
    expect(samples[0]!.t).toBe(0);
    expect(samples[samples.length - 1]!.t).toBeCloseTo(plan.duration, 1);
    expect(plan.errors).toHaveLength(0);
  });

  it("covers TAKEOFF, SHOW and LANDING with contiguous segments", () => {
    const plan = composeFullShow(smallProject(), settings);
    const phases = plan.phases.map((p) => p.phase);
    expect(phases[0]).toBe("TAKEOFF");
    expect(phases[phases.length - 1]).toBe("LANDING");
    for (let i = 1; i < plan.segments.length; i++) {
      expect(plan.segments[i]!.start).toBeCloseTo(plan.segments[i - 1]!.end, 6);
    }
    expect(segmentAt(plan, 0)!.phase).toBe("TAKEOFF");
    expect(segmentAt(plan, plan.duration)!.phase).toBe("LANDING");
  });

  it("starts on its own pad and lands on exactly one pad each", () => {
    const plan = composeFullShow(smallProject(), settings);
    const padKey = (p: readonly number[]) => `${p[0]!.toFixed(1)},${p[2]!.toFixed(1)}`;
    const pads = new Set(plan.drones.map((d) => padKey(d.homePosition)));
    const landedOn = new Set<string>();
    plan.trajectorySet.drones.forEach((drone, i) => {
      const first = drone.samples[0]!.position;
      const last = drone.samples[drone.samples.length - 1]!.position;
      expect(first[1]).toBeLessThan(0.05);
      expect(padKey(first)).toBe(padKey(plan.drones[i]!.homePosition));
      expect(last[1]).toBeLessThan(0.35);
      // LANDING uses optimal pad assignment: pads are interchangeable, but the
      // mapping must stay a bijection so no pad receives two drones.
      expect(pads.has(padKey(last))).toBe(true);
      expect(landedOn.has(padKey(last))).toBe(false);
      landedOn.add(padKey(last));
    });
    expect(landedOn.size).toBe(plan.drones.length);
  });

  it("is deterministic: identical input yields identical samples and revision", () => {
    const project = smallProject();
    const a = composeFullShow(project, settings);
    const b = composeFullShow(project, settings);
    expect(a.metadata.analysisRevision).toBe(b.metadata.analysisRevision);
    expect(computeAnalysisRevision(project, settings)).toBe(a.metadata.analysisRevision);
    for (let i = 0; i < a.trajectorySet.drones.length; i++) {
      expect(b.trajectorySet.drones[i]!.samples.map((s) => s.position)).toEqual(
        a.trajectorySet.drones[i]!.samples.map((s) => s.position),
      );
    }
  });

  it("changes the analysis revision when anything relevant changes", () => {
    const project = smallProject();
    const base = computeAnalysisRevision(project, settings);
    expect(computeAnalysisRevision({ ...project, droneCount: 13 }, settings)).not.toBe(base);
    expect(computeAnalysisRevision(project, { ...settings, sampleRate: 25 })).not.toBe(base);
    expect(
      computeAnalysisRevision(
        {
          ...project,
          limits: { ...project.limits, minSeparation: project.limits.minSeparation + 1 },
        },
        settings,
      ),
    ).not.toBe(base);
    expect(
      computeAnalysisRevision(
        {
          ...project,
          timeline: project.timeline.map((c, i) => (i === 1 ? { ...c, hold: c.hold + 1 } : c)),
        },
        settings,
      ),
    ).not.toBe(base);
  });
});

describe("continuity validation", () => {
  it("reports no discontinuity for a normally composed show", () => {
    const project = smallProject();
    const plan = composeFullShow(project, settings);
    const report = validateContinuity(plan.trajectorySet, {
      limits: project.limits,
      drones: plan.drones,
      boundaries: segmentBoundaries(plan),
    });
    const blocking = report.issues.filter((i) => i.type !== "WRONG_HOME_PAD");
    expect(blocking).toEqual([]);
    expect(report.maxPositionDiscontinuity).toBeLessThan(report.positionTolerance);
    expect(report.landedCount).toBe(project.droneCount);
  });

  it("detects an injected position teleport", () => {
    const project = smallProject();
    const plan = composeFullShow(project, settings);
    const set = plan.trajectorySet;
    const drone = set.drones[0]!;
    const k = Math.floor(drone.samples.length / 2);
    const broken = {
      ...set,
      drones: [
        {
          droneId: drone.droneId,
          samples: drone.samples.map((s, i) =>
            i === k ? { ...s, position: [s.position[0] + 60, s.position[1], s.position[2]] as const } : s,
          ),
        },
        ...set.drones.slice(1),
      ],
    };
    const report = validateContinuity(broken, {
      limits: project.limits,
      drones: plan.drones,
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.type === "POSITION_DISCONTINUITY")).toBe(true);
  });
});

describe("timeline and home pad validation", () => {
  it("accepts the default timeline", () => {
    const report = validateTimelineStructure(smallProject());
    expect(report.hasTakeoff).toBe(true);
    expect(report.hasLanding).toBe(true);
    expect(report.phaseOrderValid).toBe(true);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("flags missing take-off, missing landing, overlaps and bad durations", () => {
    const project = smallProject();
    const bad: TimelineClip[] = [
      { ...project.timeline[1]!, start: 0, transition: 0, hold: 5, phase: "SHOW" },
      { ...project.timeline[2]!, start: 3, transition: 5, hold: -2, phase: "SHOW" },
    ];
    const report = validateTimelineStructure({ ...project, timeline: bad });
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain("MISSING_TAKEOFF");
    expect(codes).toContain("MISSING_LANDING");
    expect(codes).toContain("NON_POSITIVE_TRANSITION");
    expect(codes).toContain("NEGATIVE_HOLD");
    expect(codes).toContain("CLIP_OVERLAP");
  });

  it("flags duplicate home pads", () => {
    const project = smallProject();
    const flat = project.formations.map((f, i) =>
      i === 0 ? { ...f, points: f.points.map(() => [0, 0, 0] as const) } : f,
    );
    const report = validateHomePads({ ...project, formations: flat });
    expect(report.duplicateCount).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.code === "DUPLICATE_PAD")).toBe(true);
  });
});

describe("light program validation", () => {
  it("produces in-gamut colours for every effect across the whole show", () => {
    const project = smallProject();
    const withEffects: ShowProject = {
      ...project,
      timeline: project.timeline.map((c, i) => ({
        ...c,
        effect: (["solid", "pulse", "rainbow", "chase", "twinkle"] as const)[i % 5]!,
      })),
    };
    const plan = composeFullShow(withEffects, settings);
    const report = validateLightProgram(withEffects, plan);
    expect(report.invalidSamples).toBe(0);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("full show validation report", () => {
  it("aggregates conflicts, safety, phases and per-drone metrics", () => {
    const project = smallProject();
    const { plan, report } = analyzeFullShow(project, settings);
    expect(report.droneCount).toBe(project.droneCount);
    expect(report.sampleRate).toBe(10);
    expect(report.phaseReports.map((p) => p.phase)).toContain("LANDING");
    expect(report.droneReports).toHaveLength(project.droneCount);
    expect(report.transitionReports).toHaveLength(project.timeline.length);
    expect(report.metrics.totalDistanceFlown).toBeGreaterThan(0);
    expect(["PASS", "PASS_WITH_WARNINGS", "FAIL"]).toContain(report.status);
    // Conflicts in the report must match a direct detector run on the same set.
    const direct = detectConflicts(plan.trajectorySet, {
      minSeparation: project.limits.minSeparation,
    });
    expect(report.conflicts.conflictCount).toBe(direct.conflictCount);
    expect(report.contextualConflicts).toHaveLength(report.conflicts.conflicts.length);
  });

  it("never claims real-world flight safety", () => {
    const { report } = analyzeFullShow(smallProject(), settings);
    expect(report.statement).toMatch(/NOT (a certification|an authorisation)|NOT an authorisation/);
    expect(report.statement.toLowerCase()).not.toContain("safe to fly");
  });

  it("fails and blocks export when the timeline is structurally invalid", () => {
    const project = smallProject();
    const broken: ShowProject = {
      ...project,
      timeline: project.timeline.filter((c) => (c.phase ?? "SHOW") !== "LANDING"),
    };
    const { report } = analyzeFullShow(broken, settings);
    expect(report.status).toBe("FAIL");
    expect(report.errors.some((e) => e.code === "MISSING_LANDING")).toBe(true);
    expect(report.exportReadiness.status).toBe("BLOCKED");
    expect(report.exportReadiness.blockers.length).toBeGreaterThan(0);
  });

  it("detects induced proximity violations when separation is raised", () => {
    const project = smallProject();
    const tight: ShowProject = {
      ...project,
      limits: { ...project.limits, minSeparation: 40 },
    };
    const { report } = analyzeFullShow(tight, settings);
    expect(report.metrics.totalConflictCount).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.category === "conflict")).toBe(true);
  });

  it("reports progress stages in order and supports cancellation", () => {
    const stages: string[] = [];
    analyzeFullShow(smallProject(), {
      ...settings,
      onProgress: (p) => stages.push(p.stage),
    });
    expect(stages[0]).toBe("preparing");
    expect(stages).toContain("composingShow");
    expect(stages[stages.length - 1]).toBe("buildingReport");

    let calls = 0;
    expect(() =>
      analyzeFullShow(smallProject(), {
        ...settings,
        isCancelled: () => ++calls > 2,
      }),
    ).toThrowError(/cancelled/i);
  });

  it("is deterministic across repeated analyses", () => {
    const project = smallProject();
    const a = analyzeFullShow(project, settings).report;
    const b = analyzeFullShow(project, settings).report;
    expect(b.status).toBe(a.status);
    expect(b.analysisRevision).toBe(a.analysisRevision);
    expect(b.metrics.totalConflictCount).toBe(a.metrics.totalConflictCount);
    expect(b.metrics.minimumDynamicSeparation).toBeCloseTo(a.metrics.minimumDynamicSeparation, 9);
    expect(b.metrics.totalDistanceFlown).toBeCloseTo(a.metrics.totalDistanceFlown, 6);
  });
});

describe("scale", () => {
  it("validates a 200-drone, multi-minute show and reports its cost", () => {
    const project = smallProject(200);
    const started = Date.now();
    const { plan, report } = analyzeFullShow(project, { sampleRate: 10 });
    const elapsed = Date.now() - started;
    expect(report.droneCount).toBe(200);
    expect(plan.trajectorySet.drones).toHaveLength(200);
    expect(report.continuity.checkedSamples).toBeGreaterThan(100_000);
    expect(report.metrics.trajectoryMemoryEstimateBytes).toBeGreaterThan(0);
    // Honest cost record rather than a hidden assumption: a full 200-drone
    // validation must stay inside an interactive budget on CI hardware.
    expect(elapsed).toBeLessThan(120_000);
  }, 180_000);
});
