/**
 * DRONE-OPTIMISED PROMPT ENRICHMENT — pure text, fully deterministic.
 *
 * A raw user prompt ("porumbel realist cu aripile complet deschise") is not a
 * drone-show reference: what the analysis needs is an isolated, centred, high
 * contrast subject whose micro-detail budget matches the requested drone count.
 * This module encodes that knowledge as text and never calls a model.
 */
import { normalizeText } from "../prompt";
import type { VisualReferenceStyle } from "./types";

/** Detail budget bands. Fewer drones -> fewer, bolder shapes. */
export type DetailBudget = "MINIMAL" | "LOW" | "MODERATE" | "RICH";

export function detailBudgetForCount(droneCount: number): DetailBudget {
  const n = Math.max(1, Math.floor(droneCount));
  if (n < 80) return "MINIMAL";
  if (n < 160) return "LOW";
  if (n < 400) return "MODERATE";
  return "RICH";
}

const DETAIL_TEXT: Record<DetailBudget, string> = {
  MINIMAL:
    "extremely reduced detail: only the overall silhouette and 2-3 major structural landmarks, no texture at all",
  LOW: "limited detail: clear silhouette plus the main anatomical structures, no feathers, fur, scales or fine texture",
  MODERATE:
    "moderate detail: silhouette, main structures and a few large internal separations, still no fine texture",
  RICH: "richer structure: silhouette, main structures and clear internal separations, but still no micro-texture",
};

const STYLE_TEXT: Record<VisualReferenceStyle, string> = {
  REALISTIC_STRUCTURAL:
    "realistic but structurally simplified rendering, anatomically correct proportions, flat lighting, no photographic noise",
  SILHOUETTE:
    "pure solid black silhouette on a plain white background, no interior detail, no gradients",
  ILLUSTRATIVE:
    "bold flat vector-like illustration, thick clean edges, flat fill areas, no shading gradients",
  LOGO_LIKE:
    "minimal logo-like mark, geometric and highly readable at small size, flat two-tone",
};

/** Concepts whose reference should be mirror-symmetric. */
const SYMMETRIC_HINTS = [
  "bird",
  "pigeon",
  "dove",
  "eagle",
  "porumbel",
  "pasare",
  "vultur",
  "butterfly",
  "fluture",
  "heart",
  "inima",
  "face",
  "fata",
  "portret",
  "portrait",
  "star",
  "stea",
  "logo",
  "emblem",
  "stema",
];

export function wantsSymmetry(prompt: string): boolean {
  const t = normalizeText(prompt);
  return SYMMETRIC_HINTS.some((h) => t.includes(normalizeText(h)));
}

/** Non-negotiable constraints for every drone-show reference image. */
const BASE_CONSTRAINTS: readonly string[] = [
  "single isolated subject, perfectly centred, fully inside the frame with a small margin",
  "clean strong readable silhouette with an unbroken outer contour",
  "all major recognizable anatomy and structure clearly visible and separated",
  "minimal background: one plain uniform flat area, no scenery, no props, no ground, no shadow, no vignette",
  "very high contrast between subject and background",
  "no text, no watermark, no border, no frame, no collage, no multiple views",
];

export interface EnrichedPrompt {
  readonly text: string;
  readonly detailBudget: DetailBudget;
  readonly symmetric: boolean;
}

/**
 * Builds the prompt actually sent to the image model. Deterministic: the same
 * inputs always produce the exact same string.
 */
export function buildReferencePrompt(input: {
  readonly prompt: string;
  readonly droneCount: number;
  readonly style: VisualReferenceStyle;
  /** Refinement directives, already normalised (see refine.ts). */
  readonly directives?: readonly string[];
}): EnrichedPrompt {
  const subject = input.prompt.trim().replace(/\s+/g, " ");
  const budget = detailBudgetForCount(input.droneCount);
  const symmetric = wantsSymmetry(subject);

  const lines: string[] = [
    `Reference artwork for a drone light show formation of about ${Math.max(1, Math.floor(input.droneCount))} drones.`,
    `Subject: ${subject}.`,
    `Style: ${STYLE_TEXT[input.style]}.`,
    `Detail budget: ${DETAIL_TEXT[budget]}.`,
    ...BASE_CONSTRAINTS.map((c) => `- ${c}`),
  ];
  if (symmetric) {
    lines.push("- symmetric composition, mirrored left/right, seen straight on");
  }
  if (input.directives && input.directives.length > 0) {
    lines.push(`Adjustments: ${input.directives.join("; ")}.`);
  }

  return { text: lines.join("\n"), detailBudget: budget, symmetric };
}
