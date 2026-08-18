import { describe, expect, it } from "vitest";

import { evaluateExportEligibility } from "../exportEligibility";
import type {
  ExportReadinessStatus,
  FullShowValidationReport,
} from "@/lib/show/fullshow/types";

function report(
  status: ExportReadinessStatus,
  blockers: string[] = [],
  warnings: string[] = [],
): FullShowValidationReport {
  return {
    exportReadiness: { status, blockers, warnings },
  } as unknown as FullShowValidationReport;
}

describe("evaluateExportEligibility", () => {
  it("no report -> computed=false, project=true", () => {
    const e = evaluateExportEligibility(null, false);
    expect(e.canExportComputedShow).toBe(false);
    expect(e.canExportProjectFile).toBe(true);
    expect(e.reason).toBe("NO_REPORT");
  });

  it("READY + fresh -> computed=true", () => {
    const e = evaluateExportEligibility(report("READY"), false);
    expect(e.canExportComputedShow).toBe(true);
    expect(e.reason).toBe("OK");
  });

  it("READY_WITH_WARNINGS + fresh -> computed=true with warnings", () => {
    const e = evaluateExportEligibility(
      report("READY_WITH_WARNINGS", [], ["min separation close to limit"]),
      false,
    );
    expect(e.canExportComputedShow).toBe(true);
    expect(e.reason).toBe("OK_WITH_WARNINGS");
    expect(e.warnings).toHaveLength(1);
  });

  it("BLOCKED + fresh -> computed=false with blockers", () => {
    const e = evaluateExportEligibility(report("BLOCKED", ["conflict at 12.0s"]), false);
    expect(e.canExportComputedShow).toBe(false);
    expect(e.reason).toBe("BLOCKED");
    expect(e.blockers).toEqual(["conflict at 12.0s"]);
  });

  it("READY + stale -> computed=false", () => {
    const e = evaluateExportEligibility(report("READY"), true);
    expect(e.canExportComputedShow).toBe(false);
    expect(e.reason).toBe("STALE");
  });

  it("READY_WITH_WARNINGS + stale -> computed=false", () => {
    const e = evaluateExportEligibility(report("READY_WITH_WARNINGS"), true);
    expect(e.canExportComputedShow).toBe(false);
    expect(e.reason).toBe("STALE");
    expect(e.canExportProjectFile).toBe(true);
  });

  it("project file export is always available", () => {
    for (const [rep, stale] of [
      [null, false],
      [report("BLOCKED", ["x"]), false],
      [report("READY"), true],
    ] as const) {
      expect(evaluateExportEligibility(rep, stale).canExportProjectFile).toBe(true);
    }
  });
});
