/**
 * ESSP REFERENCE FORMAT — EXPERIMENTAL, REVERSE-ENGINEERED.
 *
 * Everything in this package is derived from binary analysis of a supplied
 * reference archive. Nothing here is vendor documented or vendor confirmed.
 * The importer is READ-ONLY: decoded tracks are never optimised, resampled or
 * mutated by the Studio engines.
 */

export const ESSP_EXPERIMENTAL_LABEL = "EXPERIMENTAL — REVERSE-ENGINEERED REFERENCE FORMAT";

/** Byte layout of the observed 31-byte header. */
export const ESSP_HEADER = {
  size: 31,
  magic: "ESS",
  magicOffset: 0,
  magicSize: 3,
  versionOffset: 3,
  observedVersion: 1,
  opaqueProfileOffset: 4,
  opaqueProfileSize: 13,
  positionRateOffset: 17,
  xyzLengthOffset: 19,
  unknownU16Offset: 23,
  rgbRateOffset: 25,
  rgbLengthOffset: 27,
} as const;

/** Observed rate encoding: Hz x 1000 (HIGH-CONFIDENCE INFERENCE). */
export const ESSP_RATE_DIVISOR = 1000;
export const ESSP_XYZ_SAMPLE_BYTES = 6;
export const ESSP_RGB_SAMPLE_BYTES = 3;

export interface EsspHeader {
  magic: string;
  version: number;
  /** Bytes 4..16 — meaning UNKNOWN, preserved verbatim. */
  opaqueProfileBytes: Uint8Array;
  /** Raw uint16 at offset 17 (reference archive: 8000). */
  positionRateRaw: number;
  /** positionRateRaw / 1000 (observed interpretation). */
  positionRateHz: number;
  xyzPayloadLength: number;
  /** uint16 at offset 23 — meaning UNKNOWN (reference archive: 2). */
  unknownU16: number;
  rgbRateRaw: number;
  rgbRateHz: number;
  rgbPayloadLength: number;
  /** Verbatim header bytes, for forensic comparison. */
  rawBytes: Uint8Array;
}

export interface ParsedEssp {
  header: EsspHeader;
  /** Verbatim XYZ payload bytes (source of truth for re-encoding). */
  xyzBytes: Uint8Array;
  /** Verbatim RGB payload bytes. */
  rgbBytes: Uint8Array;
  /** Decoded raw signed int16 triplets, little-endian. NOT scaled. */
  xyz: Int16Array;
  /** Decoded RGB bytes (identical content to rgbBytes, typed for clarity). */
  rgb: Uint8Array;
  positionSampleCount: number;
  rgbSampleCount: number;
  fileSize: number;
}

export type EsspErrorCode =
  | "TOO_SHORT"
  | "BAD_MAGIC"
  | "UNSUPPORTED_VERSION"
  | "PAYLOAD_EXCEEDS_FILE"
  | "XYZ_LENGTH_NOT_DIVISIBLE"
  | "RGB_LENGTH_NOT_DIVISIBLE"
  | "TRAILING_BYTES";

export class EsspParseError extends Error {
  constructor(
    readonly code: EsspErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EsspParseError";
  }
}

/** Per-file diagnostics — one bad file never aborts a multi-file import. */
export interface EsspFileDiagnostic {
  fileName: string;
  ok: boolean;
  code?: EsspErrorCode | undefined;
  message?: string | undefined;
}

/** Immutable per-drone reference track. */
export interface ReferenceDrone {
  /** ESSP-001 … derived from the numeric filename, not from the binary. */
  sourceId: string;
  numericSourceId: number;
  sourceFile: string;
  fileSize: number;
  /** Raw int16 XYZ triplets (immutable). */
  positionSamples: Int16Array;
  /** Raw RGB bytes (immutable). */
  rgbSamples: Uint8Array;
  positionSampleCount: number;
  rgbSampleCount: number;
  /** First decoded XYZ sample, converted to studio metres. */
  launchPosition: readonly [number, number, number];
  header: EsspHeader;
  sha256?: string | undefined;
}

export interface ReferenceTiming {
  positionSampleCount: number;
  positionRateRaw: number;
  positionRateHz: number;
  /** (count - 1) / rate — last-sample timestamp convention. */
  positionDurationSeconds: number;
  rgbSampleCount: number;
  rgbRateRaw: number;
  rgbRateHz: number;
  rgbDurationSeconds: number;
  /** max(positionDuration, rgbDuration) — see docs/ESSP_REFERENCE_FORMAT.md. */
  playbackDurationSeconds: number;
  endpointConvention: string;
}

export interface LaunchGridInference {
  droneCount: number;
  uniqueXCount: number;
  uniqueYCount: number;
  uniqueZValues: number[];
  /** Raw ESSP units. */
  xSpacingRaw: number | null;
  ySpacingRaw: number | null;
  boundsRaw: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** e.g. "15 x 10" when the first samples form a regular lattice. */
  inferredGrid: string;
  regular: boolean;
}

export interface ReferenceStatistics {
  boundsRaw: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  boundsMeters: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  maxAltitudeMeters: number;
  maxSampleStepMeters: number;
  maxSampledSpeedMps: number;
  minPairwiseDistanceMeters: number;
  minPairwiseDistanceTime: number;
  sampledPositionCount: number;
}

export interface CrossFileInvariants {
  identicalVersion: boolean;
  identicalOpaqueProfile: boolean;
  identicalPositionRate: boolean;
  identicalPositionPayloadLength: boolean;
  identicalUnknownU16: boolean;
  identicalRgbRate: boolean;
  identicalRgbPayloadLength: boolean;
  identicalSampleCounts: boolean;
  identicalFileSize: boolean;
  /** Header regions (offset ranges) that differ across files. */
  differingHeaderOffsets: number[];
  xyzPayloadsDiffer: boolean;
  rgbPayloadsDiffer: boolean;
}

export interface GoldenFixtureCheck {
  expectedGrid: string;
  observedGrid: string;
  gridMatches: boolean;
  expectedSpacingRaw: number;
  observedSpacingRaw: { x: number | null; y: number | null };
  spacingMatches: boolean;
  idsComplete: boolean;
  fileCount: number;
}

export interface ReferenceImportReport {
  files: number;
  validFiles: number;
  invalidFiles: number;
  diagnostics: EsspFileDiagnostic[];
  timing: ReferenceTiming;
  launchGrid: LaunchGridInference;
  invariants: CrossFileInvariants;
  golden: GoldenFixtureCheck;
  coordinateScale: { metersPerUnit: number; confidence: string; source: string };
  axisMapping: Record<string, string>;
  unknownFieldsPreserved: boolean;
  experimental: string;
}

export interface ReferenceShow {
  source: "ESSP_REFERENCE_ARCHIVE";
  /** Read-only trajectory mode marker — never fed to the optimiser. */
  mode: "REFERENCE_IMPORTED_TRAJECTORY";
  drones: ReferenceDrone[];
  timing: ReferenceTiming;
  report: ReferenceImportReport;
  statistics: ReferenceStatistics;
  importedAt: string;
}
