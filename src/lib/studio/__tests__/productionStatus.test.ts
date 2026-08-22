import { describe, expect, it } from "vitest";

import {
  authorityLabel,
  buildProductionStatus,
} from "@/lib/studio/productionStatus";
import type { FullShowValidationReport } from "@/lib/show/fullshow/types";

function report(
  status: "READY" | "READY_WITH_WARNINGS" | "BLOCKED",
  blockers: string[] = [],
  warnings: string[] = [],
): FullShowValidationReport {
  return {
    exportReadiness: { status, blockers, warnings },
  } as unknown as FullShowValidationReport;
}

describe("dominant production readiness", () => {
  it("reports NOT_ANALYZED and asks for validation when no report exists", () => {
    const model = buildProductionStatus(null, false);
    expect(model.readiness).toBe("NOT_ANALYZED");
    expect(model.nextAction).toBe("RUN_VALIDATION");
    expect(model.canExport).toBe(false);
  });

  it("reports STALE when the show changed after validation", () => {
    const model = buildProductionStatus(report("READY"), true);
    expect(model.readiness).toBe("STALE");
    expect(model.nextAction).toBe("RUN_VALIDATION");
    expect(model.canExport).toBe(false);
  });

  it("reports BLOCKED with the canonical blockers and no export", () => {
    const model = buildProductionStatus(report("BLOCKED", ["separation"]), false);
    expect(model.readiness).toBe("BLOCKED");
    expect(model.nextAction).toBe("REVIEW_BLOCKERS");
    expect(model.blockers).toEqual(["separation"]);
    expect(model.canExport).toBe(false);
  });

  it("distinguishes READY_WITH_WARNINGS from READY and allows export for both", () => {
    const warn = buildProductionStatus(report("READY_WITH_WARNINGS", [], ["battery"]), false);
    const ready = buildProductionStatus(report("READY"), false);
    expect(warn.readiness).toBe("READY_WITH_WARNINGS");
    expect(warn.warnings).toEqual(["battery"]);
    expect(warn.canExport).toBe(true);
    expect(ready.readiness).toBe("READY");
    expect(ready.canExport).toBe(true);
    expect(warn.label).not.toBe(ready.label);
  });

  it("mirrors canonical eligibility rather than deriving a second gate", () => {
    const model = buildProductionStatus(report("BLOCKED", ["x"]), false);
    expect(model.canExport).toBe(model.eligibility.canExportComputedShow);
  });
});

describe("authority labels", () => {
  it("labels reference-only, planner-only and mixed shows", () => {
    expect(authorityLabel({ referenceIntervalCount: 3, plannerIntervalCount: 0 })?.label).toBe(
      "REFERENCE",
    );
    expect(authorityLabel({ referenceIntervalCount: 0, plannerIntervalCount: 4 })?.label).toBe(
      "PLANNER",
    );
    expect(authorityLabel({ referenceIntervalCount: 2, plannerIntervalCount: 1 })?.label).toBe(
      "MIXED",
    );
    expect(authorityLabel(null)).toBeNull();
    expect(authorityLabel({ referenceIntervalCount: 0, plannerIntervalCount: 0 })).toBeNull();
  });
});
