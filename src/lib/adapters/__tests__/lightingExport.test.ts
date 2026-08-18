import { describe, expect, it } from "vitest";

import { createDemoProject } from "../../show/defaultProject";
import {
  LIGHTING_SCHEMA_VERSION,
  createEffectFromPreset,
  emittedColor,
  findLightingPreset,
  projectLightingAt,
} from "../../show/lighting";
import { buildShowPlan, sampleTrajectorySet } from "../../show/trajectory";
import { toGenericShowJson, toTrajectoryCsv } from "../export";

describe("computed export lighting", () => {
  it("uses the canonical authored lighting engine for JSON and CSV", () => {
    const base = createDemoProject(6);
    const preset = findLightingPreset("COLOR_TRANSITION");
    expect(preset).toBeDefined();
    const effect = createEffectFromPreset(
      preset!,
      { kind: "SCENE", clipId: "c-2" },
      {
        idSeed: 42,
        parameters: { fromColor: [255, 0, 0], toColor: [0, 0, 255], easing: "LINEAR" },
      },
    );
    const project = {
      ...base,
      lighting: { schemaVersion: LIGHTING_SCHEMA_VERSION, effects: [effect] },
    };
    const plan = buildShowPlan(project);
    const set = sampleTrajectorySet(plan, { sampleRate: 2 });

    // Midway through the authored colour transition on c-2. This intentionally
    // differs from c-2's legacy pulse/base colour, so a legacy export path fails.
    const t = 31;
    const k = Math.round((t - (set.startTime ?? 0)) * set.sampleRate);
    const positions = set.drones.map((d) => d.samples[k]!.position);
    const expected = projectLightingAt({ project, participation: plan.participation, positions }, t).map(emittedColor);

    const json = JSON.parse(toGenericShowJson({ project, plan, set }));
    for (let i = 0; i < project.droneCount; i++) {
      expect(json.drones[i].samples[k].c).toEqual(expected[i]);
    }

    const csv = toTrajectoryCsv(project, set, plan).split("\n");
    // Header + frame-major rows: frame k, drone 0.
    const row = csv[1 + k * project.droneCount]!.split(",");
    expect(row.slice(-3).map(Number)).toEqual(expected[0]);
  });
});
