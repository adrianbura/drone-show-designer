import { describe, expect, it } from "vitest";

import {
  AUDIENCE_VIEWPOINT_DEFAULTS,
  analyzeAudienceProjection,
  audienceMetricRows,
  buildAudiencePreview,
  resolveAudienceView,
} from "@/lib/show/diagnostics";
import type { Vector3Tuple } from "@/lib/show/types";

const cloud: Vector3Tuple[] = [
  [-20, 50, -10],
  [20, 50, 30],
  [0, 70, 0],
  [0, 30, 15],
];

describe("audience viewpoint mapping", () => {
  it("maps operator parameters to world coordinates (audience on -Z)", () => {
    const view = resolveAudienceView({
      viewerDistanceMeters: 120,
      viewerHeightMeters: 1.7,
      viewerOffsetXMeters: 5,
      targetHeightMeters: 60,
      targetOffsetXMeters: -2,
    });
    expect(view.viewer).toEqual([5, 1.7, -120]);
    expect(view.target).toEqual([-2, 60, 0]);
    expect(view.up).toEqual([0, 1, 0]);
  });

  it("uses the absolute distance so a negative entry stays in front of the image", () => {
    expect(resolveAudienceView({ ...AUDIENCE_VIEWPOINT_DEFAULTS, viewerDistanceMeters: -80 }).viewer[2]).toBe(-80);
  });

  it("never mutates the input point cloud", () => {
    const snapshot = JSON.stringify(cloud);
    analyzeAudienceProjection(cloud, resolveAudienceView(AUDIENCE_VIEWPOINT_DEFAULTS));
    expect(JSON.stringify(cloud)).toBe(snapshot);
  });
});

describe("audience preview model", () => {
  const report = analyzeAudienceProjection(cloud, resolveAudienceView(AUDIENCE_VIEWPOINT_DEFAULTS));

  it("selects which projection layers render per mode", () => {
    expect(buildAudiencePreview(report, "ORTHOGRAPHIC")).toMatchObject({
      showOrthographic: true,
      showPerspective: false,
    });
    expect(buildAudiencePreview(report, "PERSPECTIVE")).toMatchObject({
      showOrthographic: false,
      showPerspective: true,
    });
    expect(buildAudiencePreview(report, "OVERLAY")).toMatchObject({
      showOrthographic: true,
      showPerspective: true,
    });
  });

  it("normalises into [0,1] with a shared frame across modes", () => {
    const ortho = buildAudiencePreview(report, "ORTHOGRAPHIC");
    const overlay = buildAudiencePreview(report, "OVERLAY");
    expect(ortho.bounds).toEqual(overlay.bounds);
    for (const p of overlay.points) {
      for (const c of [...p.orthographic, ...p.perspective]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it("flags the analyzer's worst point and nothing else", () => {
    const overlay = buildAudiencePreview(report, "OVERLAY");
    const flagged = overlay.points.filter((p) => p.isWorst).map((p) => p.index);
    expect(flagged).toEqual([report.maxDeviationIndex]);
  });

  it("handles an empty cloud", () => {
    const empty = analyzeAudienceProjection([], resolveAudienceView(AUDIENCE_VIEWPOINT_DEFAULTS));
    expect(buildAudiencePreview(empty, "OVERLAY")).toMatchObject({ empty: true, points: [] });
  });

  it("reports metric values straight from the canonical analyzer", () => {
    const rows = audienceMetricRows(report);
    const get = (label: string) => rows.find((r) => r.label === label)?.value;
    expect(get("target distance")).toBe(`${report.targetDistance.toFixed(2)} m`);
    expect(get("rms deviation")).toBe(`${report.rmsApparentDeviation.toFixed(2)} m`);
    expect(get("max deviation")).toBe(`${report.maxApparentDeviation.toFixed(2)} m`);
    expect(get("depth extent")).toBe(`${report.depthExtent.toFixed(2)} m`);
  });
});

describe("viewer distance sensitivity", () => {
  it("reduces apparent distortion as the audience moves back", () => {
    const rms = [50, 100, 200].map(
      (d) =>
        analyzeAudienceProjection(
          cloud,
          resolveAudienceView({ ...AUDIENCE_VIEWPOINT_DEFAULTS, viewerDistanceMeters: d }),
        ).rmsApparentDeviation,
    );
    expect(rms[0]!).toBeGreaterThan(rms[1]!);
    expect(rms[1]!).toBeGreaterThan(rms[2]!);
  });

  it("surfaces an invalid viewpoint as a thrown analyzer error", () => {
    expect(() =>
      analyzeAudienceProjection(cloud, { viewer: [0, 60, 0], target: [0, 60, 0] }),
    ).toThrow(/different points/);
  });
});
