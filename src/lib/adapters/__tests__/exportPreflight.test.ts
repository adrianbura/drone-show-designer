import { describe, expect, it } from "vitest";

import { buildExportPreflight, type ExportPreflightInput } from "../exportPreflight";
import { evaluateExportEligibility } from "../exportEligibility";
import type {
  ExportReadinessStatus,
  FullShowValidationReport,
} from "@/lib/show/fullshow/types";

function report(
  status: ExportReadinessStatus,
  blockers: string[] = [],
  warnings: string[] = [],
  extra: Partial<FullShowValidationReport> = {},
): FullShowValidationReport {
  return {
    analysisRevision: "rev-abcdef012345",
    splice: null,
    safety: {
      worst: { minSeparation: 4.2, maxVelocity: 6.1, maxAcceleration: 3.4, maxYawRate: 0, maxAltitude: 80 },
      metrics: { maxJerk: 9.5 },
    },
    exportReadiness: { status, blockers, warnings },
    ...extra,
  } as unknown as FullShowValidationReport;
}

const base: ExportPreflightInput = {
  droneCount: 20,
  showDuration: 120,
  report: null,
  stale: false,
  currentRevision: "rev-current00",
  hasSourceFiles: false,
};

describe("buildExportPreflight — status mapping", () => {
  it("no report -> NOT_ANALYZED", () => {
    const m = buildExportPreflight(base);
    expect(m.status).toBe("NOT_ANALYZED");
    expect(m.canExportGenerated).toBe(false);
    expect(m.generatedBlockedReason).toContain("Run Full-Show Validation");
    expect(m.needsValidation).toBe(true);
  });

  it("READY -> READY and enabled", () => {
    const m = buildExportPreflight({ ...base, report: report("READY") });
    expect(m.status).toBe("READY");
    expect(m.canExportGenerated).toBe(true);
    expect(m.generatedBlockedReason).toBeNull();
    expect(m.needsValidation).toBe(false);
  });

  it("READY_WITH_WARNINGS -> WARNING, still enabled per canonical policy", () => {
    const m = buildExportPreflight({
      ...base,
      report: report("READY_WITH_WARNINGS", [], ["close to separation limit"]),
    });
    expect(m.status).toBe("WARNING");
    expect(m.canExportGenerated).toBe(true);
    expect(m.warnings).toEqual(["close to separation limit"]);
  });

  it("BLOCKED -> BLOCKED, disabled, blockers surfaced", () => {
    const m = buildExportPreflight({
      ...base,
      report: report("BLOCKED", ["conflict at 12.0s"]),
    });
    expect(m.status).toBe("BLOCKED");
    expect(m.canExportGenerated).toBe(false);
    expect(m.blockers).toEqual(["conflict at 12.0s"]);
  });

  it("stale beats READY -> STALE and disabled", () => {
    const m = buildExportPreflight({ ...base, report: report("READY"), stale: true });
    expect(m.status).toBe("STALE");
    expect(m.canExportGenerated).toBe(false);
    expect(m.revisionFresh).toBe(false);
    expect(m.needsValidation).toBe(true);
  });

  it("never reports READY while canonical blockers exist", () => {
    const m = buildExportPreflight({ ...base, report: report("BLOCKED", ["x"]) });
    expect(m.status).not.toBe("READY");
  });

  it("action enablement mirrors canonical eligibility exactly", () => {
    for (const stale of [false, true]) {
      for (const status of ["READY", "READY_WITH_WARNINGS", "BLOCKED"] as ExportReadinessStatus[]) {
        const rep = report(status);
        const m = buildExportPreflight({ ...base, report: rep, stale });
        expect(m.canExportGenerated).toBe(
          evaluateExportEligibility(rep, stale).canExportComputedShow,
        );
      }
    }
  });
});

