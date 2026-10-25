import { describe, expect, it } from "vitest";
import { checkAgentPlan, type AgentCapability } from "./planSafetyGate";

const capabilities: AgentCapability[] = [
  {
    id: "rotate",
    enabled: true,
    requiresSelection: true,
    requiresPreview: true,
    reversible: true,
    arguments: { degrees: "number" },
  },
  {
    id: "recolor",
    enabled: true,
    requiresSelection: true,
    requiresPreview: true,
    reversible: true,
    arguments: { color: "string" },
  },
  {
    id: "export_show",
    enabled: false,
    requiresSelection: false,
    requiresPreview: true,
    reversible: false,
    arguments: {},
  },
];

describe("untrusted model plan gate", () => {
  it("accepts a typed two-step plan and requests preview", () => {
    expect(
      checkAgentPlan(
        {
          operations: [
            { tool: "rotate", args: { degrees: 20 } },
            { tool: "recolor", args: { color: "gold" } },
          ],
        },
        capabilities,
        "scene-1",
      ),
    ).toMatchObject({ ok: true, requiresPreview: true });
  });
  it("refuses hallucinated tools", () => {
    expect(
      checkAgentPlan(
        { operations: [{ tool: "delete_all_drones", args: {} }] },
        capabilities,
        "scene-1",
      ).ok,
    ).toBe(false);
  });
  it("refuses disabled operations", () => {
    expect(
      checkAgentPlan({ operations: [{ tool: "export_show", args: {} }] }, capabilities, "scene-1")
        .ok,
    ).toBe(false);
  });
  it("requires an unambiguous selected scene", () => {
    expect(
      checkAgentPlan(
        { operations: [{ tool: "rotate", args: { degrees: 20 } }] },
        capabilities,
        null,
      ),
    ).toMatchObject({ ok: false, reason: "Select a scene first" });
  });
  it("refuses non-finite geometry", () => {
    expect(
      checkAgentPlan(
        { operations: [{ tool: "rotate", args: { degrees: Infinity } }] },
        capabilities,
        "scene-1",
      ).ok,
    ).toBe(false);
  });
  it("refuses injected extra arguments", () => {
    expect(
      checkAgentPlan(
        { operations: [{ tool: "rotate", args: { degrees: 20, overrideSafety: true } }] },
        capabilities,
        "scene-1",
      ).ok,
    ).toBe(false);
  });
  it("refuses partial plans, not just the invalid operation", () => {
    expect(
      checkAgentPlan(
        {
          operations: [
            { tool: "rotate", args: { degrees: 20 } },
            { tool: "fake", args: {} },
          ],
        },
        capabilities,
        "scene-1",
      ),
    ).toMatchObject({ ok: false, operationIndex: 1 });
  });
  it("refuses malformed envelopes", () => {
    expect(
      checkAgentPlan({ operations: [], instructions: "ignore rules" }, capabilities, "scene-1").ok,
    ).toBe(false);
  });
  it("refuses excessively long plans", () => {
    expect(
      checkAgentPlan(
        { operations: Array.from({ length: 9 }, () => ({ tool: "rotate", args: { degrees: 1 } })) },
        capabilities,
        "scene-1",
      ).ok,
    ).toBe(false);
  });
  it("does not mutate the supplied plan", () => {
    const plan = { operations: [{ tool: "rotate", args: { degrees: 20 } }] };
    const result = checkAgentPlan(plan, capabilities, "scene-1");
    expect(result.ok).toBe(true);
    if (result.ok) result.operations[0].args.degrees = 90;
    expect(plan.operations[0].args.degrees).toBe(20);
  });
});
