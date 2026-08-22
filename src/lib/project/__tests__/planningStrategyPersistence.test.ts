/**
 * ASSIGNMENT STRATEGY PERSISTENCE SEMANTICS.
 *
 * Decision: `identity` is an INTERNAL planner strategy, not a project setting.
 * It is normalised to the documented canonical replacement BEFORE the file is
 * written, so what the saved file states is exactly what reopening restores —
 * never a silent change discovered only on reopen.
 */
import { describe, expect, it } from "vitest";

import { createDefaultProject } from "@/lib/show/defaultProject";
import { SELECTABLE_ASSIGNMENT_STRATEGIES } from "@/lib/show/assignment";
import {
  NON_AUTHORABLE_STRATEGY_REPLACEMENT,
  normalizePlanningForSave,
  parseProjectFile,
  projectFileToJson,
  serializeProject,
} from "@/lib/project";
import type { AssignmentStrategyId } from "@/lib/show/assignment";

const project = createDefaultProject(20);

function roundTrip(strategy: AssignmentStrategyId) {
  const file = serializeProject(project, {
    planning: { assignmentStrategy: strategy, transitionOverrides: {} },
  });
  const parsed = parseProjectFile(projectFileToJson(file));
  return { file, parsed };
}

describe("assignment strategy save/reopen semantics", () => {
  it("normalises the internal identity strategy at SAVE time, not at reopen", () => {
    const { file, parsed } = roundTrip("identity");
    expect(file.planning?.assignmentStrategy).toBe(NON_AUTHORABLE_STRATEGY_REPLACEMENT);
    expect(parsed.planning?.assignmentStrategy).toBe(NON_AUTHORABLE_STRATEGY_REPLACEMENT);
  });

  it("keeps the documented replacement user-selectable", () => {
    expect(SELECTABLE_ASSIGNMENT_STRATEGIES).toContain(NON_AUTHORABLE_STRATEGY_REPLACEMENT);
  });

  it("preserves every authorable strategy byte-for-byte through save/reopen", () => {
    for (const strategy of SELECTABLE_ASSIGNMENT_STRATEGIES) {
      const { file, parsed } = roundTrip(strategy);
      expect(file.planning?.assignmentStrategy).toBe(strategy);
      expect(parsed.planning?.assignmentStrategy).toBe(strategy);
    }
  });

  it("is deterministic and idempotent", () => {
    const once = normalizePlanningForSave({
      assignmentStrategy: "identity",
      transitionOverrides: {},
    });
    expect(normalizePlanningForSave(once)).toEqual(once);
  });
});
