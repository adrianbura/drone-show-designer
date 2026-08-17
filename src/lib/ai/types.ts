/**
 * AI CHOREOGRAPHY ASSISTANT — domain model.
 *
 * The assistant produces a STRUCTURED DESIGN PROPOSAL, never operational drone
 * commands. Nothing downstream ever depends on AI prose: a proposal is a
 * validated, versioned data structure, and a deterministic builder turns it into
 * native Formation / DynamicFormation content. Enums, ids and schema property
 * names are language-neutral and are never translated.
 *
 * Pipeline:
 *   prompt -> provider -> proposal -> schema validation -> deterministic builder
 *   -> Formation / DynamicFormation -> preview -> trajectory planner ->
 *   conflict detector -> safety validator -> HUMAN apply.
 */
import type { LoopMode } from "../show/dynamic/types";
import type { LightEffect, RGB } from "../show/types";

export const AI_PROPOSAL_SCHEMA_VERSION = 1;
/** Version of the deterministic geometry/animation builder. */
export const CHOREOGRAPHY_ENGINE_VERSION = "0.1.0";

/** Deterministic vocabulary supported in this build. No arbitrary imagery. */
export type ChoreographyConcept =
  | "CIRCLE"
  | "RING"
  | "HEART"
  | "STAR"
  | "SPIRAL"
  | "BIRD"
  | "BUTTERFLY"
  | "WAVE"
  | "ABSTRACT";

export const CHOREOGRAPHY_CONCEPTS: readonly ChoreographyConcept[] = [
  "CIRCLE",
  "RING",
  "HEART",
  "STAR",
  "SPIRAL",
  "BIRD",
  "BUTTERFLY",
  "WAVE",
  "ABSTRACT",
];

/** Semantic parts a concept can expose as motion groups. */
export type ChoreographyPart = "BODY" | "LEFT_WING" | "RIGHT_WING" | "HEAD" | "TAIL";

export type PromptLanguage = "en" | "ro" | "unknown";

export interface ProposalFormationSpec {
  /** Overall width in metres (wingspan for winged concepts). */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Centre altitude in metres (+Y up). */
  readonly altitude: number;
  /** Yaw of the static shape in degrees. */
  readonly rotationDeg: number;
}

export interface ProposalAnimationSpec {
  readonly dynamic: boolean;
  /** Seconds of ONE cycle (one full wing flap, one pulse…). */
  readonly cycleDuration: number;
  /** Number of cycles the animation contains. */
  readonly cycles: number;
  /** Peak deformation angle in degrees (wing sweep). */
  readonly amplitudeDeg: number;
  readonly loop: LoopMode;
  /** Whether the body deforms; false keeps the body locally stable. */
  readonly bodyDeforms: boolean;
}

export interface ProposalGlobalMotion {
  /** Whole-formation translation in metres: [right, climb, forward]. */
  readonly translation: readonly [number, number, number];
  /** Whole-formation yaw in degrees. */
  readonly rotationDeg: number;
}

export interface ProposalTiming {
  /** Recommended time for the drones to morph INTO this formation. */
  readonly recommendedTransition: number;
  /** Recommended hold, i.e. how long the animation is on stage. */
  readonly hold: number;
}

export interface ProposalLightingIntent {
  readonly color: RGB;
  readonly effect: LightEffect;
  readonly description: string;
}

export interface ProposalProvenance {
  readonly providerId: string;
  readonly providerLabel: string;
  readonly deterministic: boolean;
  readonly prompt: string;
  readonly promptLanguage: PromptLanguage;
  readonly engineVersion: string;
  readonly createdAt: string;
  /** Optional non-safety semantic confidence reported by a future provider. */
  readonly semanticConfidence?: number;
}

export interface AIChoreographyProposalV1 {
  readonly schemaVersion: number;
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly concept: ChoreographyConcept;
  /** Requested fleet size. The builder always emits exactly this many points. */
  readonly fleetCount: number;
  readonly formationSpec: ProposalFormationSpec;
  readonly motionGroups: readonly ChoreographyPart[];
  readonly animationSpec: ProposalAnimationSpec;
  readonly globalMotion: ProposalGlobalMotion;
  readonly timing: ProposalTiming;
  readonly lightingIntent: ProposalLightingIntent;
  readonly assumptions: readonly string[];
  readonly warnings: readonly string[];
  readonly provenance: ProposalProvenance;
}

/** Lifecycle of a draft proposal. It is not project content until applied. */
export type ProposalStatus =
  | "GENERATING"
  | "READY"
  | "INVALID"
  | "VALIDATING"
  | "PASS"
  | "WARNING"
  | "FAIL"
  | "APPLIED";

export interface GenerateProposalRequest {
  readonly prompt: string;
  readonly fleetCount: number;
  /** Area hint so the builder can stay inside the show volume. */
  readonly area?: { readonly width: number; readonly depth: number; readonly height: number };
  readonly seed?: number;
}

export interface RefineProposalRequest {
  readonly proposal: AIChoreographyProposalV1;
  readonly instruction: string;
}

/**
 * Provider boundary. A future OpenAI / Anthropic / Gemini / local-model provider
 * implements the same contract behind a server function; no provider key ever
 * lives in client code.
 */
export interface ChoreographyAIProvider {
  readonly id: string;
  readonly label: string;
  /** True when the same request always yields the same proposal. */
  readonly deterministic: boolean;
  generateProposal(request: GenerateProposalRequest): Promise<AIChoreographyProposalV1>;
  refineProposal(request: RefineProposalRequest): Promise<AIChoreographyProposalV1>;
}

export type AIErrorCode =
  | "EMPTY_PROMPT"
  | "UNSUPPORTED_CONCEPT"
  | "INVALID_PROPOSAL"
  | "PROVIDER_UNAVAILABLE"
  | "BUILD_FAILED";

export class ChoreographyAIError extends Error {
  readonly code: AIErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: AIErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ChoreographyAIError";
    this.code = code;
    this.details = details;
  }
}
