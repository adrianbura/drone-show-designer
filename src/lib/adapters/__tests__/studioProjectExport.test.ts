import { describe, expect, it } from "vitest";

import { parseProjectFile } from "@/lib/project";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { toStudioProject } from "../export";

describe("Studio project export", () => {
  it("uses the canonical project envelope and can be reopened", () => {
    const project = createDefaultProject(137);
    const text = toStudioProject(project);
    const raw = JSON.parse(text) as { kind?: string; schemaVersion?: number };

    expect(raw.kind).toBe("DroneShowStudioProject");
    expect(raw.schemaVersion).toBe(2);

    const reopened = parseProjectFile(text);
    expect(reopened.project.droneCount).toBe(137);
    expect(reopened.project.id).toBe(project.id);
    expect(reopened.project.timeline).toEqual(project.timeline);
  });
});