describe("buildExportPreflight — validation summary", () => {
  it("exposes canonical metrics without recomputation", () => {
    const m = buildExportPreflight({ ...base, report: report("READY") });
    expect(m.metrics.map((x) => x.label)).toEqual([
      "min separation",
      "peak speed",
      "peak acceleration",
      "peak jerk",
    ]);
    expect(m.metrics[0]!.value).toBe("4.20 m");
    expect(m.validationRevision).toBe("rev-abcdef012345");
  });

  it("splice status follows the canonical splice report", () => {
    expect(buildExportPreflight({ ...base, report: report("READY") }).spliceStatus).toBe(
      "NOT_APPLICABLE",
    );
    const ok = report("READY", [], [], { splice: { ok: true } } as never);
    expect(buildExportPreflight({ ...base, report: ok }).spliceStatus).toBe("OK");
    const bad = report("READY", [], [], { splice: { ok: false } } as never);
    expect(buildExportPreflight({ ...base, report: bad }).spliceStatus).toBe("DISCONTINUOUS");
  });
});

describe("buildExportPreflight — profile, mode, ownership", () => {
  it("authored show -> experimental profile, observed clocks, SAMPLED", () => {
    const m = buildExportPreflight({ ...base, report: report("READY") });
    expect(m.profileStatus).toBe("EXPERIMENTAL_PROFILE");
    expect(m.positionRateHz).toBe(8);
    expect(m.rgbRateHz).toBe(12);
    expect(m.outputMode).toBe("SAMPLED");
    expect(m.ownership).toBeNull();
  });

  it("imported untouched show -> source profile + PRESERVED PAYLOAD + reference only", () => {
    const m = buildExportPreflight({
      ...base,
      report: report("READY"),
      referenceSource: { positionRateHz: 10, rgbRateHz: 25, droneFileCount: 20 },
      ownership: {
        referenceIntervalCount: 6,
        plannerIntervalCount: 0,
        referenceSeconds: 120,
        plannerSeconds: 0,
      },
      hasSourceFiles: true,
    });
    expect(m.profileStatus).toBe("SOURCE_PROFILE");
    expect(m.positionRateHz).toBe(10);
    expect(m.rgbRateHz).toBe(25);
    expect(m.outputMode).toBe("PRESERVED_PAYLOAD");
    expect(m.ownership).toMatchObject({
      authority: "REFERENCE_ONLY",
      referenceIntervals: 6,
      plannerIntervals: 0,
    });
  });

  it("imported + edited show -> MIXED AUTHORITY and SAMPLED", () => {
    const m = buildExportPreflight({
      ...base,
      report: report("READY"),
      referenceSource: { positionRateHz: 10, rgbRateHz: 25, droneFileCount: 20 },
      ownership: {
        referenceIntervalCount: 4,
        plannerIntervalCount: 2,
        referenceSeconds: 90,
        plannerSeconds: 30,
      },
      hasSourceFiles: true,
    });
    expect(m.ownership?.authority).toBe("MIXED_AUTHORITY");
    expect(m.outputMode).toBe("SAMPLED");
    expect(m.profileStatus).toBe("SOURCE_PROFILE");
  });

  it("fleet mismatch cannot claim PRESERVED PAYLOAD", () => {
    const m = buildExportPreflight({
      ...base,
      droneCount: 21,
      report: report("READY"),
      referenceSource: { positionRateHz: 10, rgbRateHz: 25, droneFileCount: 20 },
      ownership: {
        referenceIntervalCount: 6,
        plannerIntervalCount: 0,
        referenceSeconds: 120,
        plannerSeconds: 0,
      },
      hasSourceFiles: true,
    });
    expect(m.outputMode).toBe("SAMPLED");
  });
});

describe("buildExportPreflight — generated vs source separation", () => {
  it("source recovery stays available while generated output is blocked", () => {
    const m = buildExportPreflight({
      ...base,
      report: report("BLOCKED", ["conflict"]),
      hasSourceFiles: true,
    });
    expect(m.canExportGenerated).toBe(false);
    expect(m.canRecoverSource).toBe(true);
  });

  it("source recovery hidden when no original bytes exist", () => {
    expect(buildExportPreflight({ ...base, report: report("READY") }).canRecoverSource).toBe(false);
  });

  it("no READY/SAFE wording is attached to source recovery flags", () => {
    const m = buildExportPreflight({ ...base, report: report("READY"), hasSourceFiles: true });
    expect(Object.keys(m)).toContain("canRecoverSource");
    expect(m.statusDetail).not.toMatch(/imported files/i);
  });
});
