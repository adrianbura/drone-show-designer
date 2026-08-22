/**
 * PRACTICAL SCALE ACCEPTANCE — 200 drones (default) and 500 drones (opt-in).
 *
 * Measures the REAL production pipeline: authoring -> planning -> full-show
 * validation -> serialization -> reopen -> generated ESSP package. Nothing is
 * relaxed for speed: canonical sample rate, safety, conflict detection and
 * validation stages are used exactly as in the studio.
 *
 * Timings are REPORTED, not asserted: there is no documented performance target
 * in this repository, and a machine-dependent threshold would be a false gate.
 *
 * The 500-drone run is expensive; enable it with
 *   RUN_500_DRONE_ACCEPTANCE=1 bunx vitest run productionScaleAcceptance
 */
import { describe, expect, it } from "vitest";

import { buildEsspExportPackage } from "@/lib/adapters/esspExport";
import { analyzeFullShow } from "@/lib/show/fullshow";
import type { FullShowValidationReport } from "@/lib/show/fullshow/types";
import { parseProjectFile, projectFileToJson, serializeProject } from "@/lib/project";
import type { ShowProject } from "@/lib/show/types";

import {
  ACCEPTANCE_STRATEGY,
  AUTHORED_STRATEGY,
  FIXED_GENERATED_AT,
  authoredProductionProject,
  planAuthored,
  planFor,
  validate,
  validateAuthored,
} from "./support/productionFixtures";

const SAMPLE_RATE = 8;
const RUN_500 = process.env['RUN_500_DRONE_ACCEPTANCE'] === "1";

const ms = (started: number) => Math.round(performance.now() - started);

interface ScaleMeasurement {
  readonly fleet: number;
  readonly constructMs: number;
  readonly planMs: number;
  readonly validateMs: number;
  readonly stages: readonly { stage: string; ms: number }[];
  readonly serializeMs: number;
  readonly projectFileBytes: number;
  readonly reopenMs: number;
  readonly exportMs: number;
  readonly zipBytes: number;
  readonly status: string;
  readonly report: FullShowValidationReport;
  readonly project: ShowProject;
}

/** Drops measured wall-clock fields, which are inherently non-deterministic. */
function withoutRuntime(metrics: FullShowValidationReport["metrics"]) {
  const { validationRuntimeMs: _ignored, ...rest } = metrics as Record<string, unknown> & {
    validationRuntimeMs?: number;
  };
  return rest;
}

function measure(fleet: number): ScaleMeasurement {
  let t = performance.now();
  const project = authoredProductionProject(fleet);
  const constructMs = ms(t);

  t = performance.now();
  const plan = planAuthored(project);
  const planMs = ms(t);

  t = performance.now();
  const { report } = analyzeFullShow(project, {
    sampleRate: SAMPLE_RATE,
    assignmentStrategy: AUTHORED_STRATEGY,
  });
  const validateMs = ms(t);

  t = performance.now();
  const json = projectFileToJson(
    serializeProject(project, {
      planning: { assignmentStrategy: AUTHORED_STRATEGY, transitionOverrides: {}, transitionDesigns: {} },
      savedAt: FIXED_GENERATED_AT,
    }),
  );
  const serializeMs = ms(t);

  t = performance.now();
  const reopened = parseProjectFile(json).project;
  const reopenMs = ms(t);

  t = performance.now();
  const result = buildEsspExportPackage({
    project,
    plan,
    fullShow: report,
    generatedAt: FIXED_GENERATED_AT,
  });
  const exportMs = ms(t);
  expect(result.ok).toBe(true);
  expect(reopened.droneCount).toBe(fleet);

  return {
    fleet,
    constructMs,
    planMs,
    validateMs,
    stages: report.stages.map((s) => ({ stage: s.stage, ms: Math.round(s.ms) })),
    serializeMs,
    projectFileBytes: new TextEncoder().encode(json).length,
    reopenMs,
    exportMs,
    zipBytes: result.zip!.byteLength,
    status: report.exportReadiness.status,
    report,
    project,
  };
}

function log(m: ScaleMeasurement): void {
  // Reported measurements — the acceptance record for this pass.
   
  console.info(
    `[scale ${m.fleet}] construct=${m.constructMs}ms plan=${m.planMs}ms validate=${m.validateMs}ms ` +
      `serialize=${m.serializeMs}ms reopen=${m.reopenMs}ms export=${m.exportMs}ms ` +
      `projectFile=${(m.projectFileBytes / 1024).toFixed(1)}KiB zip=${(m.zipBytes / 1024).toFixed(1)}KiB ` +
      `status=${m.status} stages=${m.stages.map((s) => `${s.stage}:${s.ms}ms`).join(" ")}`,
  );
}

describe("practical scale — 200 drones", () => {
  const measurement = measure(200);

  it("completes the whole production workflow", () => {
    log(measurement);
    expect(measurement.report.droneCount).toBe(200);
    expect(measurement.report.sampleRate).toBe(SAMPLE_RATE);
    expect(measurement.stages.length).toBeGreaterThan(0);
    expect(measurement.projectFileBytes).toBeGreaterThan(0);
    expect(measurement.zipBytes).toBeGreaterThan(0);
    // The authored fixture is a genuinely flyable show: the gate passes on the
    // REAL report, not a forced one.
    expect(["READY", "READY_WITH_WARNINGS"]).toContain(measurement.status);
  }, 900_000);

  it("is deterministic across two identical runs", () => {
    const project = measurement.project;
    const a = validateAuthored(project, SAMPLE_RATE);
    const b = validateAuthored(project, SAMPLE_RATE);
    expect(a.exportReadiness).toEqual(b.exportReadiness);
    expect(a.conflicts.conflicts.length).toBe(b.conflicts.conflicts.length);
    expect(a.safety.worst).toEqual(b.safety.worst);
    // Wall-clock measurements are the only permitted run-to-run difference.
    expect(withoutRuntime(a.metrics)).toEqual(withoutRuntime(b.metrics));

    const first = buildEsspExportPackage({
      project,
      plan: planAuthored(project),
      fullShow: a,
      generatedAt: FIXED_GENERATED_AT,
    });
    const second = buildEsspExportPackage({
      project,
      plan: planAuthored(project),
      fullShow: b,
      generatedAt: FIXED_GENERATED_AT,
    });
    expect(second.manifest).toEqual(first.manifest);
    expect(Array.from(second.zip!)).toEqual(Array.from(first.zip!));
  }, 900_000);
});

describe.skipIf(!RUN_500)("practical scale — 500 drones (opt-in)", () => {
  it("completes the whole production workflow at 500 drones", () => {
    const measurement = measure(500);
    log(measurement);
    expect(measurement.report.droneCount).toBe(500);
    expect(measurement.zipBytes).toBeGreaterThan(0);
  }, 1_800_000);
});
