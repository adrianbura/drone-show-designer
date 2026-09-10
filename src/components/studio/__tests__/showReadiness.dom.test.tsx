// @vitest-environment jsdom
/**
 * Show readiness is a PROJECTION of canonical state: these tests fix fake
 * canonical reports and prove the UI only reports what they already say.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import FullShowIssueList from "@/components/studio/FullShowIssueList";
import ShowReadinessView from "@/components/studio/ShowReadinessView";
import { buildShowReadiness } from "@/lib/adapters/showReadiness";
import type { FullShowIssue, FullShowValidationReport } from "@/lib/show/fullshow/types";
import type { GeofenceScanResult } from "@/lib/show/geo";

afterEach(cleanup);

function scan(part: Partial<GeofenceScanResult>): GeofenceScanResult {
  return {
    breaches: [],
    outsideCount: 0,
    marginCount: 0,
    ceilingCount: 0,
    minClearanceM: 12,
    minHeadroomM: 30,
    sampleCount: 1000,
    ...part,
  };
}

function report(part: Partial<FullShowValidationReport>): FullShowValidationReport {
  return {
    analysisRevision: "rev-0123456789",
    issues: [],
    warnings: [],
    errors: [],
    geofence: null,
    exportReadiness: { status: "READY", blockers: [], warnings: [] },
    ...part,
  } as unknown as FullShowValidationReport;
}

function view(
  input: Parameters<typeof buildShowReadiness>[0],
  extras: { busy?: boolean; onAction?: (a: string) => void } = {},
) {
  const onAction = extras.onAction ?? vi.fn();
  render(
    <ShowReadinessView
      model={buildShowReadiness(input)}
      {...(extras.busy === undefined ? {} : { busy: extras.busy })}
      onAction={onAction as never}
    />,
  );
  return onAction;
}

const base = {
  projectDirty: false,
  hasSavedProject: true,
  hasFlightSite: true,
  stale: false,
};

describe("Show readiness", () => {
  it("offers Analyze full show when no report exists", () => {
    view({ ...base, report: null });
    expect(screen.getByTestId("readiness-primary-action").getAttribute("data-action")).toBe(
      "ANALYZE_FULL_SHOW",
    );
    expect(screen.getByTestId("readiness-item-ANALYSIS").getAttribute("data-state")).toBe("TODO");
    expect(screen.queryByTestId("readiness-action-HANDOFF")).toBeNull();
  });

  it("a stale report cannot unlock the simulator handoff", () => {
    view({ ...base, stale: true, report: report({}) });
    expect(screen.getByTestId("readiness-item-HANDOFF").getAttribute("data-state")).not.toBe("OK");
    expect(screen.queryByTestId("readiness-action-HANDOFF")).toBeNull();
    expect(screen.getByTestId("readiness-status").getAttribute("data-status")).toBe("BLOCKED");
    expect(screen.getByTestId("readiness-item-TRAJECTORY").getAttribute("data-state")).toBe("TODO");
    expect(screen.getByTestId("readiness-item-GEOFENCE").getAttribute("data-state")).toBe("TODO");
    expect(screen.queryByTestId("readiness-geofence-facts")).toBeNull();
  });

  it("does not call a never-saved project saved merely because it is clean", () => {
    view({ ...base, hasSavedProject: false, report: null });
    expect(screen.getByTestId("readiness-item-SAVED").getAttribute("data-state")).toBe("TODO");
    expect(screen.getByTestId("readiness-action-SAVED")).toBeTruthy();
  });

  it("a geofence breach reads BLOCKED with the canonical numbers", () => {
    view({
      ...base,
      report: report({
        geofence: scan({ outsideCount: 4, minClearanceM: -3.25 }),
        exportReadiness: { status: "BLOCKED", blockers: ["geofence"], warnings: [] },
      }),
    });
    expect(screen.getByTestId("readiness-item-GEOFENCE").getAttribute("data-state")).toBe(
      "BLOCKED",
    );
    expect(screen.getByTestId("readiness-status").getAttribute("data-status")).toBe("BLOCKED");
    expect(screen.getByTestId("readiness-geofence-facts").textContent).toContain("-3.25 m");
  });

  it("a margin-only geofence reads READY_WITH_WARNINGS", () => {
    view({
      ...base,
      report: report({
        geofence: scan({ marginCount: 6, minClearanceM: 1.5 }),
        exportReadiness: { status: "READY_WITH_WARNINGS", blockers: [], warnings: ["margin"] },
      }),
    });
    expect(screen.getByTestId("readiness-status").getAttribute("data-status")).toBe(
      "READY_WITH_WARNINGS",
    );
    expect(screen.getByTestId("readiness-action-HANDOFF").getAttribute("data-action")).toBe(
      "EXPORT_SIMULATOR_PACKAGE",
    );
  });

  it("never mutates or acts while an analysis is running", () => {
    const onAction = view({ ...base, report: null }, { busy: true });
    fireEvent.click(screen.getByTestId("readiness-primary-action"));
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("Full-show issue list", () => {
  const geofenceIssue: FullShowIssue = {
    id: "gf-1",
    severity: "error",
    category: "geofence",
    code: "GEOFENCE_OUTSIDE",
    message: "drone-3 leaves the authored GPS perimeter",
    time: 42.5,
    clipId: "clip-1",
    droneIds: ["drone-3"],
    droneIndices: [2],
    value: -1.5,
    limit: 5,
  };
  const conflictIssue: FullShowIssue = {
    id: "cf-1",
    severity: "warning",
    category: "conflict",
    code: "PROXIMITY",
    message: "close pass",
    time: 10,
  };

  it("groups geofence findings and seeks to a clicked issue", () => {
    const onFocus = vi.fn();
    render(
      <FullShowIssueList
        issues={[geofenceIssue, conflictIssue]}
        clipLabel={() => "Heart"}
        onFocus={onFocus}
      />,
    );
    expect(screen.getByTestId("issue-group-geofence")).toBeTruthy();
    expect(screen.getByTestId("issue-group-other")).toBeTruthy();
    const row = screen.getByTestId("issue-row-gf-1");
    expect(row.textContent).toContain("drone drone-3");
    expect(row.textContent).toContain("Heart");
    expect(row.textContent).toContain("-1.50");
    fireEvent.click(row);
    expect(onFocus).toHaveBeenCalledWith(geofenceIssue);
    expect(onFocus.mock.calls[0]![0].time).toBe(42.5);
  });
});
