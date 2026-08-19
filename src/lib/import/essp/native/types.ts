/**
 * ESSP IMPORTED TRAJECTORY LAYER — native domain model (A + B).
 *
 * TWO LAYERS, ONE PROJECT
 *
 *   B) IMPORTED TRAJECTORY LAYER (this module)
 *      A byte-preserving copy of the imported ESSP archive. It is the PLAYBACK
 *      AUTHORITY for every interval that has not been promoted, so an
 *      import -> save -> reopen cycle reproduces the imported playback exactly.
 *      The two source clocks stay independent: positions on the 8 Hz clock,
 *      colours sample-and-hold on the 12 Hz clock. Nothing is resampled,
 *      re-planned, optimised or normalised.
 *
 *   A) NATIVE EDITABLE TIMELINE (see extract.ts)
 *      Ordinary project content — Formations, DynamicFormations, TimelineClips,
 *      LightingProgram — extracted from the same archive through the EXISTING
 *      forensic conversion pipeline. It is authoring metadata while the
 *      corresponding interval is still reference-owned.
 *
 * INTERVAL / BOUNDARY OWNERSHIP RULE (the splice contract)
 *
 *   The extracted timeline TILES show time: clip k occupies
 *   TRANSITION [start, start+transition) then HOLD [start+transition, end].
 *   Ownership is stored PER CLIP and DERIVED per interval:
 *
 *     HOLD(k)       owner = binding(k).owner
 *     TRANSITION(k) owner = binding(k).owner AND binding(k-1).owner
 *
 *   because a reference transition is only meaningful when BOTH endpoints are
 *   still the reference endpoints. Consequently promoting clip k promotes
 *   exactly TRANSITION(k), HOLD(k) and TRANSITION(k+1) — the mathematically
 *   necessary boundary — and nothing else. Everything else stays
 *   reference-exact. Show time not covered by any reference-owned interval is
 *   planner-owned; there is no third state and no partial blending.
 *
 * PROMOTION IS FLIGHT-OUTPUT SEMANTIC (see signature.ts)
 *   A clip is promoted only when its flight/LED OUTPUT signature changes.
 *   Renaming, selecting, zooming, tagging, favouriting, annotating or saving
 *   never promotes anything.
 */
import type { LightingProgram } from "../../../show/lighting/types";
import type { Formation, TimelineClip } from "../../../show/types";
import type { DynamicFormation } from "../../../show/dynamic/types";
import type { AssetSaveInput, SceneAssetDependencies } from "../../../library/types";
import type { FormationScene } from "../../../show/scene/types";
import type { ReferenceSegmentClassification } from "../forensics/types";

export const REFERENCE_LAYER_KIND = "ESSP_IMPORTED_TRAJECTORY_LAYER";
export const REFERENCE_LAYER_SCHEMA_VERSION = 1;
export const REFERENCE_EXTRACTION_ALGORITHM_VERSION = "0.1.0";

/**
 * Maximum position discrepancy tolerated where a reference-owned interval meets
 * a planner-owned one. It is a SPLICE tolerance, never a safety limit.
 */
export const SPLICE_TOLERANCE_METERS = 0.05;

export type ReferenceIntervalOwner = "REFERENCE" | "PLANNER";
export type ReferenceIntervalKind = "TRANSITION" | "HOLD";
export type ReferenceClipKind = "TAKEOFF" | "SCENE" | "LANDING";

export type PromotionReason =
  | "OUTPUT_SIGNATURE_CHANGED"
  | "CLIP_REMOVED"
  | "SPLICE_WIDENED"
  | "MANUAL";

/** Per-drone verbatim ESSP bytes (base64 of the exact original file). */
export interface ReferenceLayerDrone {
  readonly sourceId: string;
  readonly numericSourceId: number;
  readonly sourceFile: string;
  /** Base64 of the COMPLETE original .essp file (header + XYZ + RGB). */
  readonly fileBase64: string;
}

