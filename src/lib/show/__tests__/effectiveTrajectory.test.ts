/**
 * HYBRID EFFECTIVE TRAJECTORY AUTHORITY.
 *
 * Proves that a project carrying an imported ESSP layer is validated and
 * exported from ONE spliced trajectory: imported samples on reference-owned
 * intervals, planner samples elsewhere — and that promoting a clip moves exactly
 * that clip's intervals to the planner.
 */
import { describe, expect, it } from "vitest";

import { buildSyntheticEssp } from "../../import/essp/codec";
import { buildReferenceShow } from "../../import/essp/reference";
import { analyzeReferenceShow } from "../../import/essp/forensics/report";
import {
  extractReferenceTimeline,
  promoteReferenceClips,
  reseedReferenceSignatures,
  resolveReferenceIntervals,
} from "../../import/essp/native";
import { sampleReferenceDrone } from "../../import/essp/playback";
import { createDemoProject } from "../defaultProject";
import { buildShowPlan, sampleScheduleBoundaryAt } from "../trajectory/schedule";
import {
  alignedStartTime,
  computeAnalysisRevision,
  effectiveSampleRate,
  sampleEffectiveTrajectorySet,
} from "../fullshow";
import type { ShowProject } from "../types";

const RATE = 8;
const DRONES = 6;

function trajectory(index: number): number[][] {
  const out: number[][] = [];
  const x = (index % 3) * 500 - 500;
  const y = Math.floor(index / 3) * 500 - 250;
  const push = (seconds: number, z: (t: number) => number, dx = 0) => {
    for (let f = 0; f < seconds * RATE; f += 1) {
      const t = f / RATE;
      out.push([x + dx * t, y, Math.round(z(t))]);
    }
  };
  push(12, (t) => (t / 12) * 3000);
  push(20, () => 3000);
  push(16, () => 3000, 60);
  push(20, () => 3000);
  push(12, (t) => 3000 * (1 - t / 12));
  return out;
}

async function importedProject() {
  const files = Array.from({ length: DRONES }, (_, i) => {
    const xyz = trajectory(i);
    const rgb = xyz.map((_, f) => [(f * 3) % 256, 40, 90]);
    return { name: `${i + 1}.essp`, bytes: buildSyntheticEssp({ xyz, rgb }) };
  });
  const show = await buildReferenceShow(files);
  const result = extractReferenceTimeline(show, analyzeReferenceShow(show));
  const base = createDemoProject(DRONES);
  const project: ShowProject = {
    ...base,
    droneCount: result.droneCount,
    formations: [...result.formations],
    timeline: [...result.timeline],
    dynamicFormations: [...result.dynamicFormations],
    scenes: [],
    lighting: result.lighting,
    ...(base.preShow ? { preShow: { ...base.preShow, enabled: false } } : {}),
  };
  const layer = reseedReferenceSignatures(project, result.layer, {
    assignmentStrategy: "nearestNeighbor",
    transitionOverrides: {},
  });
  return { show, project, layer };
}

