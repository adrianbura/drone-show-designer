/**
 * AI AGENT — model backend (server-only).
 *
 * Translates a natural-language request into the SAME typed operations the
 * local parser produces (src/lib/agent/parser.ts). The model never touches
 * the project: it only fills a strict JSON schema, and every operation is
 * re-validated and executed by the deterministic engine.
 *
 * `LOVABLE_API_KEY` is read inside the handler and never leaves the server.
 * When the key is absent the caller falls back to the local parser and the UI
 * says so — the agent never claims model intelligence it does not have.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { NoObjectGeneratedError, Output, streamText } from "ai";
import { z } from "zod";

import { createLovableAiGatewayRunIdFetch } from "./run-id";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";

const opSchema = z.object({
  ops: z.array(
    z.object({
      kind: z.enum(["ROTATE_SCENE", "RECOLOR_SCENE"]),
      axis: z.enum(["X", "Y", "Z"]).nullable(),
      degrees: z.number().nullable(),
      color: z.array(z.number()).length(3).nullable(),
    }),
  ),
});

export type ModelOp = z.infer<typeof opSchema>["ops"][number];

export type ModelParseResult =
  { ok: true; ops: ModelOp[] } | { ok: false; reason: "NO_API_KEY" | "MODEL_FAILED" };

const INSTRUCTIONS = `You translate a drone-show operator's request (Romanian or English) into typed scene edits for ONE selected scene.
Axes: X = lean forward/back, Y = turn left/right, Z = tilt sideways. Sign conventions: tilt left = negative Z, tilt right = positive Z; turn left = positive Y, turn right = negative Y; lean forward = positive X, backward = negative X.
Colors are sRGB 0-255 (e.g. gold = [255,200,40]).
Return ONLY operations the request clearly asks for. Unused fields must be null. If nothing is clear, return an empty ops array.`;

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
      model: provider.responses(MODEL),
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
    return { ok: true, ops: output.ops };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) return { ok: false, reason: "MODEL_FAILED" };
    return { ok: false, reason: "MODEL_FAILED" };
  }
}
