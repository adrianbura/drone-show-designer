/**
 * EXPORT / SOURCE-RECOVERY ISOLATION ACROSS PROJECT SWITCHES.
 *
 * A project switch must make it impossible for export authorization or recovered
 * bytes of project A to appear under project B. These tests read the canonical
 * authorities only: `evaluateExportEligibility` (computed export gate),
 * `buildOriginalEsspDownload` / `hasEsspSourceBytes` (source recovery),
 * `buildExportPreflight` (preflight presentation) and the store's single
 * adoption boundary.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildExportPreflight } from "../exportPreflight";
import { evaluateExportEligibility } from "../exportEligibility";
import {
  buildOriginalEsspDownload,
  hasEsspSourceBytes,
} from "../esspSourceRecovery";
import type { ReferenceTrajectoryLayer } from "@/lib/import/essp/native/types";
import type { FullShowValidationReport } from "@/lib/show/fullshow/types";

const STORE_SRC = readFileSync(join(process.cwd(), "src/lib/studio/store.tsx"), "utf8");

function readyReport(): FullShowValidationReport {
  return {
    analysisRevision: "rev-project-a",
    splice: null,
    safety: {
      worst: { minSeparation: 4, maxVelocity: 6, maxAcceleration: 3, maxYawRate: 0, maxAltitude: 80 },
      metrics: { maxJerk: 9 },
    },
    exportReadiness: { status: "READY", blockers: [], warnings: [] },
  } as unknown as FullShowValidationReport;
}

function bytes(text: string): string {
  // base64 of the ASCII payload — the verbatim imported file bytes.
  return Buffer.from(text, "ascii").toString("base64");
}

function layer(project: "A" | "B"): ReferenceTrajectoryLayer {
  return {
    importedAt: "2026-01-01T00:00:00.000Z",
    showHash: `hash-${project}`,
    drones: [
      {
        sourceId: `${project}-1`,
        numericSourceId: 1,
        sourceFile: `${project}-1.essp`,
        fileBase64: bytes(`payload-${project}-1`),
      },
      {
        sourceId: `${project}-2`,
        numericSourceId: 2,
        sourceFile: `${project}-2.essp`,
        fileBase64: bytes(`payload-${project}-2`),
      },
    ],
  } as unknown as ReferenceTrajectoryLayer;
}

describe("computed export after a project switch", () => {
  it("drops to NO_REPORT the moment the validation report is cleared", () => {
    const authorized = evaluateExportEligibility(readyReport(), false);
    expect(authorized.canExportComputedShow).toBe(true);

    // Adoption clears the derived report; nothing else changes.
    const afterSwitch = evaluateExportEligibility(null, false);
    expect(afterSwitch.canExportComputedShow).toBe(false);
    expect(afterSwitch.reason).toBe("NO_REPORT");
  });

  it("preflight of project B never inherits project A authorization", () => {
    const a = buildExportPreflight({
      droneCount: 20,
      showDuration: 100,
      report: readyReport(),
      stale: false,
      currentRevision: "rev-project-a",
      hasSourceFiles: true,
    });
    expect(a.status).toBe("READY");
    expect(a.canExportGenerated).toBe(true);
    expect(a.canRecoverSource).toBe(true);

    const b = buildExportPreflight({
      droneCount: 5,
      showDuration: 40,
      report: null,
      stale: false,
      currentRevision: "rev-project-b",
      hasSourceFiles: false,
    });
    expect(b.status).toBe("NOT_ANALYZED");
    expect(b.canExportGenerated).toBe(false);
    expect(b.canRecoverSource).toBe(false);
    expect(b.validationRevision).toBeNull();
    expect(b.droneCount).toBe(5);
    expect(b.metrics).toEqual([]);
    expect(b.needsValidation).toBe(true);
  });

  it("a stale report cannot authorize generated output", () => {
    const stale = buildExportPreflight({
      droneCount: 20,
      showDuration: 100,
      report: readyReport(),
      stale: true,
      currentRevision: "rev-project-b",
      hasSourceFiles: false,
    });
    expect(stale.status).toBe("STALE");
    expect(stale.canExportGenerated).toBe(false);
  });
});

describe("source recovery isolation", () => {
  it("returns only the bytes of the currently adopted layer", () => {
    const a = buildOriginalEsspDownload({ projectName: "Project A", layer: layer("A") });
    const b = buildOriginalEsspDownload({ projectName: "Project B", layer: layer("B") });

    expect(a.ok && b.ok).toBe(true);
    expect(a.files.map((f) => f.name)).toEqual(["A-1.essp", "A-2.essp"]);
    expect(b.files.map((f) => f.name)).toEqual(["B-1.essp", "B-2.essp"]);
    expect(b.referenceShowHash).toBe("hash-B");
    expect(b.manifest!.referenceShowHash).toBe("hash-B");

    const decoded = b.files.map((f) => Buffer.from(f.bytes).toString("ascii"));
    expect(decoded).toEqual(["payload-B-1", "payload-B-2"]);
    for (const text of decoded) expect(text).not.toContain("-A-");
  });

  it("has nothing to recover once the layer is cleared by adoption", () => {
    expect(hasEsspSourceBytes(layer("A"))).toBe(true);
    expect(hasEsspSourceBytes(null)).toBe(false);

    const authored = buildOriginalEsspDownload({ projectName: "Authored B", layer: null });
    expect(authored.ok).toBe(false);
    expect(authored.reason).toBe("NO_SOURCE");
    expect(authored.files).toEqual([]);
    expect(authored.zip).toBeNull();
    expect(authored.referenceShowHash).toBeNull();
  });

  it("stays independent of validation state", () => {
    // No report, no eligibility — recovery of verbatim imported bytes still works.
    expect(evaluateExportEligibility(null, false).canExportComputedShow).toBe(false);
    const recovered = buildOriginalEsspDownload({ projectName: "Imported B", layer: layer("B") });
    expect(recovered.ok).toBe(true);
    expect(recovered.manifest!.kind).toBe("SOURCE_RECOVERY");
  });
});

describe("adoption boundary atomicity", () => {
  it("rehydrates the reference layer before touching any state", () => {
    const adopt = STORE_SRC.slice(STORE_SRC.indexOf("const adoptProject = useCallback("));
    const rehydrate = adopt.indexOf("referenceShowFromLayer(restoredLayer)");
    const firstMutation = adopt.indexOf("setProject(next);");
    expect(rehydrate).toBeGreaterThan(-1);
    expect(rehydrate).toBeLessThan(firstMutation);
  });

  it("aborts the adoption instead of half-replacing the open project", () => {
    expect(STORE_SRC).toContain('return {\n          ok: false,');
    expect(STORE_SRC).toContain("if (!outcome.ok) {");
  });

  it("always installs the adopted layer, including null", () => {
    expect(STORE_SRC).toContain("setReferenceLayer(restoredShow ? restoredLayer : null);");
    expect(STORE_SRC).toContain("referenceLayer: file.referenceLayer ?? null");
  });
});
