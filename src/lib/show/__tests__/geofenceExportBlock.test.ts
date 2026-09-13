/**
 * REGRESSION — a GPS perimeter breach must block computed-show exports.
 *
 * The single safety authority stays `FullShowValidationReport.exportReadiness`,
 * produced by the full-show validator from the authored site. This test only
 * observes that authority and the UI eligibility projection that reads it; it
 * introduces no new safety computation.
 */
import { describe, expect, it } from "vitest";

import { evaluateExportEligibility } from "@/lib/adapters/exportEligibility";
import { createDemoProject } from "../defaultProject";
import { makeFormation } from "../formations";
import { analyzeFullShow } from "../fullshow";
import { rectangularPerimeter, type ShowSite } from "../geo";
import type { ShowProject } from "../types";

const ORIGIN = { lat: 44.4268, lon: 26.1025 };
const settings = { sampleRate: 5, assignmentStrategy: "nearestNeighbor" as const };

function site(widthM: number, depthM: number, ceilingM: number): ShowSite {
  return {
    origin: ORIGIN,
    headingDeg: 0,
    perimeter: rectangularPerimeter({ origin: ORIGIN, headingDeg: 0 }, widthM, depthM),
    marginM: 2,
    ceilingM,
  };
}

function project(droneCount = 8): ShowProject {
  const base = createDemoProject();
  const p: ShowProject = { ...base, droneCount };
  return {
    ...p,
    formations: p.formations.map((f) =>
      makeFormation(f.id, f.name, f.kind, droneCount, p.area, f.params),
    ),
  };
}

describe("geofence breach blocks computed-show export", () => {
  it("reports geofence errors and BLOCKED export readiness when the show leaves the perimeter", () => {
    const tiny = { ...project(), site: site(20, 20, 400) };
    const { report } = analyzeFullShow(tiny, settings);

    const geofenceErrors = report.errors.filter((e) => e.category === "geofence");
    expect(geofenceErrors.length).toBeGreaterThan(0);
    expect(geofenceErrors.some((e) => e.code === "GEOFENCE_OUTSIDE")).toBe(true);
    expect(report.exportReadiness.status).toBe("BLOCKED");
    expect(report.exportReadiness.blockers.length).toBeGreaterThan(0);

    const eligibility = evaluateExportEligibility(report, false);
    expect(eligibility.canExportComputedShow).toBe(false);
    expect(eligibility.reason).toBe("BLOCKED");
    // The editable project document is never withheld.
    expect(eligibility.canExportProjectFile).toBe(true);
  });

  it("reports a ceiling breach as a blocking error", () => {
    const lowCeiling = { ...project(), site: site(600, 600, 5) };
    const { report } = analyzeFullShow(lowCeiling, settings);

    expect(report.errors.some((e) => e.code === "GEOFENCE_CEILING")).toBe(true);
    expect(report.exportReadiness.status).toBe("BLOCKED");
    expect(evaluateExportEligibility(report, false).canExportComputedShow).toBe(false);
  });

  it("does not raise geofence errors when the whole show stays inside a generous site", () => {
    const roomy = { ...project(), site: site(1200, 1200, 500) };
    const { report } = analyzeFullShow(roomy, settings);

    expect(report.errors.filter((e) => e.category === "geofence")).toHaveLength(0);
  });

  it("keeps a fresh geofence-clean report exportable, and a stale one not", () => {
    const roomy = { ...project(), site: site(1200, 1200, 500) };
    const { report } = analyzeFullShow(roomy, settings);
    if (report.exportReadiness.status !== "BLOCKED") {
      expect(evaluateExportEligibility(report, false).canExportComputedShow).toBe(true);
    }
    expect(evaluateExportEligibility(report, true).canExportComputedShow).toBe(false);
  });
});
