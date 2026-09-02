/**
 * CREATE VISUAL — pure decision layer for the everyday "Add visual" workflow.
 *
 * This module owns NO drone identity, NO safety maths and NO project mutation.
 * It only:
 *   - describes the available creation choices honestly (including the ones the
 *     project has no canonical authority for);
 *   - validates a requested drone allocation against the CANONICAL scene budget
 *     numbers supplied by `sceneBudget()` (never recomputed here);
 *   - derives read-only preview facts (SVG bounds/aspect, spacing estimate);
 *   - builds a canonical text recipe from everyday inputs.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { SVGFormationReport, SvgGeometry } from "../show/svg";
import {
  SUPPORTED_GLYPHS,
  makeTextRecipe,
  normalizeText,
  type TextGeometryRecipe,
  type TextWeight,
} from "../show/text";

export type CreateVisualMode = "SVG" | "TEXT" | "LINE" | "ASSET" | "AI";

export interface CreateVisualChoice {
  readonly mode: CreateVisualMode;
  readonly label: string;
  readonly description: string;
  /** False when the project has no canonical authority behind the choice. */
  readonly available: boolean;
  /** Honest reason shown to the operator when `available` is false. */
  readonly unavailableNote?: string;
}

/**
 * There is no canonical action that turns a generated AI image into a scene
 * VISUAL OBJECT: the AI panels produce reference/library material only. The
 * choice is therefore surfaced as unavailable instead of faked.
 */
export const AI_VISUAL_UNAVAILABLE_NOTE =
  "AI image → scene object has no canonical pipeline yet. Generate the image in the AI panels, export it as SVG, then import it here.";

export const CREATE_VISUAL_CHOICES: readonly CreateVisualChoice[] = [
  {
    mode: "SVG",
    label: "Import SVG",
    description: "Logo or vector artwork from a local .svg file.",
    available: true,
  },
  {
    mode: "TEXT",
    label: "Text",
    description: "Deterministic stroke text from the bundled glyph pack.",
    available: true,
  },
  {
    mode: "LINE",
    label: "Line",
    description: "Underline or bar built from the native line geometry.",
    available: true,
  },
  {
    mode: "ASSET",
    label: "Existing asset",
    description: "Place a formation that already exists in this show.",
    available: true,
  },
  {
    mode: "AI",
    label: "AI image",
    description: "Generate artwork from a prompt.",
    available: false,
    unavailableNote: AI_VISUAL_UNAVAILABLE_NOTE,
  },
];

export interface DroneAllocationInput {
  /** Fleet size — canonical `project.droneCount`. */
  readonly fleet: number;
  /** Drones already used by the scene — canonical `sceneBudget().active`. */
  readonly used: number;
  /** Drones the operator asked for. Never silently changed. */
  readonly requested: number;
  /** Minimum the chosen geometry needs (line needs 2, text/SVG need 1). */
  readonly minimum?: number;
  /** Drones already owned by the object being edited (0 when creating). */
  readonly ownedByTarget?: number;
}

export type DroneAllocationProblem =
  | "NONE"
  | "BELOW_MINIMUM"
  | "EXCEEDS_RESERVE"
  | "NO_RESERVE"
  | "NOT_AN_INTEGER";

export interface DroneAllocationView {
  readonly fleet: number;
  readonly used: number;
  /** Drones still unassigned in this scene (canonical reserve). */
  readonly reserve: number;
  readonly requested: number;
  readonly minimum: number;
  readonly valid: boolean;
  readonly problem: DroneAllocationProblem;
  readonly message: string | null;
}

