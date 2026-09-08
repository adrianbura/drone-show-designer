import { describe, expect, it } from "vitest";

import { analyzeFullShow } from "../../show/fullshow";
import { createDemoProject } from "../../show/defaultProject";
import {
  FullShowAnalysisTaskError,
  startFullShowAnalysis,
} from "../fullShowAnalysis";

describe("full-show analysis task", () => {
  it("returns the canonical report and forwards canonical progress", async () => {
    const project = createDemoProject(12);
    const expected = analyzeFullShow(project, { sampleRate: 10 }).report;
    const progress: string[] = [];

    const task = startFullShowAnalysis(
      { project, options: { sampleRate: 10 } },
      (value) => progress.push(value.stage),
    );
    const report = await task.promise;

    expect(report.analysisRevision).toBe(expected.analysisRevision);
    expect(report.status).toBe(expected.status);
    const { validationRuntimeMs: _actualRuntime, ...actualMetrics } = report.metrics;
    const { validationRuntimeMs: _expectedRuntime, ...expectedMetrics } = expected.metrics;
    expect(actualMetrics).toEqual(expectedMetrics);
    expect(progress).toEqual([
      "preparing",
      "planningTransitions",
      "composingShow",
      "checkingConflicts",
      "validating",
      "buildingReport",
    ]);
  });

  it("rejects a task cancelled before the fallback calculation starts", async () => {
    const task = startFullShowAnalysis(
      { project: createDemoProject(12), options: { sampleRate: 10 } },
      () => undefined,
    );
    task.cancel();

    await expect(task.promise).rejects.toMatchObject<Partial<FullShowAnalysisTaskError>>({
      code: "ANALYSIS_CANCELLED",
    });
  });
});
