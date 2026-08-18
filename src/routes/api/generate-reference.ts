/**
 * AI REFERENCE IMAGE ROUTE (Sprint 8C).
 *
 * The only place that talks to the AI gateway. It returns raster bytes and the
 * enriched prompt; it never returns geometry, never touches the project and
 * never sees drone coordinates. LOVABLE_API_KEY stays server-side.
 */
import { createFileRoute } from "@tanstack/react-router";

import { buildReferencePrompt } from "@/lib/ai/visual/enrich";
import { parseRefineInstruction } from "@/lib/ai/visual/refine";
import { VISUAL_REFERENCE_STYLES, type VisualReferenceStyle } from "@/lib/ai/visual/types";

const MODEL = "openai/gpt-image-2";
const GENERATIONS_URL = "https://ai.gateway.lovable.dev/v1/images/generations";
const EDITS_URL = "https://ai.gateway.lovable.dev/v1/images/edits";

interface RequestBody {
  readonly prompt?: string;
  readonly droneCount?: number;
  readonly style?: string;
  readonly instruction?: string;
  readonly context?: { readonly imageBase64?: string; readonly mimeType?: string };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const Route = createFileRoute("/api/generate-reference")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return json({ error: "AI is not configured", code: "PROVIDER_UNAVAILABLE" }, 500);

        let body: RequestBody;
        try {
          body = (await request.json()) as RequestBody;
        } catch {
          return json({ error: "Invalid request body" }, 400);
        }

        const prompt = (body.prompt ?? "").trim();
        if (prompt.length === 0) return json({ error: "Empty prompt", code: "EMPTY_PROMPT" }, 400);

        const style: VisualReferenceStyle = (
          VISUAL_REFERENCE_STYLES as readonly string[]
        ).includes(body.style ?? "")
          ? (body.style as VisualReferenceStyle)
          : "REALISTIC_STRUCTURAL";
        const droneCount = Number.isFinite(body.droneCount)
          ? Math.min(2000, Math.max(1, Math.floor(body.droneCount as number)))
          : 100;
        const directives = body.instruction ? parseRefineInstruction(body.instruction) : [];
        const enriched = buildReferencePrompt({ prompt, droneCount, style, directives });

        const contextBase64 = body.context?.imageBase64;
        const usedContext = typeof contextBase64 === "string" && contextBase64.length > 0;

        try {
          let upstream: Response;
          if (usedContext) {
            // Refinement with the previous generation as editing context.
            const form = new FormData();
            form.append("model", MODEL);
            form.append("prompt", enriched.text);
            form.append("quality", "low");
            form.append("size", "1024x1024");
            form.append(
              "image",
              new Blob([base64ToBytes(contextBase64!)], {
                type: body.context?.mimeType ?? "image/png",
              }),
              "reference.png",
            );
            upstream = await fetch(EDITS_URL, {
              method: "POST",
              headers: { Authorization: `Bearer ${key}` },
              body: form,
            });
          } else {
            upstream = await fetch(GENERATIONS_URL, {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: MODEL,
                prompt: enriched.text,
                quality: "low",
                size: "1024x1024",
                n: 1,
              }),
            });
          }

          if (!upstream.ok) {
            const text = await upstream.text().catch(() => "");
            return json(
              { error: text || `Image generation failed (${upstream.status})` },
              upstream.status,
            );
          }

          const payload = (await upstream.json()) as { data?: { b64_json?: string }[] };
          const b64 = payload.data?.[0]?.b64_json;
          if (!b64) return json({ error: "No image was returned", code: "NO_IMAGE" }, 502);

          return json({
            imageBase64: b64,
            mimeType: "image/png",
            enrichedPrompt: enriched.text,
            model: MODEL,
            usedContext,
          });
        } catch (error) {
          return json({ error: String(error), code: "PROVIDER_UNAVAILABLE" }, 502);
        }
      },
    },
  },
});
