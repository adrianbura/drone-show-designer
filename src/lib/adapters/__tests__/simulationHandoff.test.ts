import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { projectFileToJson, serializeProject } from "../../project";
import { createDemoProject } from "../../show/defaultProject";
import { analyzeFullShow } from "../../show/fullshow";
import { buildShowPlan, sampleTrajectorySet } from "../../show/trajectory";
import { buildSimulationHandoff } from "../simulationHandoff";

async function fixture() {
  const project = { ...createDemoProject(12), name: "Drone Show" };
  const plan = buildShowPlan(project);
  const set = sampleTrajectorySet(plan, { sampleRate: 2 });
  const fullShow = analyzeFullShow(project, { sampleRate: 2 }).report;
  return {
    project,
    plan,
    set,
    fullShow,
    projectFileJson: projectFileToJson(serializeProject(project, {})),
  };
}

describe("simulator handoff bundle", () => {
  it("contains one validated revision with verified hashes and is deterministic", async () => {
    const input = await fixture();
    const first = await buildSimulationHandoff(input);
    const second = await buildSimulationHandoff(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.zip).toEqual(second.zip);

    const entries = unzipSync(first.zip);
    expect(Object.keys(entries).sort()).toEqual([
      "drone-show.dsp.json",
      "drone-show.dss.show.json",
      "drone-show.trajectories.csv",
      "manifest.json",
    ]);
    const manifest = JSON.parse(
      new TextDecoder().decode(entries["manifest.json"]),
    ) as typeof first.manifest;
    expect(manifest.analysisRevision).toBe(input.fullShow.analysisRevision);
    expect(manifest.files).toHaveLength(3);
    expect(manifest.files.every((file) => file.sha256.length === 64 && file.bytes > 0)).toBe(true);
    // Builds the whole handoff twice (two full compositions + hashing): slow by
    // nature, so it gets an explicit budget instead of the 5 s default.
  }, 30000);

  it("refuses missing, stale and blocked validation evidence", async () => {
    const input = await fixture();
    expect((await buildSimulationHandoff({ ...input, fullShow: null })).ok).toBe(false);
    expect((await buildSimulationHandoff({ ...input, fullShowStale: true })).ok).toBe(false);
    expect(
      (
        await buildSimulationHandoff({
          ...input,
          fullShow: {
            ...input.fullShow,
            exportReadiness: { status: "BLOCKED", blockers: ["blocked"], warnings: [] },
          },
        })
      ).ok,
    ).toBe(false);
  });
});
