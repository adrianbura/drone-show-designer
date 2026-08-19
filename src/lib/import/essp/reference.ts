/**
 * Reference show assembly: raw files -> immutable ReferenceShow + import report.
 *
 * READ-ONLY: the produced tracks are never fed to the trajectory planner, the
 * optimiser or the safety auto-fixers. Drone IDs come from numeric filenames.
 */
import { bytesEqual, parseEssp, sha256Hex, encodeEssp } from "./codec";
import {
  DEFAULT_ESSP_AXIS_MAPPING,
  ESSP_AXIS_MAPPING_DOC,
  ESSP_COORDINATE_SCALE,
  esspToStudio,
  type EsspAxisMapping,
} from "./coordinates";
import { inferLaunchGrid } from "./grid";
import { computeReferenceStatistics } from "./stats";
import {
  ESSP_EXPERIMENTAL_LABEL,
  EsspParseError,
  type CrossFileInvariants,
  type EsspFileDiagnostic,
  type GoldenFixtureCheck,
  type ParsedEssp,
  type ReferenceDrone,
  type ReferenceImportReport,
  type ReferenceShow,
  type ReferenceTiming,
} from "./types";

export interface EsspSourceFile {
  name: string;
  bytes: Uint8Array;
}

/** Golden-fixture expectations of the supplied 150-file reference archive. */
export const GOLDEN_REFERENCE = {
  fileCount: 150,
  grid: "15 x 10",
  spacingRaw: 210,
  spacingToleranceRaw: 2,
  positionSamples: 4746,
  rgbSamples: 7120,
  positionRateRaw: 8000,
  rgbRateRaw: 12000,
  xyzPayloadLength: 28476,
  rgbPayloadLength: 21360,
} as const;