/** One extracted clip and its playback ownership. */
export interface ReferenceClipBinding {
  readonly clipId: string;
  /** Extraction order; stable across edits. */
  readonly order: number;
  readonly kind: ReferenceClipKind;
  /** Forensic segment the scene came from (null for takeoff/landing). */
  readonly sourceSegmentId: string | null;
  readonly sourceClassification: ReferenceSegmentClassification | null;
  /** Reference times the clip was extracted from (source of truth for splices). */
  readonly referenceStart: number;
  readonly referenceHoldStart: number;
  readonly referenceEnd: number;
  readonly owner: ReferenceIntervalOwner;
  /** Flight-output signature at extraction (or at the last accepted state). */
  readonly signature: string;
  readonly promotedAt?: string;
  readonly promotionReason?: PromotionReason;
}

/**
 * IMMUTABLE EXTRACTED STATE of one clip's composition.
 *
 * Written once by the extractor and never touched again. It exists only so a
 * single scene OBJECT can be reset to exactly what extraction produced, without
 * re-running the forensic pipeline. It is authoring history, not a playback or
 * ownership authority: restoring it never reclaims REFERENCE ownership.
 */
export interface ReferenceExtractedSceneSnapshot {
  readonly clipId: string;
  readonly scene: FormationScene;
  readonly formations: readonly Formation[];
  readonly dynamicFormations: readonly DynamicFormation[];
}

export interface ReferenceTrajectoryLayer {
  readonly kind: typeof REFERENCE_LAYER_KIND;
  readonly schemaVersion: number;
  readonly importedAt: string;
  readonly extractedAt: string;
  readonly extractionAlgorithmVersion: string;
  /** Deterministic hash of the imported show (identity of the source archive). */
  readonly showHash: string;
  /** INDEPENDENT CLOCKS — preserved verbatim, never unified. */
  readonly positionRateHz: number;
  readonly rgbRateHz: number;
  readonly positionSampleCount: number;
  readonly rgbSampleCount: number;
  readonly positionDurationSeconds: number;
  readonly rgbDurationSeconds: number;
  readonly playbackDurationSeconds: number;
  readonly metersPerUnit: number;
  readonly axisMapping: Readonly<Record<string, string>>;
  readonly drones: readonly ReferenceLayerDrone[];
  readonly bindings: readonly ReferenceClipBinding[];
  /** Extracted-state history per clip; used ONLY by "reset to extracted state". */
  readonly extractedScenes?: readonly ReferenceExtractedSceneSnapshot[];

  /** Reverse-engineering disclaimer, carried with the data. */
  readonly experimental: string;
}

/** One resolved playback interval of the spliced show. */
export interface ResolvedReferenceInterval {
  readonly clipId: string;
  readonly kind: ReferenceIntervalKind;
  readonly start: number;
  readonly end: number;
  readonly owner: ReferenceIntervalOwner;
  readonly clipKind: ReferenceClipKind;
}

export interface ReferenceOwnershipSummary {
  readonly intervals: readonly ResolvedReferenceInterval[];
  readonly referenceIntervalCount: number;
  readonly plannerIntervalCount: number;
  readonly referenceSeconds: number;
  readonly plannerSeconds: number;
  readonly promotedClipIds: readonly string[];
}

/** One boundary check between a reference-owned and a planner-owned interval. */
export interface SpliceBoundaryCheck {
  readonly time: number;
  readonly leftClipId: string;
  readonly rightClipId: string;
  readonly maxDeltaMeters: number;
  readonly worstDroneIndex: number;
  readonly ok: boolean;
}

export interface SpliceVerificationReport {
  readonly toleranceMeters: number;
  readonly boundaries: readonly SpliceBoundaryCheck[];
  readonly ok: boolean;
  readonly worstDeltaMeters: number;
}

export interface ReferencePromotion {
  readonly clipId: string;
  readonly reason: PromotionReason;
  /** Intervals that changed owner as a consequence of this promotion. */
  readonly affectedIntervals: readonly ReferenceIntervalKind[];
  readonly affectedClipIds: readonly string[];
}

export interface ReferenceLayerReconciliation {
  readonly layer: ReferenceTrajectoryLayer;
  readonly promotions: readonly ReferencePromotion[];
  readonly changed: boolean;
}

