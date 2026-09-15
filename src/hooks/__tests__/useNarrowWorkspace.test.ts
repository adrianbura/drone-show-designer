import { describe, expect, it } from "vitest";

import { workspaceMountPlan } from "../useNarrowWorkspace";

describe("workspace mount plan", () => {
  it.each([
    { inspectorStacked: false, leftPanelStacked: false },
    { inspectorStacked: true, leftPanelStacked: false },
    { inspectorStacked: true, leftPanelStacked: true },
  ])("mounts exactly one presentation of each surface", (input) => {
    const plan = workspaceMountPlan(input.inspectorStacked, input.leftPanelStacked);

    expect(Number(plan.dockedInspector) + Number(plan.stackedInspector)).toBe(1);
    expect(Number(plan.dockedLeftPanel) + Number(plan.stackedLeftPanel)).toBe(1);
  });
});