/** `1.essp` -> 1. Returns null when the name is not numeric. */
export function numericSourceId(fileName: string): number | null {
  const base = fileName.split("/").pop() ?? fileName;
  const m = /^(\d+)\.essp$/i.exec(base);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

export function esspDroneId(numeric: number): string {
  return `ESSP-${String(numeric).padStart(3, "0")}`;
}

/** Numeric ordering (1, 2, 3 … 150) — never lexicographic. */
export function sortEsspFiles(files: EsspSourceFile[]): EsspSourceFile[] {
  return [...files].sort((a, b) => {
    const na = numericSourceId(a.name);
    const nb = numericSourceId(b.name);
    if (na != null && nb != null) return na - nb;
    if (na != null) return -1;
    if (nb != null) return 1;
    return a.name.localeCompare(b.name);
  });
}

function timingFrom(parsed: ParsedEssp): ReferenceTiming {
  const { header } = parsed;
  const positionDuration =
    parsed.positionSampleCount > 0 ? (parsed.positionSampleCount - 1) / header.positionRateHz : 0;
  const rgbDuration = parsed.rgbSampleCount > 0 ? (parsed.rgbSampleCount - 1) / header.rgbRateHz : 0;
  return {
    positionSampleCount: parsed.positionSampleCount,
    positionRateRaw: header.positionRateRaw,
    positionRateHz: header.positionRateHz,
    positionDurationSeconds: positionDuration,
    rgbSampleCount: parsed.rgbSampleCount,
    rgbRateRaw: header.rgbRateRaw,
    rgbRateHz: header.rgbRateHz,
    rgbDurationSeconds: rgbDuration,
    playbackDurationSeconds: Math.max(positionDuration, rgbDuration),
    endpointConvention:
      "duration = (sampleCount - 1) / rate — the timestamp of the LAST sample. Position and RGB clocks are independent, so the two durations may differ slightly; playback duration is the longer of the two.",
  };
}

function invariantsFrom(parsedFiles: ParsedEssp[]): CrossFileInvariants {
  const first = parsedFiles[0];
  const same = <T>(pick: (p: ParsedEssp) => T) =>
    !!first && parsedFiles.every((p) => pick(p) === pick(first));
  const differingHeaderOffsets: number[] = [];
  if (first) {
    for (let i = 0; i < first.header.rawBytes.byteLength; i += 1) {
      if (parsedFiles.some((p) => p.header.rawBytes[i] !== first.header.rawBytes[i])) {
        differingHeaderOffsets.push(i);
      }
    }
  }
  const identicalOpaqueProfile =
    !!first &&
    parsedFiles.every((p) => bytesEqual(p.header.opaqueProfileBytes, first.header.opaqueProfileBytes));
  const xyzDiffer =
    !!first && parsedFiles.some((p) => p !== first && !bytesEqual(p.xyzBytes, first.xyzBytes));
  const rgbDiffer =
    !!first && parsedFiles.some((p) => p !== first && !bytesEqual(p.rgbBytes, first.rgbBytes));
  return {
    identicalVersion: same((p) => p.header.version),
    identicalOpaqueProfile,
    identicalPositionRate: same((p) => p.header.positionRateRaw),
    identicalPositionPayloadLength: same((p) => p.header.xyzPayloadLength),
    identicalUnknownU16: same((p) => p.header.unknownU16),
    identicalRgbRate: same((p) => p.header.rgbRateRaw),
    identicalRgbPayloadLength: same((p) => p.header.rgbPayloadLength),
    identicalSampleCounts:
      same((p) => p.positionSampleCount) && same((p) => p.rgbSampleCount),
    identicalFileSize: same((p) => p.fileSize),
    differingHeaderOffsets,
    xyzPayloadsDiffer: xyzDiffer,
    rgbPayloadsDiffer: rgbDiffer,
  };
}

function goldenCheck(drones: ReferenceDrone[], grid: GoldenFixtureCheck["observedSpacingRaw"], observedGrid: string): GoldenFixtureCheck {
  const ids = new Set(drones.map((d) => d.numericSourceId));
  const idsComplete =
    drones.length === GOLDEN_REFERENCE.fileCount &&
    Array.from({ length: GOLDEN_REFERENCE.fileCount }, (_, i) => i + 1).every((n) => ids.has(n));
  const near = (v: number | null) =>
    v != null && Math.abs(Math.abs(v) - GOLDEN_REFERENCE.spacingRaw) <= GOLDEN_REFERENCE.spacingToleranceRaw;
  return {
    expectedGrid: GOLDEN_REFERENCE.grid,
    observedGrid,
    gridMatches: observedGrid === GOLDEN_REFERENCE.grid,
    expectedSpacingRaw: GOLDEN_REFERENCE.spacingRaw,
    observedSpacingRaw: grid,
    spacingMatches: near(grid.x) && near(grid.y),
    idsComplete,
    fileCount: drones.length,
  };
}

export interface BuildReferenceOptions {
  mapping?: EsspAxisMapping;
  /** SHA-256 of each source file (slower, useful for forensic comparison). */
  hashFiles?: boolean;
}

export class EsspImportError extends Error {}

/**
 * Parses every supplied file, keeping per-file diagnostics, and assembles the
 * immutable reference show from the valid ones.
 */
export async function buildReferenceShow(
  files: EsspSourceFile[],
  options: BuildReferenceOptions = {},
): Promise<ReferenceShow> {
  const mapping = options.mapping ?? DEFAULT_ESSP_AXIS_MAPPING;
  const ordered = sortEsspFiles(files.filter((f) => /\.essp$/i.test(f.name)));
  if (ordered.length === 0) throw new EsspImportError("no .essp files found in the selection");

  const diagnostics: EsspFileDiagnostic[] = [];
  const parsedFiles: ParsedEssp[] = [];
  const drones: ReferenceDrone[] = [];

  for (const file of ordered) {
    try {
      const parsed = parseEssp(file.bytes);
      const numeric = numericSourceId(file.name) ?? drones.length + 1;
      const s = parsed.xyz;
      drones.push({
        sourceId: esspDroneId(numeric),
        numericSourceId: numeric,
        sourceFile: file.name,
        fileSize: parsed.fileSize,
        positionSamples: parsed.xyz,
        rgbSamples: parsed.rgb,
        positionSampleCount: parsed.positionSampleCount,
        rgbSampleCount: parsed.rgbSampleCount,
        launchPosition: esspToStudio([s[0] ?? 0, s[1] ?? 0, s[2] ?? 0], mapping),
        header: parsed.header,
        ...(options.hashFiles ? { sha256: (await sha256Hex(file.bytes)) ?? undefined } : {}),
      });
      parsedFiles.push(parsed);
      diagnostics.push({ fileName: file.name, ok: true });
    } catch (err) {
      diagnostics.push({
        fileName: file.name,
        ok: false,
        code: err instanceof EsspParseError ? err.code : undefined,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (parsedFiles.length === 0 || !parsedFiles[0]) {
    throw new EsspImportError(
      `no valid ESSP file in the selection (${diagnostics.length} rejected): ${diagnostics[0]?.message ?? ""}`,
    );
  }

  return assembleReferenceShow(drones, parsedFiles, {
    filesConsidered: ordered.length,
    diagnostics,
    mapping,
  });
}

/** Timing derived from one parsed file. Both source clocks stay independent. */
export function referenceTimingFrom(parsed: ParsedEssp): ReferenceTiming {
  return timingFrom(parsed);
}

/**
 * SYNCHRONOUS assembly of the immutable reference show from already-parsed
 * files. Shared by the file importer and by the persisted trajectory layer, so
 * a reopened project rebuilds exactly the show that was imported.
 */
export function assembleReferenceShow(
  drones: ReferenceDrone[],
  parsedFiles: ParsedEssp[],
  options: {
    filesConsidered?: number;
    diagnostics?: EsspFileDiagnostic[];
    mapping?: EsspAxisMapping;
    importedAt?: string;
  } = {},
): ReferenceShow {
  const mapping = options.mapping ?? DEFAULT_ESSP_AXIS_MAPPING;
  const diagnostics = options.diagnostics ?? drones.map((d) => ({ fileName: d.sourceFile, ok: true }));
  const filesConsidered = options.filesConsidered ?? drones.length;
  const first = parsedFiles[0];
  if (!first) throw new EsspImportError("no parsed ESSP file to assemble");
  const timing = timingFrom(first);
  const launchGrid = inferLaunchGrid(
    drones.map((d) => [d.positionSamples[0] ?? 0, d.positionSamples[1] ?? 0, d.positionSamples[2] ?? 0] as const),
  );
  const invariants = invariantsFrom(parsedFiles);
  const report: ReferenceImportReport = {
    files: filesConsidered,
    validFiles: drones.length,
    invalidFiles: filesConsidered - drones.length,
    diagnostics,
    timing,
    launchGrid,
    invariants,
    golden: goldenCheck(
      drones,
      { x: launchGrid.xSpacingRaw, y: launchGrid.ySpacingRaw },
      launchGrid.inferredGrid,
    ),
    coordinateScale: {
      metersPerUnit: ESSP_COORDINATE_SCALE.metersPerUnit,
      confidence: ESSP_COORDINATE_SCALE.confidence,
      source: ESSP_COORDINATE_SCALE.source,
    },
    axisMapping: ESSP_AXIS_MAPPING_DOC,
    unknownFieldsPreserved: true,
    experimental: ESSP_EXPERIMENTAL_LABEL,
  };

  return {
    source: "ESSP_REFERENCE_ARCHIVE",
    mode: "REFERENCE_IMPORTED_TRAJECTORY",
    drones,
    timing,
    report,
    statistics: computeReferenceStatistics(drones, timing.positionRateHz, mapping),
    importedAt: options.importedAt ?? new Date().toISOString(),
  };
}

export interface RoundTripResult {
  filesTested: number;
  bytePerfect: number;
  failures: { fileName: string; reason: string }[];
  hashesCompared: number;
  hashMatches: number;
}

/** DEVELOPER-ONLY: parse -> encode -> compare bytes (and SHA-256 when available). */
export async function verifyRoundTrip(
  files: EsspSourceFile[],
  options: { hash?: boolean } = {},
): Promise<RoundTripResult> {
  const result: RoundTripResult = {
    filesTested: 0,
    bytePerfect: 0,
    failures: [],
    hashesCompared: 0,
    hashMatches: 0,
  };
  for (const file of sortEsspFiles(files.filter((f) => /\.essp$/i.test(f.name)))) {
    result.filesTested += 1;
    try {
      const re = encodeEssp(parseEssp(file.bytes));
      if (bytesEqual(re, file.bytes)) result.bytePerfect += 1;
      else result.failures.push({ fileName: file.name, reason: "re-encoded bytes differ" });
      if (options.hash) {
        const [a, b] = await Promise.all([sha256Hex(file.bytes), sha256Hex(re)]);
        if (a && b) {
          result.hashesCompared += 1;
          if (a === b) result.hashMatches += 1;
          else result.failures.push({ fileName: file.name, reason: "SHA-256 mismatch" });
        }
      }
    } catch (err) {
      result.failures.push({
        fileName: file.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
