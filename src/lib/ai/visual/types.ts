/**
 * AI VISUAL CREATOR (Sprint 8C) — provider boundary.
 *
 * The AI is a REFERENCE IMAGE creator, never a geometry engine: a provider
 * returns raster bytes only. Everything downstream is the existing deterministic
 * pipeline — 8B1 analysis, 8B2 structure editor, compileVisualFormation().
 *
 * No provider-specific code lives in React, and no provider key ever reaches the
 * client: the gateway provider calls a server route.
 */

/** Visual language requested from the model. Language-neutral identifiers. */
export type VisualReferenceStyle =
  | "REALISTIC_STRUCTURAL"
  | "SILHOUETTE"
  | "ILLUSTRATIVE"
  | "LOGO_LIKE";

export const VISUAL_REFERENCE_STYLES: readonly VisualReferenceStyle[] = [
  "REALISTIC_STRUCTURAL",
  "SILHOUETTE",
  "ILLUSTRATIVE",
  "LOGO_LIKE",
];

/** Previous generation passed back as context for a refinement. */
export interface VisualReferenceContext {
  /** Raw base64 PNG (no data: prefix) of the previous generation. */
  readonly imageBase64: string;
  readonly mimeType: string;
}

export interface GenerateVisualReferenceRequest {
  readonly prompt: string;
  readonly droneCount: number;
  readonly style: VisualReferenceStyle;
  /** Refinement instruction, e.g. "make wings wider". */
  readonly instruction?: string;
  /** Previous image, used as context when the provider supports editing. */
  readonly context?: VisualReferenceContext;
  readonly signal?: AbortSignal;
}

export interface VisualReferenceResult {
  /** Raw base64 image data (no data: prefix). */
  readonly imageBase64: string;
  readonly mimeType: string;
  /** The fully enriched prompt actually sent to the model. */
  readonly enrichedPrompt: string;
  readonly providerId: string;
  readonly providerLabel: string;
  readonly model: string;
  /** True when the previous image was used as editing context. */
  readonly usedContext: boolean;
  readonly createdAt: string;
}

export interface VisualReferenceProvider {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  generate(request: GenerateVisualReferenceRequest): Promise<VisualReferenceResult>;
}

export type VisualReferenceErrorCode =
  | "EMPTY_PROMPT"
  | "CANCELLED"
  | "RATE_LIMITED"
  | "CREDITS"
  | "BLOCKED"
  | "PROVIDER_UNAVAILABLE"
  | "NO_IMAGE";

export class VisualReferenceError extends Error {
  readonly code: VisualReferenceErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: VisualReferenceErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "VisualReferenceError";
    this.code = code;
    this.details = details;
  }
}

/** Maps an HTTP status from the AI gateway onto a stable error code. */
export function errorCodeForStatus(status: number): VisualReferenceErrorCode {
  if (status === 402) return "CREDITS";
  if (status === 403) return "BLOCKED";
  if (status === 429) return "RATE_LIMITED";
  return "PROVIDER_UNAVAILABLE";
}
