import { describe, expect, it } from "vitest";

import { buildLaunchLayout } from "../preshow/launchGrid";
import { resolvePreShowConfig } from "../preshow/config";
import {
  createProjectFromSetup,
  DEFAULT_SETUP_DRAFT,
  detectLaunchGridPreset,
  evaluateProjectSetup,
  gridCapacity,
  gridFootprint,
  preShowConfigFromSetup,
  setupDraftFromProject,
  LAUNCH_GRID_PRESETS,
  type ProjectSetupDraft,
} from "../setup";
import { computeAnalysisRevision } from "../fullshow";

function draft(patch: Partial<ProjectSetupDraft> = {}): ProjectSetupDraft {
  return { ...DEFAULT_SETUP_DRAFT, ...patch };
}

describe("project setup — launch grid", () => {
  it("computes capacity, occupancy and a partial final row", () => {
    const d = draft({
      droneCount: 153,
      launch: { ...DEFAULT_SETUP_DRAFT.launch, rows: 10, columns: 16 },
    });
    const evaluation = evaluateProjectSetup(d);
    expect(gridCapacity(d.launch)).toBe(160);
    expect(evaluation.capacity).toBe(160);
    expect(evaluation.occupiedPads).toBe(153);
    expect(evaluation.unusedPads).toBe(7);
    expect(evaluation.canCreate).toBe(true);
  });

  it("blocks creation when capacity is below the fleet size", () => {
    const evaluation = evaluateProjectSetup(
      draft({ droneCount: 200, launch: { ...DEFAULT_SETUP_DRAFT.launch, rows: 5, columns: 10 } }),
    );
    expect(evaluation.canCreate).toBe(false);
    expect(evaluation.issues.some((i) => i.code === "GRID_CAPACITY")).toBe(true);
    expect(() => createProjectFromSetup(draft({ droneCount: 200, launch: { ...DEFAULT_SETUP_DRAFT.launch, rows: 5, columns: 10 } }))).toThrow();
  });

  it("derives the footprint from the engine layout", () => {
    const launch = {
      ...DEFAULT_SETUP_DRAFT.launch,
      rows: 10,
      columns: 20,
      spacingX: 2.1,
      spacingZ: 2.1,
    };
    const footprint = gridFootprint(200, launch);
    expect(footprint.width).toBeCloseTo(39.9, 6);
    expect(footprint.depth).toBeCloseTo(18.9, 6);
    const layout = buildLaunchLayout(200, launch);
    expect(footprint.rotatedWidth).toBeCloseTo(layout.bounds.width, 9);
  });

  it("rotation changes pad geometry but not pad count or order", () => {
    const base = { ...DEFAULT_SETUP_DRAFT.launch, rows: 4, columns: 4, spacingX: 2, spacingZ: 2 };
    const straight = buildLaunchLayout(16, base);
    const rotated = buildLaunchLayout(16, { ...base, rotationDeg: 45 });
    expect(rotated.pads).toHaveLength(16);
    expect(rotated.pads[0]!.id).toBe(straight.pads[0]!.id);
    expect(rotated.pads[0]!.position).not.toEqual(straight.pads[0]!.position);
    expect(gridFootprint(16, { ...base, rotationDeg: 45 }).rotatedWidth).toBeGreaterThan(
      gridFootprint(16, base).rotatedWidth,
    );
  });

  it("applies offset and ground altitude to pads", () => {
    const layout = buildLaunchLayout(9, {
      ...DEFAULT_SETUP_DRAFT.launch,
      rows: 3,
      columns: 3,
      spacingX: 2,
      spacingZ: 2,
      originX: 20,
      originZ: -10,
      groundAltitude: 1.5,
    });
    expect(layout.center[0]).toBeCloseTo(20, 6);
    expect(layout.center[2]).toBeCloseTo(-10, 6);
    for (const pad of layout.pads) expect(pad.position[1]).toBeCloseTo(1.5, 9);
  });

  it("fills pads row-major with a deterministic drone → pad mapping", () => {
    const layout = buildLaunchLayout(7, {
      ...DEFAULT_SETUP_DRAFT.launch,
      rows: 3,
      columns: 3,
    });
    expect(layout.pads.map((p) => [p.row, p.column])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
    ]);
    expect(layout.droneToPad["DRN-001"]).toBe("PAD-001");
  });

  it("detects spacing presets", () => {
    expect(
      detectLaunchGridPreset({ ...DEFAULT_SETUP_DRAFT.launch, ...LAUNCH_GRID_PRESETS.WIDE }),
    ).toBe("WIDE");
    expect(
      detectLaunchGridPreset({ ...DEFAULT_SETUP_DRAFT.launch, spacingX: 2.1, spacingZ: 2.1 }),
    ).toBe("CUSTOM");
  });
});

describe("project setup — project creation", () => {
  it("writes the wizard geometry into the canonical pre-show config", () => {
    const d = draft({
      name: "Demo A",
      droneCount: 150,
      launch: {
        ...DEFAULT_SETUP_DRAFT.launch,
        rows: 10,
        columns: 15,
        spacingX: 2.1,
        spacingZ: 2.1,
        rotationDeg: 0,
        groundAltitude: 0,
      },
    });
    const project = createProjectFromSetup(d);
    const config = resolvePreShowConfig(project.preShow);
    expect(project.name).toBe("Demo A");
    expect(project.droneCount).toBe(150);
    expect(config.launch.columns).toBe(15);
    expect(config.launch.spacingX).toBeCloseTo(2.1, 9);
    expect(config.enabled).toBe(true);
    expect(buildLaunchLayout(project.droneCount, config.launch).pads).toHaveLength(150);
  });

  it("carries staging altitude and horizontal offsets into the planner config", () => {
    const config = preShowConfigFromSetup(
      draft({
        droneCount: 200,
        launch: { ...DEFAULT_SETUP_DRAFT.launch, rows: 10, columns: 20 },
        staging: { enabled: true, altitude: 50, leftRight: 20, forwardBack: -10, spacing: 5 },
      }),
    );
    expect(config.staging.altitude).toBe(50);
    expect(config.staging.leftRight).toBe(20);
    expect(config.staging.forwardBack).toBe(-10);
  });

  it("round-trips a project into an editable draft", () => {
    const project = createProjectFromSetup(draft({ name: "RT", droneCount: 48 }));
    const back = setupDraftFromProject(project);
    expect(back.name).toBe("RT");
    expect(back.droneCount).toBe(48);
    expect(back.launch).toEqual(resolvePreShowConfig(project.preShow).launch);
  });

  it("changing launch geometry changes the analysis revision (stale reports)", () => {
    const project = createProjectFromSetup(draft({ name: "Stale", droneCount: 24 }));
    const before = computeAnalysisRevision(project, 25);
    const changed = {
      ...project,
      preShow: preShowConfigFromSetup(
        { ...setupDraftFromProject(project), launch: { ...resolvePreShowConfig(project.preShow).launch, spacingX: 4 } },
        project.preShow,
      ),
    };
    expect(computeAnalysisRevision(changed, 25)).not.toBe(before);
  });
});