describe("effective trajectory authority", () => {
  it("aligns the effective grid to the imported position clock", () => {
    expect(effectiveSampleRate(25, 8)).toBe(32);
    expect(effectiveSampleRate(10, 8)).toBe(16);
    expect(effectiveSampleRate(8, 8)).toBe(8);
    expect(alignedStartTime(0, 32)).toBe(0);
    expect(alignedStartTime(-3.01, 32)).toBeCloseTo(-3.03125, 6);
  });

  it("returns the imported samples on reference-owned intervals", async () => {
    const { show, project, layer } = await importedProject();
    const plan = buildShowPlan(project, { assignmentStrategy: "nearestNeighbor" });
    const effective = sampleEffectiveTrajectorySet(plan, {
      sampleRate: 25,
      startTime: plan.startTime ?? 0,
      endTime: plan.duration,
      reference: { show, layer },
    });

    expect(effective.authority.kind).toBe("SPLICED");
    expect(effective.authority.sampleRate).toBe(32);
    expect(effective.authority.referenceSampleCount).toBeGreaterThan(0);

    const intervals = resolveReferenceIntervals(layer).filter((i) => i.owner === "REFERENCE");
    expect(intervals.length).toBeGreaterThan(0);
    const t = intervals[0]!.start + (intervals[0]!.end - intervals[0]!.start) / 2;
    // Pick the exact grid timestamp so the comparison is sample-to-sample.
    const rate = effective.authority.sampleRate;
    const time = Math.round(t * rate) / rate;
    for (let d = 0; d < DRONES; d += 1) {
      const sample = effective.set.drones[d]!.samples.find((s) => Math.abs(s.t - time) < 1e-9)!;
      const source = sampleReferenceDrone(show.drones[d]!, time, show.timing).position;
      expect(sample.position[0]).toBeCloseTo(source[0], 6);
      expect(sample.position[1]).toBeCloseTo(source[1], 6);
      expect(sample.position[2]).toBeCloseTo(source[2], 6);
      // The imported payload has no heading: reported as unknown, never invented.
      expect(sample.yaw).toBe(0);
      expect(sample.yawRate).toBe(0);
    }
  });

  it("hands an interval to the planner when its clip is promoted", async () => {
    const { show, project, layer } = await importedProject();
    const plan = buildShowPlan(project, { assignmentStrategy: "nearestNeighbor" });
    const options = {
      sampleRate: 25,
      startTime: plan.startTime ?? 0,
      endTime: plan.duration,
    } as const;
    const before = sampleEffectiveTrajectorySet(plan, { ...options, reference: { show, layer } });

    const target = layer.bindings[1] ?? layer.bindings[0]!;
    const promoted = promoteReferenceClips(layer, [{ clipId: target.clipId, reason: "MANUAL" }]);
    expect(promoted.changed).toBe(true);
    const after = sampleEffectiveTrajectorySet(plan, {
      ...options,
      reference: { show, layer: promoted.layer },
    });

    expect(after.authority.referenceSampleCount).toBeLessThan(
      before.authority.referenceSampleCount,
    );
    expect(after.authority.promotedClipIds).toContain(target.clipId);
    // Promotion of ONE clip never returns the whole show to the planner.
    expect(after.authority.referenceSampleCount).toBeGreaterThan(0);

    const boundary = resolveReferenceIntervals(promoted.layer).find(
      (interval, index, intervals) =>
        interval.owner === "PLANNER" && index > 0 && intervals[index - 1]?.owner === "REFERENCE",
    )!;
    const frame = Math.round((boundary.start - (after.set.startTime ?? 0)) * after.set.sampleRate);
    const expected = sampleScheduleBoundaryAt(
      plan.schedules[0]!,
      plan.drones[0]!.homePosition,
      boundary.start,
      "right",
    );
    expect(after.set.drones[0]!.samples[frame]!.position).toEqual(expected.position);
    expect(after.set.drones[0]!.samples[frame]!.velocity).toEqual(expected.velocity);
  });

  it("falls back to a planner-only authority without an imported layer", () => {
    const project = createDemoProject(DRONES);
    const plan = buildShowPlan(project, { assignmentStrategy: "nearestNeighbor" });
    const effective = sampleEffectiveTrajectorySet(plan, {
      sampleRate: 25,
      startTime: plan.startTime ?? 0,
      endTime: plan.duration,
    });
    expect(effective.authority.kind).toBe("PLANNER_ONLY");
    expect(effective.splice).toBeNull();
    expect(effective.set).toBe(effective.plannerSet);
  });

  it("makes the analysis revision depend on imported ownership", async () => {
    const { project, layer } = await importedProject();
    const inputs = { sampleRate: 25, assignmentStrategy: "nearestNeighbor" } as const;
    const withLayer = computeAnalysisRevision(project, { ...inputs, referenceLayer: layer });
    const withoutLayer = computeAnalysisRevision(project, { ...inputs, referenceLayer: null });
    const promoted = promoteReferenceClips(layer, [
      { clipId: layer.bindings[0]!.clipId, reason: "MANUAL" },
    ]);
    const afterPromotion = computeAnalysisRevision(project, {
      ...inputs,
      referenceLayer: promoted.layer,
    });

    expect(withLayer).not.toBe(withoutLayer);
    expect(afterPromotion).not.toBe(withLayer);
  });
});
