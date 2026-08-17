/**
 * ESSP REFERENCE SEGMENT -> NATIVE DYNAMIC FORMATION — domain model.
 *
 * The imported ESSP reference show is IMMUTABLE. Conversion only READS it and
 * produces brand-new project objects. Nothing here mutates a ReferenceShow, a
 * ReferenceDrone, a raw ESSP array, a forensic segment or a forensic report.
 *
 * DECOMPOSITION (documented in docs/ESSP_DYNAMIC_CONVERSION.md):
 *
 *   C_ref = fleet centroid at the reference time t_ref
 *   Q_i   = P_i(t_ref) - C_ref                (reference centred / local)
 *   T(t)  = C(t) - C_ref                      (global translation)
 *   R(t)  = best-fit rotation  Q -> centred current cloud   (Kabsch / Horn)
 *   D_i(t) = R(t)^T ( P_i(t) - C(t) ) - Q_i   (LOCAL internal deformation)
 *
 *   P_i(t) = C_ref + T(t) + R(t) [ Q_i + D_i(t) ]
 *
 * which is exactly the native sampler equation with pivot = C_ref,
 * base_i = P_i(t_ref) and unit global scale.
 */
import type {
  ReferenceSceneSegment,
  ReferenceSegmentClassification,
} from "../forensics/types";
import type { DynamicFormation } from "../../../show/dynamic/types";

export const REFERENCE_DYNAMIC_CONVERTER_VERSION = "0.1.0";

/** Segment classes accepted as coherent animated-formation sources. */
export const CONVERTIBLE_CLASSIFICATIONS: readonly ReferenceSegmentClassification[] = [
  "STATIC_FORMATION",
  "GLOBAL_TRANSLATION",
  "GLOBAL_ROTATION",
  "RIGID_MOTION",
  "DYNAMIC_DEFORMATION",
];

/** Experimental — may be a topology morph rather than one animated formation. */
export const EXPERIMENTAL_CLASSIFICATIONS: readonly ReferenceSegmentClassification[] = [
  "FORMATION_TRANSITION",
];

export function segmentEligibility(
  classification: ReferenceSegmentClassification,
): "SUPPORTED" | "EXPERIMENTAL" | "UNSUPPORTED" {
  if (CONVERTIBLE_CLASSIFICATIONS.includes(classification)) return "SUPPORTED";
  if (EXPERIMENTAL_CLASSIFICATIONS.includes(classification)) return "EXPERIMENTAL";
  return "UNSUPPORTED";
}

export type ConversionMode = "EXACT_SAMPLED" | "SIMPLIFIED";

/** Deterministic choice of the frame the base geometry is taken from. */
export type ReferenceFrameMode = "SEGMENT_START" | "LOWEST_DEFORMATION_FRAME" | "USER_SELECTED_FRAME";

/** Rotation estimator. Both reuse the shared forensic Horn/Kabsch solver. */
export type RotationFitMode = "KABSCH" | "ROBUST";

export const CONVERSION_TOLERANCE_PRESETS = {
  HIGH_FIDELITY: 0.01,
  BALANCED: 0.05,
  COMPACT: 0.1,
} as const;

export type ConversionTolerancePreset = keyof typeof CONVERSION_TOLERANCE_PRESETS;

export interface ConversionOptions {
  readonly mode?: ConversionMode;
  /** Reconstruction tolerance in metres (SIMPLIFIED only). NOT a safety limit. */
  readonly toleranceMeters?: number;
  readonly referenceFrame?: ReferenceFrameMode;
  /** Absolute source time used when referenceFrame is USER_SELECTED_FRAME. */
  readonly referenceTime?: number;
  readonly rotationFit?: RotationFitMode;
  /** Suggest (disabled, renameable) motion groups from forensic clusters. */
  readonly suggestMotionGroups?: boolean;
  /** Local RMS below which the segment is reported as a loop candidate (m). */
  readonly loopClosureToleranceMeters?: number;
  /** Residual below which a point counts as part of the stable core (m). */
  readonly stableCoreResidualMeters?: number;
  readonly formationId?: string;
  readonly name?: string;
}

