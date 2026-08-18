import { describe, expect, it } from "vitest";
import { buildComplexProject } from "./integration/fixtures";
import { createEffectFromPreset, findLightingPreset, projectLightingAt } from "../lighting";
describe("probe", () => { it("sweep", () => {
  const base = { ...buildComplexProject(20, 12).project, lighting: { schemaVersion: 1 as const, effects: [] } };
  for (const id of ["LEFT_TO_RIGHT","CENTER_TO_OUTSIDE","FADE_IN"]) {
    const preset = findLightingPreset(id)!;
    const fx = { ...createEffectFromPreset(preset, { kind: "SCENE" as const, clipId: "scene-1" }, { idSeed: 3 }), id: "fx", anchor: "SCENE_START" as const, start: 0 };
    const lit = { ...base, lighting: { schemaVersion: 1 as const, effects: [fx] } };
    const diffs = [0.1,0.5,1,2,3,4,6,8,9,10,12].map((t) => {
      const a = JSON.stringify(projectLightingAt({ project: base }, t));
      const b = JSON.stringify(projectLightingAt({ project: lit }, t));
      return `${t}:${a!==b?"DIFF":"same"}`;
    });
    console.log(id, preset.duration, JSON.stringify(preset.parameters), diffs.join(" "));
  }
  expect(1).toBe(1);
});});
