/**
 * AI AGENT — model backend (server-only).
 *
 * Translates a natural-language request into the SAME typed operations the
 * local parser produces (src/lib/agent/parser.ts). The model never touches
 * the project: it only fills a strict JSON schema built from the capability
 * registry (./capabilities.ts), and every operation is re-validated and
 * executed by the deterministic engine. Kinds outside the registry are
 * rejected by the schema — the model can never invent an action.
 *
 * `LOVABLE_API_KEY` is read inside the handler and never leaves the server.
 * When the key is absent the caller falls back to the local parser and the UI
 * says so — the agent never claims model intelligence it does not have.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { NoObjectGeneratedError, Output, streamText } from "ai";
import { z } from "zod";

import { capabilityInstructions } from "./capabilities";
import { createLovableAiGatewayRunIdFetch } from "./run-id";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";

const opSchema = z.object({
  ops: z.array(
    z.object({
      kind: z.enum(["ROTATE_SCENE", "RECOLOR_SCENE", "SET_DURATION", "SELECT_SCENE"]),
      axis: z.enum(["X", "Y", "Z"]).nullable(),
      degrees: z.number().nullable(),
      color: z.array(z.number()).length(3).nullable(),
      holdSeconds: z.number().nullable(),
      deltaSeconds: z.number().nullable(),
      sceneIndex: z.number().nullable(),
      sceneName: z.string().nullable(),
    }),
  ),
  /** Set when the request is ambiguous or asks for something unsupported. */
  clarification: z.string().nullable(),
});

export type ModelOp = z.infer<typeof opSchema>["ops"][number];

export type ModelParseResult =
  | { ok: true; ops: ModelOp[]; clarification: string | null }
  | { ok: false; reason: "NO_API_KEY" | "MODEL_FAILED" };

const INSTRUCTIONS = `You translate a drone-show operator's request (Romanian or English) into typed edits for ONE selected scene.
${capabilityInstructions()}
Rules:
- Return ONLY operations the request clearly asks for. Unused fields must be null.
- If the request is ambiguous, return the ops you are sure about and explain the ambiguity in "clarification" (in the user's language).
- If the request asks for an unsupported action (scaling, moving, transitions, lighting effects, library insert, drone count), return an empty ops array and say in "clarification" that the action is not supported yet.
- If nothing is clear, return an empty ops array and a short "clarification" asking what to change.`;

export async function parseWithModel(text: string): Promise<ModelParseResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { ok: false, reason: "NO_API_KEY" };
  const runIdFetch = createLovableAiGatewayRunIdFetch(undefined);
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });
  try {
    const result = streamText({
      // The SDK family ships two structurally-identical @ai-sdk/provider
      // copies (gateway vs openai); the runtime model is the same object.
      model: provider.responses(MODEL) as never,
      system: INSTRUCTIONS,
      messages: [{ role: "user", content: text }],
      output: Output.object({ schema: opSchema }),
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    const output = await result.output;
    return { ok: true, ops: output.ops, clarification: output.clarification ?? null };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) return { ok: false, reason: "MODEL_FAILED" };
    return { ok: false, reason: "MODEL_FAILED" };
  }
}
