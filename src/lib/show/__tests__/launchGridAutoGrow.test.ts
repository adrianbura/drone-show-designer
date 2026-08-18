import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAUNCH_GRID,
  buildLaunchLayout,
  resolveGridShape,
} from "@/lib/show/preshow/launchGrid";

/** BUG-2 diagnostic: fleet 300 with a configured 10x20 grid. */
describe("launch grid auto-growth diagnostic (fleet 300, 10x20)", () => {
  const config = { ...DEFAULT_LAUNCH_GRID, rows: 10, columns: 20 };
  const fleet = 300;

  it("reports the resolved grid, pad count and spacing", () => {
    const resolved = resolveGridShape(fleet, config);
    const layout = buildLaunchLayout(fleet, config);

    const report = {
      configuredRows: config.rows,
      configuredColumns: config.columns,
      configuredCapacity: config.rows * config.columns,
      resolvedRows: resolved.rows,
      resolvedColumns: resolved.columns,
      resolvedCapacity: resolved.rows * resolved.columns,
      pads: layout.pads.length,
      duplicatePads: layout.duplicatePads,
      minPadSpacing: layout.minPadSpacing,
    };
    // eslint-disable-next-line no-console
    console.log("BUG-2 DIAGNOSTIC", JSON.stringify(report, null, 2));

    expect(report.configuredCapacity).toBe(200);
    expect(report.resolvedRows).toBe(15);
    expect(report.resolvedColumns).toBe(20);
    expect(report.resolvedCapacity).toBe(300);
    expect(report.pads).toBe(300);
    expect(report.duplicatePads).toEqual([]);
    expect(report.minPadSpacing).toBeCloseTo(3, 6);
  });

  it("has 300 unique physical X/Z positions", () => {
    const layout = buildLaunchLayout(fleet, config);
    const keys = new Set(
      layout.pads.map((p) => `${p.x.toFixed(4)}|${p.z.toFixed(4)}`),
    );
    expect(keys.size).toBe(300);
  });
});

/** BUG-1 regression: canonical fleet clamp accepts 500. */
describe("fleet range", () => {
  it("keeps 500 pads for a 500-drone fleet", () => {
    const layout = buildLaunchLayout(500, DEFAULT_LAUNCH_GRID);
    expect(layout.pads.length).toBe(500);
    expect(layout.duplicatePads).toEqual([]);
  });
});