export interface ResolvedConversionOptions {
  readonly mode: ConversionMode;
  readonly toleranceMeters: number;
  readonly referenceFrame: ReferenceFrameMode;
  readonly referenceTime: number | null;
  readonly rotationFit: RotationFitMode;
  readonly suggestMotionGroups: boolean;
  readonly loopClosureToleranceMeters: number;
  readonly stableCoreResidualMeters: number;
}

/** Per-sample extracted global transform, in studio metres / degrees. */
export interface ExtractedTransformSample {
  /** Segment-local time (0 = segment start). */
  readonly t: number;
  readonly translation: readonly [number, number, number];
  /** Sign-continuous quaternion [x, y, z, w]. */
  readonly quaternion: readonly [number, number, number, number];
  /** Euler degrees (X then Y then Z), the native storage representation. */
  readonly rotationEulerDeg: readonly [number, number, number];
  /** Rigid-fit residual RMS at this sample (m) — rotation model error. */
  readonly rigidRmsMeters: number;
}

/** One point's local deformation track (LOCAL coordinates, never world). */
export interface ExtractedDeformationTrack {
  readonly pointId: string;
  readonly sourceDroneId: string;
  /** Offsets in LOCAL (reference-frame) metres, one per source sample. */
  readonly offsets: readonly (readonly [number, number, number])[];
  readonly meanMagnitude: number;
  readonly maxMagnitude: number;
}

export interface SuggestedMotionGroup {
  /** Generic id, e.g. `REFERENCE_CLUSTER_1`. Never semantic. */
  readonly id: string;
  readonly name: string;
  readonly pointIds: readonly string[];
  readonly sourceDroneIds: readonly string[];
  readonly meanResidualMeters: number;
  readonly kind: "CLUSTER" | "STABLE_CORE";
}

export interface LoopClosureAnalysis {
  readonly loopClosureRms: number;
  readonly loopClosureMax: number;
  readonly loopCandidate: boolean;
  /** Forensic periodicity carried over as metadata only. */
  readonly periodicSeconds: number | null;
  readonly periodicityConfidence: number;
}

export interface KeyframeCountReport {
  readonly sourceFrames: number;
  readonly transformKeyframes: number;
  readonly deformationKeyframes: number;
  readonly exactTotalKeyframes: number;
  readonly totalKeyframes: number;
  /** 1 - total/exact, in [0,1]. */
  readonly reduction: number;
}

export type FidelityStatus = "EXCELLENT" | "GOOD" | "APPROXIMATE" | "POOR";

/**
 * Fidelity thresholds on RMS positional error (metres). Documented so that no
 * label ever implies more accuracy than was measured.
 */
export const FIDELITY_STATUS_THRESHOLDS = {
  EXCELLENT: 0.02,
  GOOD: 0.1,
  APPROXIMATE: 0.5,
} as const;

export function fidelityStatusFor(rmsErrorMeters: number): FidelityStatus {
  if (rmsErrorMeters <= FIDELITY_STATUS_THRESHOLDS.EXCELLENT) return "EXCELLENT";
  if (rmsErrorMeters <= FIDELITY_STATUS_THRESHOLDS.GOOD) return "GOOD";
  if (rmsErrorMeters <= FIDELITY_STATUS_THRESHOLDS.APPROXIMATE) return "APPROXIMATE";
  return "POOR";
}

export interface DynamicFormationFidelityReport {
  readonly sourceSegmentId: string;
  readonly sourceSegmentDuration: number;
  readonly droneCount: number;
  readonly sourceSampleCount: number;
  readonly totalComparedPositions: number;
  readonly meanErrorMeters: number;
  readonly medianErrorMeters: number;
  readonly rmsErrorMeters: number;
  readonly p95ErrorMeters: number;
  readonly p99ErrorMeters: number;
  readonly maxErrorMeters: number;
  readonly maxErrorDroneId: string;
  readonly maxErrorTime: number;
  readonly perDroneRmsError: readonly number[];
  readonly perFrameRmsError: readonly number[];
  /** Component split: where the approximation comes from. */
  readonly globalTranslationErrorRms: number;
  readonly globalRotationResidualRms: number;
  readonly internalDeformationErrorRms: number;
  readonly status: FidelityStatus;
  readonly algorithmVersion: string;
}