/** Validates an allocation against canonical budget numbers. Never mutates. */
export function evaluateDroneAllocation(input: DroneAllocationInput): DroneAllocationView {
  const fleet = Math.max(0, Math.round(input.fleet));
  const used = Math.max(0, Math.round(input.used));
  const minimum = Math.max(1, Math.round(input.minimum ?? 1));
  const owned = Math.max(0, Math.round(input.ownedByTarget ?? 0));
  const reserve = Math.max(0, fleet - used) + owned;
  const requested = input.requested;
  const base = { fleet, used, reserve, requested, minimum };

  if (!Number.isFinite(requested) || !Number.isInteger(requested)) {
    return {
      ...base,
      valid: false,
      problem: "NOT_AN_INTEGER",
      message: "Enter a whole number of drones.",
    };
  }
  if (reserve < minimum) {
    return {
      ...base,
      valid: false,
      problem: "NO_RESERVE",
      message: `No reserve drones left — this visual needs at least ${minimum}.`,
    };
  }
  if (requested < minimum) {
    return {
      ...base,
      valid: false,
      problem: "BELOW_MINIMUM",
      message: `This visual needs at least ${minimum} drone${minimum === 1 ? "" : "s"}.`,
    };
  }
  if (requested > reserve) {
    return {
      ...base,
      valid: false,
      problem: "EXCEEDS_RESERVE",
      message: `Only ${reserve} reserve drone${reserve === 1 ? "" : "s"} available.`,
    };
  }
  return { ...base, valid: true, problem: "NONE", message: null };
}

export interface SvgPreviewFacts {
  readonly fileName: string;
  readonly contours: number;
  readonly widthUnits: number;
  readonly heightUnits: number;
  readonly aspectRatio: number;
  readonly aspectLabel: string;
}

/** Read-only description of parsed SVG geometry for the preview step. */
export function describeSvgGeometry(fileName: string, geometry: SvgGeometry): SvgPreviewFacts {
  const width = Math.max(0, geometry.bounds.width);
  const height = Math.max(0, geometry.bounds.height);
  const aspectRatio = height > 0 ? width / height : 0;
  return {
    fileName,
    contours: geometry.contours.length,
    widthUnits: width,
    heightUnits: height,
    aspectRatio,
    aspectLabel: aspectRatio > 0 ? `${aspectRatio.toFixed(2)}:1` : "—",
  };
}

/** Spacing estimate, only when the canonical sampling report provides it. */
export function estimateVisualSpacing(
  report: SVGFormationReport | null | undefined,
): { readonly minSpacing: number; readonly avgSpacing: number } | null {
  if (!report) return null;
  if (!Number.isFinite(report.minSpacing) || !Number.isFinite(report.avgNearestNeighborSpacing)) {
    return null;
  }
  return { minSpacing: report.minSpacing, avgSpacing: report.avgNearestNeighborSpacing };
}

export interface TextVisualInput {
  readonly text: string;
  readonly weight: TextWeight;
  readonly droneCount: number;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly altitudeMeters: number;
}

export type TextVisualRecipeResult =
  | { readonly ok: true; readonly recipe: TextGeometryRecipe; readonly normalizedText: string }
  | { readonly ok: false; readonly reason: string };

/** Fonts the deterministic pipeline really supports (bundled stroke pack). */
export const TEXT_VISUAL_FONTS: readonly { readonly weight: TextWeight; readonly label: string }[] =
  [
    { weight: "LIGHT", label: "Stroke Light" },
    { weight: "REGULAR", label: "Stroke Regular" },
    { weight: "BOLD", label: "Stroke Bold" },
  ];

/** Builds a canonical text recipe from everyday inputs. No geometry work here. */
export function buildTextVisualRecipe(input: TextVisualInput): TextVisualRecipeResult {
  const text = normalizeText(input.text);
  if (!text) return { ok: false, reason: "Enter the text to fly." };
  const unsupported = [...text].filter(
    (character) => character !== " " && !SUPPORTED_GLYPHS.includes(character),
  );
  if (unsupported.length > 0) {
    return {
      ok: false,
      reason: `Unsupported character${unsupported.length === 1 ? "" : "s"}: ${[...new Set(unsupported)].join(" ")}`,
    };
  }
  const participation = Math.round(input.droneCount);
  if (!Number.isInteger(participation) || participation < 1) {
    return { ok: false, reason: "Drone count must be a positive whole number." };
  }
  return {
    ok: true,
    normalizedText: text,
    recipe: makeTextRecipe({
      text,
      weight: input.weight,
      style: "UPRIGHT",
      widthMeters: Math.max(1, input.widthMeters),
      heightMeters: Math.max(1, input.heightMeters),
      centerAltitudeMeters: Math.max(0, input.altitudeMeters),
      letterSpacingEm: 0.18,
      alignment: "CENTER",
      participation,
      outlineRatio: 0.7,
      bandOffsetEm: 0.22,
      seed: 20260902,
    }),
  };
}
