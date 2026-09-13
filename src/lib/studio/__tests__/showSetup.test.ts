/**
 * GUIDED SHOW SETUP is a PURE PROJECTION. These tests fix canonical inputs and
 * prove the checklist only reports what those inputs already say, in the
 * industry authoring order, and never claims flight authorisation.
 */
import { describe, expect, it } from "vitest";

import { buildShowReadiness, type ShowReadinessModel } from "@/lib/adapters/showReadiness";
import type { FullShowValidationReport } from "@/lib/show/fullshow/types";
import type { ShowProject, TimelineClip } from "@/lib/show/types";
import { buildShowSetup } from "@/lib/studio/showSetup";

function clip(part: Partial<TimelineClip>): TimelineClip {
  return {
    id: part.id ?? "c1",
    formationId: "f1",
    start: 0,
    transition: 8,
    hold: 10,
    easing: "smooth",
    color: { r: 255, g: 255, b: 255 },
    effect: "solid",
    ...part,
  } as TimelineClip;
}

function project(part: Partial<ShowProject>): ShowProject {
  return {
    id: "p1",
    name: "test",
    droneCount: 50,
    formations: [],
    timeline: [],
    ...part,
  } as unknown as ShowProject;
}

function readiness(part: {
  report?: FullShowValidationReport | null;
  stale?: boolean;
  hasFlightSite?: boolean;
}): ShowReadinessModel {
  return buildShowReadiness({
    projectDirty: false,
    hasSavedProject: true,
    hasFlightSite: part.hasFlightSite ?? false,
    report: part.report ?? null,
    stale: part.stale ?? false,
  });
}

describe("buildShowSetup", () => {
  it("lists the ten guided steps in the industry authoring order", () => {
    const model = buildShowSetup({
      project: project({}),
      readiness: readiness({}),
      hasFlightSite: false,
    });
    expect(model.steps.map((s) => s.id)).toEqual([
      "SITE",
      "LAUNCH",
      "TAKEOFF",
      "FORMATIONS",
      "STORYBOARD",
      "TRANSITIONS",
      "LANDING",
      "SAFETY",
      "LIGHTS",
      "EXPORT",
    ]);
    expect(model.steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(model.totalCount).toBe(10);
  });

  it("points at the first unfinished step and counts finished ones", () => {
    const model = buildShowSetup({
      project: project({}),
      readiness: readiness({}),
      hasFlightSite: false,
    });
    expect(model.nextStep?.id).toBe("SITE");
    expect(model.doneCount).toBe(0);
    expect(model.headline).toContain("Step 1 of 10");
  });

  it("marks site, launch, take-off, formations, storyboard and landing from canonical project state", () => {
    const model = buildShowSetup({
      project: project({
        preShow: { enabled: true } as unknown as NonNullable<ShowProject["preShow"]>,
        formations: [{ id: "f1" } as ShowProject["formations"][number]],
        timeline: [
          clip({ id: "t", phase: "TAKEOFF" }),
          clip({ id: "s", phase: "SHOW" }),
          clip({ id: "l", phase: "LANDING" }),
        ],
      }),
      readiness: readiness({ hasFlightSite: true }),
      hasFlightSite: true,
    });
    const state = (id: string) => model.steps.find((s) => s.id === id)!.state;
    expect(state("SITE")).toBe("OK");
    expect(state("LAUNCH")).toBe("OK");
    expect(state("TAKEOFF")).toBe("OK");
    expect(state("FORMATIONS")).toBe("OK");
    expect(state("STORYBOARD")).toBe("OK");
    expect(state("LANDING")).toBe("OK");
  });

  it("warns when a show segment has no transition time", () => {
    const model = buildShowSetup({
      project: project({ timeline: [clip({ phase: "SHOW", transition: 0 })] }),
      readiness: readiness({}),
      hasFlightSite: false,
    });
    const transitions = model.steps.find((s) => s.id === "TRANSITIONS")!;
    expect(transitions.state).toBe("WARNING");
    expect(transitions.detail).toContain("no transition time");
  });

  it("blocks the safety step when the canonical report reports blocking issues", () => {
    const report = {
      analysisRevision: "rev-0123456789",
      issues: [{ severity: "error", message: "too fast" }],
      warnings: [],
      errors: [{ severity: "error", message: "too fast" }],
      geofence: null,
      exportReadiness: { status: "BLOCKED", blockers: ["too fast"], warnings: [] },
    } as unknown as FullShowValidationReport;
    const model = buildShowSetup({
      project: project({}),
      readiness: readiness({ report }),
      hasFlightSite: false,
    });
    const safety = model.steps.find((s) => s.id === "SAFETY")!;
    expect(safety.state).toBe("BLOCKED");
    expect(safety.action?.id).toBe("OPEN_BLOCKING_ISSUES");
    expect(model.steps.find((s) => s.id === "EXPORT")!.state).toBe("BLOCKED");
  });

  it("never claims a completed checklist authorises a flight", () => {
    const report = {
      analysisRevision: "rev-0123456789",
      issues: [],
      warnings: [],
      errors: [],
      geofence: {
        breaches: [],
        outsideCount: 0,
        marginCount: 0,
        ceilingCount: 0,
        minClearanceM: 10,
        minHeadroomM: 20,
        sampleCount: 100,
      },
      exportReadiness: { status: "READY", blockers: [], warnings: [] },
    } as unknown as FullShowValidationReport;
    const model = buildShowSetup({
      project: project({
        preShow: { enabled: true } as unknown as NonNullable<ShowProject["preShow"]>,
        formations: [{ id: "f1" } as ShowProject["formations"][number]],
        lighting: { schemaVersion: 1, effects: [{ id: "e1" }] } as unknown as NonNullable<
          ShowProject["lighting"]
        >,
        timeline: [
          clip({ id: "t", phase: "TAKEOFF" }),
          clip({ id: "s", phase: "SHOW" }),
          clip({ id: "l", phase: "LANDING" }),
        ],
      }),
      readiness: readiness({ report, hasFlightSite: true }),
      hasFlightSite: true,
    });
    expect(model.nextStep).toBeNull();
    expect(model.headline).toContain("does not authorise a flight");
  });
});
