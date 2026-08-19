import { describe, expect, it } from "vitest";

import { createDemoProject } from "../../show/defaultProject";
import { analyzeFullShow } from "../../show/fullshow";
import { DEFAULT_PRE_SHOW, patchPreShowConfig } from "../../show/preshow";
import { toGenericShowJson } from "../export";

describe("computed export pre-show provenance", () => {
  it("prefers the pre-show report embedded in the fresh full-show validation", () => {
    const base = createDemoProject(12);
    const project = {
      ...base,
      preShow: patchPreShowConfig(DEFAULT_PRE_SHOW, { enabled: true }),
    };
    const { plan, report } = analyzeFullShow(project, { sampleRate: 10 });
    expect(plan.preShow).not.toBeNull();
    expect(report.preShow).not.toBeNull();

    const exported = JSON.parse(
      toGenericShowJson({
        project,
        plan: plan.showPlan,
        set: plan.trajectorySet,
        fullShow: report,
        fullShowStale: false,
        // Deliberately omit the standalone Launch-panel report and mark it stale.
        // A fresh full-show report already validated the exact composed pre-show.
        preShowReport: null,
        preShowStale: true,
      }),
    );

    expect(exported.preShow.preShowValidation.status).toBe(report.preShow!.status);
    expect(exported.preShow.preShowValidation.stale).toBe(false);
    expect(exported.preShow.preShowValidation.analysisRevision).toBe(report.analysisRevision);
    expect(exported.preShow.preShowValidation.engineVersion).toBe(report.preShow!.engineVersion);
  });
});