/**
 * Library asset draft produced by the extractor (never saved by itself).
 *
 * A SCENE draft carries the WHOLE extracted composition of one clip plus the
 * dependencies it references, so an imported scene can be reused exactly like an
 * authored one. Saving a draft is metadata only — it never promotes a clip.
 */
export type ReferenceAssetDraft =
  | {
      readonly kind: "STATIC" | "DYNAMIC";
      readonly formation: Formation | DynamicFormation;
      readonly input: AssetSaveInput;
    }
  | {
      readonly kind: "SCENE";
      readonly scene: FormationScene;
      readonly dependencies: SceneAssetDependencies;
      readonly input: AssetSaveInput;
    };

/** How one extracted scene is represented natively. */
export type ReferenceSceneRepresentation = "STATIC" | "DYNAMIC" | "COMPOSED_SCENE";

/** One inferred object of a decomposed scene, as reported to the operator. */
export interface ReferenceSceneObjectDiagnostic {
  readonly objectId: string;
  readonly name: string;
  readonly droneCount: number;
  readonly sourceDroneIds: readonly string[];
  readonly dynamic: boolean;
  readonly meanResidualMeters: number;
  readonly formationId: string;
  readonly dynamicFormationId: string | null;
}

export interface ReferenceExtractionDiagnostic {
  readonly clipId: string;
  readonly kind: ReferenceClipKind;
  readonly sourceSegmentId: string | null;
  readonly classification: ReferenceSegmentClassification | null;
  readonly referenceStart: number;
  readonly referenceHoldStart: number;
  readonly referenceEnd: number;
  /** Conversion fidelity of the animated extraction, when one was produced. */
  readonly fidelityRmsMeters: number | null;
  readonly fidelityStatus: string | null;
  readonly dynamic: boolean;
  /** STATIC / DYNAMIC / COMPOSED_SCENE for scene clips; STATIC otherwise. */
  readonly representation: ReferenceSceneRepresentation;
  readonly objects: readonly ReferenceSceneObjectDiagnostic[];
  /** Decomposition evidence: confidence and why the decision was taken. */
  readonly decompositionConfidence: number | null;
  readonly decompositionSource: string | null;
  readonly decompositionReasons: readonly string[];
  readonly warnings: readonly string[];
}

export interface ReferenceExtractionResult {
  readonly formations: readonly Formation[];
  readonly dynamicFormations: readonly DynamicFormation[];
  /** Multi-object compositions, one per decomposed scene clip (`scene.id === clip.id`). */
  readonly scenes: readonly FormationScene[];
  readonly timeline: readonly TimelineClip[];
  readonly lighting: LightingProgram;
  readonly layer: ReferenceTrajectoryLayer;
  readonly assets: readonly ReferenceAssetDraft[];
  readonly diagnostics: readonly ReferenceExtractionDiagnostic[];
  readonly droneCount: number;
  readonly durationSeconds: number;
  readonly warnings: readonly string[];
}

export type ReferenceLayerErrorCode =
  | "NO_REFERENCE_SHOW"
  | "NO_FORENSICS_REPORT"
  | "NO_SCENES"
  | "MALFORMED_LAYER"
  | "SHOW_MISMATCH";

export class ReferenceLayerError extends Error {
  readonly code: ReferenceLayerErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: ReferenceLayerErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ReferenceLayerError";
    this.code = code;
    this.details = details;
  }
}

export const REFERENCE_LAYER_LIMITATIONS = [
  "The imported trajectory layer is a byte copy of a REVERSE-ENGINEERED format. Nothing about it is vendor confirmed.",
  "Reference-owned intervals are played back, not planned: they carry no velocity/acceleration/jerk profile and are never validated against the studio flight envelope.",
  "Promotion is irreversible for the affected interval: once an interval is planner-owned, its trajectory is generated, not reference-exact.",
  "Position (8 Hz) and colour (12 Hz) clocks are independent; the resulting duration mismatch is preserved, not hidden.",
  "Extraction is an authoring convenience. A native clip is an approximation of the reference interval it was derived from, with the measured fidelity reported per clip.",
];
