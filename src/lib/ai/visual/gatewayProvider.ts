/**
 * REAL VISUAL REFERENCE PROVIDER — Lovable AI gateway behind a server route.
 *
 * No key, no model id and no provider protocol lives in client code: the
 * provider only speaks to `/api/generate-reference`. Prompt enrichment happens
 * on the server (same pure module) so the enriched text is always reproducible.
 */
import {
  VisualReferenceError,
  errorCodeForStatus,
  type GenerateVisualReferenceRequest,
  type VisualReferenceProvider,
  type VisualReferenceResult,
} from "./types";

export const VISUAL_REFERENCE_ENDPOINT = "/api/generate-reference";

interface RouteResponse {
  readonly imageBase64?: string;
  readonly mimeType?: string;
  readonly enrichedPrompt?: string;
  readonly model?: string;
  readonly usedContext?: boolean;
  readonly error?: string;
  readonly code?: string;
}

export class GatewayVisualReferenceProvider implements VisualReferenceProvider {
  readonly id = "lovable-ai-gateway";
  readonly label = "Lovable AI (image model)";
  readonly model = "openai/gpt-image-2";

  async generate(request: GenerateVisualReferenceRequest): Promise<VisualReferenceResult> {
    if (request.prompt.trim().length === 0) {
      throw new VisualReferenceError("EMPTY_PROMPT", "The prompt is empty");
    }

    let response: Response;
    try {
      response = await fetch(VISUAL_REFERENCE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: request.prompt,
          droneCount: request.droneCount,
          style: request.style,
          ...(request.instruction ? { instruction: request.instruction } : {}),
          ...(request.context ? { context: request.context } : {}),
        }),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (error) {
      if (request.signal?.aborted) {
        throw new VisualReferenceError("CANCELLED", "Generation cancelled");
      }
      throw new VisualReferenceError("PROVIDER_UNAVAILABLE", String(error));
    }

    let payload: RouteResponse = {};
    try {
      payload = (await response.json()) as RouteResponse;
    } catch {
      payload = {};
    }

    if (!response.ok) {
      throw new VisualReferenceError(
        errorCodeForStatus(response.status),
        payload.error ?? `Image generation failed (${response.status})`,
        { status: response.status, code: payload.code },
      );
    }
    if (!payload.imageBase64) {
      throw new VisualReferenceError("NO_IMAGE", payload.error ?? "No image was returned");
    }

    return {
      imageBase64: payload.imageBase64,
      mimeType: payload.mimeType ?? "image/png",
      enrichedPrompt: payload.enrichedPrompt ?? request.prompt,
      providerId: this.id,
      providerLabel: this.label,
      model: payload.model ?? this.model,
      usedContext: payload.usedContext ?? false,
      createdAt: new Date().toISOString(),
    };
  }
}

export const gatewayVisualReferenceProvider = new GatewayVisualReferenceProvider();
