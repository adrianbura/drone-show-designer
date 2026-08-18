/**
 * FLEET COUNT SYNC — project.droneCount is the ONLY source of the number of
 * physical pads / staging targets. rows * columns is grid CAPACITY only.
 */
import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../defaultProject";
import { resolvePreShowConfig } from "../preshow/config";
import { buildPreShowOverlay } from "../preshow/overlay";
import { evaluateProjectSetup, DEFAULT_SETUP_DRAFT } from "../setup";
import { buildShowPlan } from "../trajectory";
import type { ShowProject } from "../types";

function projectWithPreShow(droneCount: number, launchPatch = {}): ShowProject {
  const base = createDefaultProject(droneCount);
  const config = resolvePreShowConfig(base.preShow);
  return {
    ...base,
    droneCount,
    preShow: { ...config, enabled: true, launch: { ...config.launch, ...launchPatch } },
  };
}

function counts(project: ShowProject) {
  const plan = buildShowPlan(project);
  const preShow = plan.preShow;
  expect(preShow).not.toBeNull();
  const overlay = buildPreShowOverlay(preShow!);
  return {
    pads: preShow!.layout.pads.length,
    staging: preShow!.staging.targets.length,
    overlayPads: overlay.launch.pads.length,
    overlayStaging: overlay.staging.targets.length,
    capacity: preShow!.layout.rows * preShow!.layout.columns,
  };
}

describe("pre-show fleet count sync", () => {
  for (const n of [200, 137, 500]) {
    it(`${n} drones produce exactly ${n} pads, staging targets and overlay entries`, () => {
      const c = counts(projectWithPreShow(n));
      expect(c.pads).toBe(n);
      expect(c.staging).toBe(n);
      expect(c.overlayPads).toBe(n);
      expect(c.overlayStaging).toBe(n);
    });
  }

  it("an oversized grid contributes capacity only, never drones", () => {
    const c = counts(projectWithPreShow(137, { rows: 10, columns: 20 }));
    expect(c.capacity).toBe(200);
    expect(c.pads).toBe(137);
    expect(c.staging).toBe(137);
    expect(c.overlayPads).toBe(137);
    expect(c.overlayStaging).toBe(137);

    const evaluation = evaluateProjectSetup({
      ...DEFAULT_SETUP_DRAFT,
      droneCount: 137,
      launch: { ...DEFAULT_SETUP_DRAFT.launch, rows: 10, columns: 20 },
    });
    expect(evaluation.capacity).toBe(200);
    expect(evaluation.occupiedPads).toBe(137);
    expect(evaluation.unusedPads).toBe(63);
  });

  it("resizing the fleet recomputes every derived pre-show count", () => {
    const sizes = [200, 137, 500];
    for (const n of sizes) {
      const c = counts(projectWithPreShow(n, { rows: 10, columns: 20 }));
      expect([c.pads, c.staging, c.overlayPads, c.overlayStaging]).toEqual([n, n, n, n]);
    }
  });
});