export interface ConversionProvenance {
  readonly sourceType: "ESSP_REFERENCE_SEGMENT";
  readonly sourceShowHash: string;
  readonly sourceSegmentId: string;
  readonly sourceStartTime: number;
  readonly sourceEndTime: number;
  readonly sourceClassification: ReferenceSegmentClassification;
  readonly conversionMode: ConversionMode;
  readonly conversionTolerance: number;
  readonly conversionAlgorithmVersion: string;
  readonly referenceFrameMode: ReferenceFrameMode;
  readonly referenceTime: number;
  readonly sourceSampleRateHz: number;
  readonly sourceDroneIds: readonly string[];
  readonly activeSourceDroneIds: readonly string[];
  readonly fidelitySummary: {
    readonly meanErrorMeters: number;
    readonly rmsErrorMeters: number;
    readonly p95ErrorMeters: number;
    readonly maxErrorMeters: number;
    readonly status: FidelityStatus;
  };
}

export interface DynamicFormationConversionProposal {
  readonly sourceReferenceShowHash: string;
  readonly sourceSegmentId: string;
  readonly sourceSegmentLabel: string;
  readonly sourceStartTime: number;
  readonly sourceEndTime: number;
  readonly sourceClassification: ReferenceSegmentClassification;
  readonly eligibility: "SUPPORTED" | "EXPERIMENTAL" | "UNSUPPORTED";
  readonly droneCount: number;
  /** Absolute source time the base geometry was taken from. */
  readonly referenceTime: number;
  /** Base geometry in WORLD studio metres (studio coordinates). */
  readonly basePoints: readonly (readonly [number, number, number])[];
  /** Global rotation/scale centre in WORLD studio metres. */
  readonly pivot: readonly [number, number, number];
  readonly extractedGlobalTransformTrack: readonly ExtractedTransformSample[];
  readonly extractedDeformationTracks: readonly ExtractedDeformationTrack[];
  readonly suggestedMotionGroups: readonly SuggestedMotionGroup[];
  readonly sourceSampleRate: number;
  readonly nativeSampleSettings: {
    readonly mode: ConversionMode;
    readonly toleranceMeters: number;
    readonly interpolation: "linear";
    readonly duration: number;
  };
  /** Source sample times, segment-local. */
  readonly sourceTimes: readonly number[];
  /** The proposed, not-yet-applied formation. */
  readonly formation: DynamicFormation;
  readonly fidelityReport: DynamicFormationFidelityReport;
  readonly keyframes: KeyframeCountReport;
  readonly loop: LoopClosureAnalysis;
  readonly provenance: ConversionProvenance;
  readonly options: ResolvedConversionOptions;
  readonly warnings: readonly string[];
  readonly algorithmVersion: string;
}

export type ConversionErrorCode =
  | "NO_SEGMENT"
  | "UNSUPPORTED_CLASSIFICATION"
  | "EMPTY_SEGMENT"
  | "NO_DRONES";

export class ReferenceConversionError extends Error {
  readonly code: ConversionErrorCode;
  constructor(code: ConversionErrorCode, message: string) {
    super(message);
    this.name = "ReferenceConversionError";
    this.code = code;
  }
}

export const CONVERSION_LIMITATIONS = [
  "The decomposition of an arbitrary deforming point cloud into a global rotation and a local deformation is NOT mathematically unique. A deterministic best-fit rigid decomposition is used.",
  "Conversion is a native Studio representation, not an ESSP binary round trip. Byte equivalence is never claimed.",
  "Fidelity is measured only at the original source timestamps; motion faster than the source sample rate is invisible.",
  "Reference lighting (RGB) is never baked into geometry; it is carried as optional metadata only.",
  "Fidelity is not safety. A faithful conversion may still violate the configured Studio flight envelope.",
];

/** Convenience alias used by the studio: the source segment plus its report id. */
export type ConvertibleSegment = ReferenceSceneSegment;
