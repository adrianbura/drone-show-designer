import { describe, expect, it } from "vitest";

import {
  addMotionGroup,
  applyPreset,
  dynamicFromFormation,
  sampleDynamicFormation,
  upsertTransformKeyframe,
  validateDynamicFormation,
  DYNAMIC_PRESETS,
} from "../dynamic";
import { generatePoints } from "../formations";
import { createDefaultProject } from "../defaultProject";
import { buildShowPlan } from "../trajectory/schedule";
import { sampleTrajectorySet } from "../trajectory/sampler";
import { validateTrajectorySet } from "../safety";

function base(count = 24) {
  const area = { width: 120, depth: 120, height: 100 };
  return {
    id: "f1",
    name: "Grid",
    kind: "grid" as const,
    points: generatePoints("grid", count, area, { altitude: 40 }),
    params: { altitude: 40, seed: 1 },
  };
}

describe("dynamic formation engine", () => {
  it("samples exactly N points and is deterministic", () => {
    const dynamic = applyPreset(dynamicFromFormation(base(), { id: "d1" }), "PULSE", 1);
    const a = sampleDynamicFormation(dynamic, 1.37);
    const b = sampleDynamicFormation(dynamic, 1.37);
    expect(a).toHaveLength(24);
    expect(a).toEqual(b);
  });

  it("applies global translation from the transform track", () => {
    let dynamic = dynamicFromFormation(base(), { id: "d1", duration: 4, loop: "NONE" });
    dynamic = upsertTransformKeyframe(dynamic, {
      t: 4,
      translation: [10, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      interpolation: "linear",
    });
    const start = sampleDynamicFormation(dynamic, 0);
    const end = sampleDynamicFormation(dynamic, 4);
    expect(end[0]![0] - start[0]![0]).toBeCloseTo(10, 5);
  });

  it("keeps motion groups independent and additive", () => {
    const source = dynamicFromFormation(base(8), { id: "d1", duration: 4 });
    const withGroup = addMotionGroup(source, "Wing", [source.points[0]!.id], "mg1");
    const moved = applyPreset(withGroup, "FLAP", 1);
    const points = sampleDynamicFormation(moved, 1);
    // Points outside every group keep their base position at any time.
    const untouched = moved.points[7]!;
    const sampled = points[7]!;
    expect(sampled[0]).toBeCloseTo(untouched.base[0], 5);
    expect(sampled[2]).toBeCloseTo(untouched.base[2], 5);
  });

  it("reports design-time metrics for every preset", () => {
    const project = createDefaultProject();
    for (const preset of DYNAMIC_PRESETS) {
      const dynamic = applyPreset(
        dynamicFromFormation(base(project.droneCount), { id: `d-${preset.id}` }),
        preset.id,
        1,
      );
      const report = validateDynamicFormation(dynamic, {
        limits: project.limits,
        area: project.area,
        expectedPointCount: project.droneCount,
      });
      expect(report.metrics.pointCount).toBe(project.droneCount);
      expect(report.metrics.sampledFrames).toBeGreaterThan(1);
    }
  });

  it("flows a dynamic clip through planning, sampling and safety validation", () => {
    const project = createDefaultProject();
    const dynamic = applyPreset(
      dynamicFromFormation(base(project.droneCount), { id: "dyn-1", duration: 6 }),
      "ORBIT",
      0.5,
    );
    const clip = project.timeline[project.timeline.length - 2]!;
    const withDynamic = {
      ...project,
      dynamicFormations: [dynamic],
      timeline: project.timeline.map((c) =>
        c.id === clip.id
          ? { ...c, dynamicFormationId: dynamic.id, playbackRate: 1, dynamicStartOffset: 0 }
          : c,
      ),
    };
    const plan = buildShowPlan(withDynamic);
    const set = sampleTrajectorySet(plan, { sampleRate: 10 });
    expect(set.droneCount).toBe(project.droneCount);
    const report = validateTrajectorySet(set, { limits: withDynamic.limits, area: withDynamic.area });
    expect(report.frames).toBeGreaterThan(0);
  });
});
