/**
 * CLIP PRESENTATION (pure, presentation-only).
 *
 * Decides HOW MUCH a clip block may say at the current zoom and which visual
 * hierarchy a clip belongs to. It contains NO timing mathematics: the visible
 * window, zoom and scroll authority stay in `timelineEdit` / the store, and this
 * module only reads the resulting pixel width of a block.
 *
 * No React, no DOM, no project mutation.
 */
import type { FullShowIssue } from "../show/fullshow/types";
import type { ShowPhase } from "../show/types";
import { pixelsPerSecond } from "./timelineEdit";

/** How verbose a clip block may be. Derived from its rendered pixel width. */
export type ClipDensity = "COMPACT" | "MEDIUM" | "RICH";

/** Thresholds in CSS pixels of clip width (not a second zoom model). */
export const CLIP_MEDIUM_PX = 86;
export const CLIP_RICH_PX = 190;
/** Below this a thumbnail would be noise rather than identification. */
export const CLIP_THUMBNAIL_PX = 52;

/** Rendered width, in pixels, of a clip of `durationSeconds` in the given view. */
export function clipWidthPx(
  durationSeconds: number,
  view: { readonly start: number; readonly end: number },
  trackWidthPx: number,
): number {
  const pps = pixelsPerSecond(Math.max(1, trackWidthPx), view);
  return Math.max(0, durationSeconds) * pps;
}

export function clipDensity(widthPx: number): ClipDensity {
  if (widthPx >= CLIP_RICH_PX) return "RICH";
  if (widthPx >= CLIP_MEDIUM_PX) return "MEDIUM";
  return "COMPACT";
}

export function showsThumbnail(widthPx: number): boolean {
  return widthPx >= CLIP_THUMBNAIL_PX;
}

/**
 * PHASE HIERARCHY. Distinguishable without reading text: each phase owns a
 * stripe colour token, a border weight and a short glyph. PRE_SHOW is not an
 * authorable clip phase — it is rendered as a separate region — so it is
 * deliberately absent here.
 */
export interface PhaseStyle {
  /** Semantic-token background class for the phase stripe. */
  readonly stripeClass: string;
  /** Extra classes applied to the clip block itself. */
  readonly blockClass: string;
  readonly glyph: string;
}

const PHASE_STYLES: Partial<Record<ShowPhase, PhaseStyle>> = {
  TAKEOFF: { stripeClass: "bg-accent", blockClass: "border-dashed", glyph: "▲" },
  SHOW: { stripeClass: "bg-primary", blockClass: "", glyph: "◆" },
  LANDING: { stripeClass: "bg-warning", blockClass: "border-double border-2", glyph: "▼" },
};

export function phaseStyle(phase: ShowPhase): PhaseStyle {
  return PHASE_STYLES[phase] ?? PHASE_STYLES["SHOW"]!;
}

/** Worst already-computed analysis severity for a clip ("error" wins). */
export function clipIssueSeverity(
  issues: readonly FullShowIssue[] | undefined,
  clipId: string,
): "error" | "warning" | null {
  if (!issues || issues.length === 0) return null;
  let warning = false;
  for (const issue of issues) {
    if (issue.clipId !== clipId) continue;
    if (issue.severity === "error") return "error";
    if (issue.severity === "warning") warning = true;
  }
  return warning ? "warning" : null;
}

/** Signed ripple delta readout, e.g. "+1.5s" / "-0.4s" / "" when nothing shifts. */
export function formatRippleDelta(delta: number, decimalComma = false): string {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-6) return "";
  const value = Math.abs(delta).toFixed(2).replace(/\.?0+$/, "");
  const text = `${delta > 0 ? "+" : "−"}${value}s`;
  return decimalComma ? text.replace(".", ",") : text;
}
