/**
 * AI AGENT — server function: natural language -> typed operations.
 *
 * Returns ONLY typed operations (never a mutated project). The client runs
 * the deterministic engine, shows a preview and commits with undo. When the
 * model is unavailable or returns nothing usable, the local deterministic
 * parser answers instead and `source` says which path produced the result.
 */
import { createServerFn } from "@tanstack/react-start";

import { parseAgentCommand } from "./parser";

export interface AgentInterpretation {
  source: "model" | "local";
  ops: {
    kind: "ROTATE_SCENE" | "RECOLOR_SCENE";
    axis: "X" | "Y" | "Z" | null;
    degrees: number | null;
    color: [number, number, number] | null;
  }[];
  understood: boolean;
}

export const interpretAgentCommand = createServerFn({ method: "POST" })
  .inputValidator((input: { text: string }) => {
    if (typeof input?.text !== "string" || input.text.length > 500) {
      throw new Error("Invalid agent request");
    }
    return { text: input.text };
  })
  .handler(async ({ data }): Promise<AgentInterpretation> => {
    const local = parseAgentCommand(data.text);
    if (local.ok) {
      return { source: "local", ops: local.ops.map(toWire), understood: true };
    }
    const { parseWithModel } = await import("./agent.server");
    const model = await parseWithModel(data.text);
    if (model.ok && model.ops.length > 0) {
      return { source: "model", ops: model.ops, understood: true };
    }
    return { source: model.ok ? "model" : "local", ops: [], understood: false };
  });

function toWire(op: {
  kind: "ROTATE_SCENE" | "RECOLOR_SCENE";
  axis?: "X" | "Y" | "Z";
  degrees?: number;
  color?: readonly [number, number, number];
}): AgentInterpretation["ops"][number] {
  return {
    kind: op.kind,
    axis: op.axis ?? null,
    degrees: op.degrees ?? null,
    color: op.color ? [op.color[0], op.color[1], op.color[2]] : null,
  };
}
