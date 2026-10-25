import { describe, expect, it } from "vitest";

import { gateModelOps } from "@/lib/agent/agent.functions";
import type { ModelOp } from "@/lib/agent/agent.server";

function op(partial: Partial<ModelOp> & { kind: ModelOp["kind"] }): ModelOp {
  return {
    axis: null,
    degrees: null,
    color: null,
    holdSeconds: null,
    deltaSeconds: null,
    sceneIndex: null,
    sceneName: null,
    ...partial,
  };
}

describe("model plan safety gate integration", () => {
  it("passes a valid rotate+recolor plan through with selection", () => {
    const result = gateModelOps(
      [
        op({ kind: "ROTATE_SCENE", axis: "Z", degrees: -20 }),
        op({ kind: "RECOLOR_SCENE", color: [255, 200, 40] }),
      ],
      "clip-1",
      8,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops).toHaveLength(2);
    expect(result.ops[0]).toMatchObject({ kind: "ROTATE_SCENE", axis: "Z", degrees: -20 });
    expect(result.ops[1]).toMatchObject({ kind: "RECOLOR_SCENE", color: [255, 200, 40] });
  });

  it("resolves a relative duration to absolute seconds using the client context", () => {
    const result = gateModelOps([op({ kind: "SET_DURATION", deltaSeconds: 5 })], "clip-1", 7.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops[0]).toMatchObject({
      kind: "SET_DURATION",
      holdSeconds: 12.5,
      deltaSeconds: null,
    });
  });

  it("refuses a relative duration when the current hold is unknown", () => {
    const result = gateModelOps([op({ kind: "SET_DURATION", deltaSeconds: 5 })], "clip-1", null);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("Select a scene") });
  });

  it("refuses mutation ops when no scene is selected", () => {
    const result = gateModelOps([op({ kind: "ROTATE_SCENE", axis: "Y", degrees: 15 })], null, null);
    expect(result).toMatchObject({ ok: false, reason: "Select a scene first" });
  });

  it("refuses malformed rotation ops before they reach the client", () => {
    const result = gateModelOps(
      [op({ kind: "ROTATE_SCENE", axis: "Z", degrees: null })],
      "clip-1",
      8,
    );
    expect(result.ok).toBe(false);
  });

  it("lets SELECT_SCENE through without a selected scene (UI state, no mutation)", () => {
    const result = gateModelOps([op({ kind: "SELECT_SCENE", sceneIndex: 3 })], null, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops[0]).toMatchObject({ kind: "SELECT_SCENE", sceneIndex: 3 });
  });

  it("refuses an entire plan when any operation is malformed (atomic)", () => {
    const result = gateModelOps(
      [
        op({ kind: "ROTATE_SCENE", axis: "X", degrees: 10 }),
        op({ kind: "RECOLOR_SCENE", color: null }),
      ],
      "clip-1",
      8,
    );
    expect(result.ok).toBe(false);
  });

  it("refuses non-finite degrees coming from the model", () => {
    const result = gateModelOps(
      [op({ kind: "ROTATE_SCENE", axis: "Y", degrees: Number.NaN })],
      "clip-1",
      8,
    );
    expect(result.ok).toBe(false);
  });
});
