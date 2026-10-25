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
    kind: "ROTATE_SCENE" | "RECOLOR_SCENE" | "SET_DURATION" | "SELECT_SCENE";
    axis: "X" | "Y" | "Z" | null;
    degrees: number | null;
    color: [number, number, number] | null;
    holdSeconds: number | null;
    deltaSeconds: number | null;
    sceneIndex: number | null;
    sceneName: string | null;
  }[];
  understood: boolean;
  /** Model-supplied clarification for ambiguous/unsupported requests. */
  clarification: string | null;
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
      return { source: "local", ops: local.ops.map(toWire), understood: true, clarification: null };
    }
    const { parseWithModel } = await import("./agent.server");
    const model = await parseWithModel(data.text);
    if (model.ok && model.ops.length > 0) {
      return {
        source: "model",
        ops: model.ops.map((o) => ({
          kind: o.kind,
          axis: o.axis,
          degrees: o.degrees,
          color: o.color ? [o.color[0]!, o.color[1]!, o.color[2]!] : null,
          holdSeconds: o.holdSeconds,
          deltaSeconds: o.deltaSeconds,
          sceneIndex: o.sceneIndex,
          sceneName: o.sceneName,
        })),
        understood: true,
        clarification: model.clarification,
      };
    }
    return {
      source: model.ok ? "model" : "local",
      ops: [],
      understood: false,
      clarification: model.ok ? model.clarification : null,
    };
  });

function toWire(op: {
  kind: "ROTATE_SCENE" | "RECOLOR_SCENE" | "SET_DURATION" | "SELECT_SCENE";
  axis?: "X" | "Y" | "Z";
  degrees?: number;
  color?: readonly [number, number, number];
  holdSeconds?: number;
  deltaSeconds?: number;
  sceneIndex?: number;
  sceneName?: string;
}): AgentInterpretation["ops"][number] {
  return {
    kind: op.kind,
    axis: op.axis ?? null,
    degrees: op.degrees ?? null,
    color: op.color ? [op.color[0], op.color[1], op.color[2]] : null,
    holdSeconds: op.holdSeconds ?? null,
    deltaSeconds: op.deltaSeconds ?? null,
    sceneIndex: op.sceneIndex ?? null,
    sceneName: op.sceneName ?? null,
  };
}
