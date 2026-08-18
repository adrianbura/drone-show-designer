/**
 * AI PROPOSAL SCHEMA EVOLUTION — v2 visual-asset intent.
 *
 * `AIChoreographyProposalV1` is NOT mutated: v2 is an additive, versioned model
 * that expresses ARTISTIC ASSET intent (what to draw, at what formation drone
 * count, in which visual style) instead of show choreography.
 *
 * PRODUCT DECISION encoded here: AI is an ASSET CREATOR. A v2 proposal never
 * carries timeline placement, beat/bar synchronisation, section selection or
 * show sequencing. Suggested lighting effects are OPTIONAL, editable hints and
 * are never placed on the music timeline automatically. The user directs the
 * show; the deterministic compiler and the flight engines do the maths.
 */
import type { LightingEffectType } from "../show/lighting/types";
import type { RGB } from "../show/types";
import type {
  SemanticPartId,
  VisualDesignMode,
  VisualFormationDesign,
  VisualStyle,
  VisualSymmetry,
} from "../visual/types";
import type { AIChoreographyProposalV1, ProposalProvenance } from "./types";

export const AI_FORMATION_PROPOSAL_SCHEMA_VERSION = 2;

/** Where the artistic design comes from. Inline designs must be validated. */
export type ProposalDesignRef =
  | { readonly kind: "BUILT_IN"; readonly designId: string }
  | { readonly kind: "PROCEDURAL"; readonly concept: string }
  | { readonly kind: "INLINE"; readonly design: VisualFormationDesign };

export interface ProposalAnimationIntentV2 {
  /** True when the design exposes articulated parts worth animating. */
  readonly articulated: boolean;
  readonly groups: readonly SemanticPartId[];
  readonly suggestedCycleDuration?: number;
}

export interface ProposalBaseColorIntent {
  readonly part?: SemanticPartId;
  readonly color: RGB;
}

/** Optional lighting SUGGESTION. Never auto-placed on the music timeline. */
export interface AISuggestedLightingEffect {
  readonly kind: LightingEffectType;
  readonly color?: RGB;
  readonly description: string;
}

export interface AIFormationProposalV2 {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** FORMATION drone count — independent of the project fleet size. */
  readonly formationDroneCount: number;
  readonly designMode: VisualDesignMode;
  readonly designRef: ProposalDesignRef;
  readonly style: VisualStyle;
  readonly symmetry: VisualSymmetry;
  readonly widthMeters: number;
  readonly altitudeMeters: number;
  readonly animationIntent: ProposalAnimationIntentV2;
  readonly baseColorIntent: readonly ProposalBaseColorIntent[];
  /** Sprint 7.4 supports many lighting effects; suggestions stay a list. */
  readonly lightingEffects: readonly AISuggestedLightingEffect[];
  readonly assumptions: readonly string[];
  readonly warnings: readonly string[];
  readonly provenance: ProposalProvenance;
}

/**
 * Migrates a v1 choreography proposal to a v2 visual-asset proposal. Timing
 * (transition / hold) is intentionally DROPPED: it is a show-timeline decision
 * that belongs to the user, not to the asset.
 */
export function migrateProposalV1ToV2(
  v1: AIChoreographyProposalV1,
  overrides: { readonly formationDroneCount?: number; readonly style?: VisualStyle } = {},
): AIFormationProposalV2 {
  const articulated = v1.motionGroups.some((g) => g !== "BODY");
  return {
    schemaVersion: 2,
    id: v1.id,
    title: v1.title,
    description: v1.description,
    formationDroneCount: overrides.formationDroneCount ?? v1.fleetCount,
    designMode: articulated ? "ARTICULATED_2_5D" : "CONTOUR_2D",
    designRef: { kind: "PROCEDURAL", concept: v1.concept },
    style: overrides.style ?? "STRUCTURAL",
    symmetry: articulated ? "MIRROR_X" : "NONE",
    widthMeters: v1.formationSpec.width,
    altitudeMeters: v1.formationSpec.altitude,
    animationIntent: {
      articulated,
      groups: v1.motionGroups.filter((g) => g !== "BODY"),
      ...(v1.animationSpec.dynamic
        ? { suggestedCycleDuration: v1.animationSpec.cycleDuration }
        : {}),
    },
    baseColorIntent: [{ color: v1.lightingIntent.color }],
    lightingEffects: [],
    assumptions: v1.assumptions,
    warnings: v1.warnings,
    provenance: v1.provenance,
  };
}

/**
 * Strict validation. A future real provider's output must pass this before it
 * can become a VisualFormationDesign or any project content.
 */
export function validateFormationProposalV2(proposal: AIFormationProposalV2): string[] {
  const errors: string[] = [];
  if (proposal.schemaVersion !== AI_FORMATION_PROPOSAL_SCHEMA_VERSION) {
    errors.push("SCHEMA_VERSION");
  }
  if (!proposal.id || !proposal.title) errors.push("IDENTITY");
  if (!Number.isFinite(proposal.formationDroneCount) || proposal.formationDroneCount < 1) {
    errors.push("FORMATION_DRONE_COUNT");
  }
  if (!Number.isFinite(proposal.widthMeters) || proposal.widthMeters <= 0) errors.push("WIDTH");
  if (!Number.isFinite(proposal.altitudeMeters) || proposal.altitudeMeters < 0) {
    errors.push("ALTITUDE");
  }
  if (proposal.designRef.kind === "BUILT_IN" && !proposal.designRef.designId) {
    errors.push("DESIGN_REF");
  }
  if (proposal.designRef.kind === "INLINE" && proposal.designRef.design.primitives.length === 0) {
    errors.push("DESIGN_EMPTY");
  }
  for (const c of proposal.baseColorIntent) {
    if (c.color.some((v) => !Number.isFinite(v) || v < 0 || v > 255)) errors.push("COLOR_RANGE");
  }
  return errors;
}
