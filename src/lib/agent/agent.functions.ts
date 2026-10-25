/**
 * AI AGENT — server function: natural language -> typed operations.
 *
 * Returns ONLY typed operations (never a mutated project). The client runs
 * the deterministic engine, shows a preview and commits with undo. When the
 * model is unavailable or returns nothing usable, the local deterministic
 * parser answers instead and `source` says which path produced the result.
 */
import { createServerFn } from "@tanstack/react-start";

import { toRuntimeCapabilities } from "./capabilities";
import { parseAgentCommand } from "./parser";
import { checkAgentPlan, type AgentOperation } from "./planSafetyGate";
import type { ModelOp } from "./agent.server";

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
  .inputValidator(
    (input: {
      text: string;
      context?: { selectedClipId?: unknown; currentHoldSeconds?: unknown };
    }) => {
      if (typeof input?.text !== "string" || input.text.length > 500) {
        throw new Error("Invalid agent request");
      }
      const ctx = input?.context ?? {};
      return {
        text: input.text,
        selectedClipId: typeof ctx.selectedClipId === "string" ? ctx.selectedClipId : null,
        currentHoldSeconds:
          typeof ctx.currentHoldSeconds === "number" && Number.isFinite(ctx.currentHoldSeconds)
            ? ctx.currentHoldSeconds
            : null,
      };
    },
  )
  .handler(async ({ data }): Promise<AgentInterpretation> => {
    const local = parseAgentCommand(data.text);
    if (local.ok) {
      return { source: "local", ops: local.ops.map(toWire), understood: true, clarification: null };
    }
    const { parseWithModel } = await import("./agent.server");
    const model = await parseWithModel(data.text);
    if (model.ok && model.ops.length > 0) {
      // Fail-closed safety gate (ChatGPT contract, PR #6): the model plan is
      // untrusted data, validated against the runtime capability registry
      // before anything reaches the client.
      const gated = gateModelOps(model.ops, data.selectedClipId, data.currentHoldSeconds);
      if (!gated.ok) {
        return { source: "model", ops: [], understood: false, clarification: gated.reason };
      }
      return {
        source: "model",
        ops: gated.ops,
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

function rgbToHex(color: readonly number[]): string {
  return `#${color.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Normalize model ops into the gate's canonical plan envelope and validate
 * them fail-closed against the runtime capability registry. SELECT_SCENE is
 * UI state (no mutation) and passes through ungated. Relative durations are
 * resolved to absolute seconds using the client-supplied current hold, so
 * every gated operation carries exactly the declared arguments.
 */
export function gateModelOps(
  ops: ModelOp[],
  selectedClipId: string | null,
  currentHoldSeconds: number | null,
): { ok: true; ops: AgentInterpretation["ops"] } | { ok: false; reason: string } {
  const plan: AgentOperation[] = [];
  const passthrough: AgentInterpretation["ops"] = [];
  for (const op of ops) {
    if (op.kind === "SELECT_SCENE") {
      passthrough.push(toWire(op));
      continue;
    }
    if (op.kind === "ROTATE_SCENE") {
      if (!op.axis || op.degrees === null) {
        return { ok: false, reason: "Malformed rotation: axis and degrees are required." };
      }
      plan.push({ tool: "rotate_scene", args: { axis: op.axis, degrees: op.degrees } });
      continue;
    }
    if (op.kind === "RECOLOR_SCENE") {
      if (!op.color) {
        return { ok: false, reason: "Malformed recolor: an RGB color is required." };
      }
      plan.push({ tool: "recolor_scene", args: { color: rgbToHex(op.color) } });
      continue;
    }
    if (op.kind === "SET_DURATION") {
      let seconds: number | null = null;
      if (op.holdSeconds !== null) {
        seconds = op.holdSeconds;
      } else if (op.deltaSeconds !== null) {
        if (currentHoldSeconds === null) {
          return {
            ok: false,
            reason: "Select a scene first so I know its current duration.",
          };
        }
        seconds = currentHoldSeconds + op.deltaSeconds;
      }
      if (seconds === null) {
        return { ok: false, reason: "Malformed duration: a hold time is required." };
      }
      plan.push({ tool: "set_scene_duration", args: { seconds } });
      continue;
    }
    return { ok: false, reason: `Unsupported operation kind: ${String(op.kind)}` };
  }
  // A selection-only plan has no mutations to gate.
  if (plan.length === 0) return { ok: true, ops: passthrough };
  const check = checkAgentPlan({ operations: plan }, toRuntimeCapabilities(), selectedClipId);
  if (!check.ok) return { ok: false, reason: check.reason };
  // The gate validated the canonical envelope; emit the original typed ops
  // (zod-validated) with relative durations resolved to absolute seconds.
  const wire: AgentInterpretation["ops"] = [];
  let planIndex = 0;
  for (const op of ops) {
    if (op.kind === "SELECT_SCENE") {
      wire.push(toWire(op));
      continue;
    }
    const gatedOp = check.operations[planIndex]!;
    planIndex += 1;
    if (op.kind === "SET_DURATION") {
      wire.push(toWire({ ...op, holdSeconds: gatedOp.args.seconds as number, deltaSeconds: null }));
      continue;
    }
    wire.push(toWire(op));
  }
  return { ok: true, ops: wire };
}

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
