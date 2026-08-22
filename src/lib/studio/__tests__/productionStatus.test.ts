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

describe("status mirrors canonical authority for every state", () => {
  const cases: { model: ReturnType<typeof buildProductionStatus>; expected: string }[] = [
    { model: buildProductionStatus(null, false), expected: "NOT_ANALYZED" },
    { model: buildProductionStatus(report("READY"), true), expected: "STALE" },
    { model: buildProductionStatus(report("BLOCKED", ["a"]), false), expected: "BLOCKED" },
    {
      model: buildProductionStatus(report("READY_WITH_WARNINGS", [], ["w"]), false),
      expected: "READY_WITH_WARNINGS",
    },
    { model: buildProductionStatus(report("READY"), false), expected: "READY" },
  ];

  it("never diverges from evaluateExportEligibility", () => {
    for (const { model, expected } of cases) {
      expect(model.readiness).toBe(expected);
      expect(model.canExport).toBe(model.eligibility.canExportComputedShow);
      expect(model.blockers).toEqual(model.eligibility.blockers);
      expect(model.warnings).toEqual(model.eligibility.warnings);
    }
  });

  it("only allows export from READY or READY_WITH_WARNINGS", () => {
    for (const { model, expected } of cases) {
      expect(model.canExport).toBe(expected === "READY" || expected === "READY_WITH_WARNINGS");
    }
  });

  it("makes validation the next action whenever there is no fresh report", () => {
    for (const { model, expected } of cases) {
      if (expected === "NOT_ANALYZED" || expected === "STALE") {
        expect(model.nextAction).toBe("RUN_VALIDATION");
        expect(model.nextActionLabel).toMatch(/Full-Show Validation/);
      }
    }
  });

  it("makes no certification claim in READY wording", () => {
    const ready = buildProductionStatus(report("READY"), false);
    expect(ready.detail).toMatch(/not a real-world safety guarantee/i);
    expect(ready.detail).not.toMatch(/certified/i);
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
