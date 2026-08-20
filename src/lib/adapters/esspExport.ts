/**
 * PRODUCTION ESSP PER-DRONE EXPORT (one .essp per drone + ZIP package).
 *
 * EXPERIMENTAL / REVERSE-ENGINEERED TARGET FORMAT. No vendor certification, no
 * claim of hardware compatibility. See docs/ESSP_REFERENCE_FORMAT.md.
 *
 * AUTHORITY. Positions and LEDs come from the SAME canonical effective show the
 * validator, the simulation package and the other exports read
 * (`sampleEffectiveTrajectorySet` + `referenceColorsAt`/`projectLightingAt`).
 * Clip geometry and UI state are never read here.
 *
 * TWO MODES.
 *  - PRESERVED_PAYLOAD: the project came from an imported ESSP archive, every
 *    interval is still REFERENCE-owned and the fleet still matches the archive.
 *    The archived source bytes are written back verbatim, so the round trip is
 *    byte-exact by construction.
 *  - SAMPLED: anything else. The effective trajectory is sampled on the ESSP
 *    position clock and the canonical lighting on the independent RGB clock.
 */
import { zipSync } from "fflate";

import { referenceDroneFileBytes } from "../import/essp/native/layer";
import { referenceColorsAt } from "../import/essp/native/splice";
import type { ReferenceTrajectoryLayer } from "../import/essp/native/types";
import {
  DEFAULT_ESSP_AXIS_MAPPING,
  ESSP_AXIS_MAPPING_DOC,
  ESSP_COORDINATE_SCALE,
  ESSP_ROUNDING,
  EsspRangeError,
  studioToEssp,
  type EsspAxisMapping,
} from "../import/essp/coordinates";
import {
  buildEsspFile,
  OBSERVED_ESSP_PROFILE,
  profileFromHeader,
  type EsspHeaderProfile,
} from "../import/essp/export/writer";
import { ESSP_EXPERIMENTAL_LABEL } from "../import/essp/types";
import type { ReferenceShow } from "../import/essp/types";
import { sampleEffectiveTrajectorySet } from "../show/fullshow/effective";
import type { FullShowValidationReport } from "../show/fullshow/types";
import { emittedColor, projectLightingAt } from "../show/lighting";
import type { ShowPlan, TrajectorySet } from "../show/trajectory";
import type { RGB, ShowProject, Vector3Tuple } from "../show/types";
import { evaluateExportEligibility, type ExportEligibility } from "./exportEligibility";

/** Rates used when NO imported archive justifies a source rate. */
export const OBSERVED_POSITION_RATE_HZ = 8;
export const OBSERVED_RGB_RATE_HZ = 12;

export const ESSP_EXPORT_VERSION = "1.0.0";

export type EsspExportMode = "PRESERVED_PAYLOAD" | "SAMPLED";
export type EsspProfileStatus = "SOURCE_PROFILE" | "EXPERIMENTAL_PROFILE";

export interface EsspExportFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly droneIndex: number;
  readonly droneId: string;
  readonly sourceFile: string | null;
  readonly profileOrigin: EsspHeaderProfile["origin"];
}

export interface EsspExportManifest {
  readonly format: "ESSP_PER_DRONE_PACKAGE";
  readonly exporterVersion: string;
  readonly projectName: string;
  readonly droneCount: number;
  readonly durationSeconds: number;
  readonly positionRateHz: number;
  readonly rgbRateHz: number;
  readonly positionSampleCount: number;
  readonly rgbSampleCount: number;
  readonly lastPositionTimeSeconds: number;
  readonly lastRgbTimeSeconds: number;
  readonly mode: EsspExportMode;
  readonly sourceProfilePreserved: boolean;
  readonly profileStatus: EsspProfileStatus;
  readonly coordinateMapping: Record<string, string>;
  readonly metersPerEsspUnit: number;
  readonly roundingRule: string;
  readonly referenceShowHash: string | null;
  readonly validationRevision: string | null;
  readonly validationStatus: string | null;
  readonly files: readonly string[];
  readonly generatedAt?: string;
  readonly warning: string;
  readonly experimental: string;
}

export interface EsspExportResult {
  readonly ok: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly mode: EsspExportMode | null;
  readonly profileStatus: EsspProfileStatus;
  readonly files: readonly EsspExportFile[];
  readonly manifest: EsspExportManifest | null;
  readonly zip: Uint8Array | null;
  readonly zipFileName: string;
}

export interface EsspExportInput {
  readonly project: ShowProject;
  readonly plan: ShowPlan;
  readonly reference?: { show: ReferenceShow; layer: ReferenceTrajectoryLayer } | null;
  /** Canonical full-show report (single safety authority). */
  readonly fullShow?: FullShowValidationReport | null;
  readonly fullShowStale?: boolean;
  readonly axisMapping?: EsspAxisMapping;
  /** Optional deterministic timestamp; omitted from the manifest when absent. */
  readonly generatedAt?: string;
}

const MANIFEST_NAME = "manifest.json";

/** Fixed ZIP timestamp (earliest value the format allows) — determinism. */
const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

function fileNameFor(index: number, numericSourceId: number | null): string {
  return `${numericSourceId ?? index + 1}.essp`;
}

/** Interpolates positions of the effective grid — WORLD_SPACE lighting input only. */
function positionsAtFactory(set: TrajectorySet) {
  const start = set.startTime ?? 0;
  const rate = set.sampleRate;
  const frames = set.drones[0]?.samples.length ?? 0;
  return (t: number): Vector3Tuple[] => {
    const exact = (t - start) * rate;
    const i0 = Math.max(0, Math.min(frames - 1, Math.floor(exact)));
    const i1 = Math.min(frames - 1, i0 + 1);
    const f = i1 === i0 ? 0 : Math.max(0, Math.min(1, exact - i0));
    return set.drones.map((d) => {
      const a = d.samples[i0]?.position ?? ([0, 0, 0] as Vector3Tuple);
      const b = d.samples[i1]?.position ?? a;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f] as Vector3Tuple;
    });
  };
}

/** Verifies every source file agrees on the clocks; disagreement is a blocker. */
function sourceRates(show: ReferenceShow): { position: number; rgb: number } | { error: string } {
  const positions = new Set(show.drones.map((d) => d.header.positionRateRaw));
  const rgbs = new Set(show.drones.map((d) => d.header.rgbRateRaw));
  if (positions.size > 1) {
    return {
      error: `Imported files disagree on the position rate (${[...positions].join(", ")} raw); no deterministic export rate policy exists.`,
    };
  }
  if (rgbs.size > 1) {
    return {
      error: `Imported files disagree on the RGB rate (${[...rgbs].join(", ")} raw); no deterministic export rate policy exists.`,
    };
  }
  return { position: show.timing.positionRateHz, rgb: show.timing.rgbRateHz };
}

/** True when nothing in the flight output was taken over by the planner. */
function fullyReferenceOwned(
  layer: ReferenceTrajectoryLayer,
  show: ReferenceShow,
  droneCount: number,
): boolean {
  return (
    layer.bindings.length > 0 &&
    layer.bindings.every((b) => b.owner === "REFERENCE") &&
    show.drones.length === droneCount
  );
}

export function buildEsspExportPackage(input: EsspExportInput): EsspExportResult {
  const { project, plan } = input;
  const reference = input.reference ?? null;
  const mapping = input.axisMapping ?? DEFAULT_ESSP_AXIS_MAPPING;
  const eligibility = evaluateExportEligibility(input.fullShow, !!input.fullShowStale);
  const blockers: string[] = [];
  const warnings: string[] = [...eligibility.warnings];

  const preserved =
    !!reference && fullyReferenceOwned(reference.layer, reference.show, project.droneCount);

  // ---- Gate: the SAME eligibility as every other computed show export.
  //
  // PRESERVED_PAYLOAD is the one documented exemption from a BLOCKED readiness:
  // the studio computed no geometry and no LEDs, it writes the operator's own
  // imported bytes back unchanged. Blocking there would only mean "we refuse to
  // give you back the file you gave us". The findings are still surfaced as
  // warnings, and a missing or stale analysis remains a hard blocker.
  if (!eligibility.canExportComputedShow) {
    if (preserved && eligibility.reason === "BLOCKED") {
      warnings.push(
        "Full-show validation is BLOCKED, but this package is a verbatim copy of the imported archive (no computed geometry or LEDs).",
      );
      warnings.push(...eligibility.blockers);
    } else {
      blockers.push(gateMessage(eligibility));
      blockers.push(...eligibility.blockers);
    }
  }
  const splice = input.fullShow?.splice ?? null;
  if (splice && splice.ok === false) {
    blockers.push("Splice safety check failed — reference/planner handover is discontinuous.");
  }
  if (project.droneCount !== plan.drones.length) {
    blockers.push(
      `Incoherent drone count: project ${project.droneCount} vs plan ${plan.drones.length}.`,
    );
  }

  // ---- Rate policy.
  let positionRateHz = OBSERVED_POSITION_RATE_HZ;
  let rgbRateHz = OBSERVED_RGB_RATE_HZ;
  let profileStatus: EsspProfileStatus = "EXPERIMENTAL_PROFILE";
  if (reference) {
    const rates = sourceRates(reference.show);
    if ("error" in rates) blockers.push(rates.error);
    else {
      positionRateHz = rates.position;
      rgbRateHz = rates.rgb;
    }
    profileStatus = "SOURCE_PROFILE";
  } else {
    warnings.push(
      "No imported archive: the observed ESSP header profile and 8 Hz / 12 Hz clocks are used UNVERIFIED.",
    );
  }

  const zipFileName = `${project.name.replace(/\s+/g, "-").toLowerCase()}.essp-package.zip`;
  if (blockers.length > 0) {
    return {
      ok: false,
      blockers,
      warnings,
      mode: null,
      profileStatus,
      files: [],
      manifest: null,
      zip: null,
      zipFileName,
    };
  }

  const mode: EsspExportMode = preserved ? "PRESERVED_PAYLOAD" : "SAMPLED";

  let files: EsspExportFile[];
  let positionSampleCount: number;
  let rgbSampleCount: number;

  try {
    if (preserved && reference) {
      positionSampleCount = reference.show.timing.positionSampleCount;
      rgbSampleCount = reference.show.timing.rgbSampleCount;
      files = reference.show.drones.map((drone, index) => ({
        name: fileNameFor(index, drone.numericSourceId),
        bytes: referenceDroneFileBytes(drone),
        droneIndex: index,
        droneId: plan.drones[index]?.id ?? drone.sourceId,
        sourceFile: drone.sourceFile,
        profileOrigin: "SOURCE_FILE" as const,
      }));
    } else {
      const sampled = sampleShow({ project, plan, reference, positionRateHz, rgbRateHz, mapping });
      files = sampled.files;
      positionSampleCount = sampled.positionSampleCount;
      rgbSampleCount = sampled.rgbSampleCount;
      warnings.push(...sampled.warnings);
    }
  } catch (error) {
    const message =
      error instanceof EsspRangeError
        ? `ESSP range error: ${error.message}`
        : `ESSP export failed: ${(error as Error).message}`;
    return {
      ok: false,
      blockers: [message],
      warnings,
      mode,
      profileStatus,
      files: [],
      manifest: null,
      zip: null,
      zipFileName,
    };
  }

  const manifest: EsspExportManifest = {
    format: "ESSP_PER_DRONE_PACKAGE",
    exporterVersion: ESSP_EXPORT_VERSION,
    projectName: project.name,
    droneCount: files.length,
    durationSeconds: Number(
      Math.max((positionSampleCount - 1) / positionRateHz, (rgbSampleCount - 1) / rgbRateHz).toFixed(6),
    ),
    positionRateHz,
    rgbRateHz,
    positionSampleCount,
    rgbSampleCount,
    lastPositionTimeSeconds: Number(((positionSampleCount - 1) / positionRateHz).toFixed(6)),
    lastRgbTimeSeconds: Number(((rgbSampleCount - 1) / rgbRateHz).toFixed(6)),
    mode,
    sourceProfilePreserved: profileStatus === "SOURCE_PROFILE",
    profileStatus,
    coordinateMapping: ESSP_AXIS_MAPPING_DOC,
    metersPerEsspUnit: ESSP_COORDINATE_SCALE.metersPerUnit,
    roundingRule: ESSP_ROUNDING.rule,
    referenceShowHash: reference?.layer.showHash ?? null,
    validationRevision: input.fullShow?.analysisRevision ?? null,
    validationStatus: input.fullShow?.exportReadiness.status ?? null,
    files: files.map((f) => f.name),
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
    warning:
      "Reverse-engineered format. Never uploaded to aircraft without independent verification by the operator.",
    experimental: ESSP_EXPERIMENTAL_LABEL,
  };

  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.name] = file.bytes;
  entries[MANIFEST_NAME] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  // level 0 + fixed mtime keeps the archive byte-deterministic.
  const zip = zipSync(entries, { level: 0, mtime: ZIP_EPOCH });

  return { ok: true, blockers: [], warnings, mode, profileStatus, files, manifest, zip, zipFileName };
}

function gateMessage(eligibility: ExportEligibility): string {
  switch (eligibility.reason) {
    case "NO_REPORT":
      return "Run full-show validation before exporting an ESSP package.";
    case "STALE":
      return "The project changed after validation; re-run full-show analysis.";
    default:
      return "Full-show validation BLOCKED — computed show exports are disabled.";
  }
}

/* ------------------------------------------------------------------ sampling */

interface SampleInput {
  readonly project: ShowProject;
  readonly plan: ShowPlan;
  readonly reference: { show: ReferenceShow; layer: ReferenceTrajectoryLayer } | null;
  readonly positionRateHz: number;
  readonly rgbRateHz: number;
  readonly mapping: EsspAxisMapping;
}

/**
 * Samples the canonical effective show onto the two independent ESSP clocks.
 *
 * FRAME COUNTS. With an imported archive the source counts are kept, so a
 * re-export lands on the same grid as the import. Otherwise the counts follow
 * the show duration with last-sample semantics: `t_last = (count - 1) / rate`.
 * Every drone in one package gets the SAME counts — no per-drone off-by-one.
 */
function sampleShow(input: SampleInput): {
  files: EsspExportFile[];
  positionSampleCount: number;
  rgbSampleCount: number;
  warnings: string[];
} {
  const { project, plan, reference, positionRateHz, rgbRateHz, mapping } = input;
  const warnings: string[] = [];
  const startTime = plan.startTime ?? 0;
  const duration = plan.duration;

  const effective = sampleEffectiveTrajectorySet(plan, {
    sampleRate: positionRateHz,
    startTime,
    endTime: startTime + duration,
    ...(reference ? { reference } : {}),
  });
  const set = effective.set;
  const positionsAt = positionsAtFactory(set);

  const positionSampleCount = reference
    ? reference.show.timing.positionSampleCount
    : Math.floor(duration * positionRateHz) + 1;
  const rgbSampleCount = reference
    ? reference.show.timing.rgbSampleCount
    : Math.floor(duration * rgbRateHz) + 1;

  if (set.sampleRate !== positionRateHz) {
    warnings.push(
      `Effective authority sampled at ${set.sampleRate} Hz; positions written on the ${positionRateHz} Hz ESSP clock.`,
    );
  }

  const fleet = project.droneCount;
  // Position stream (per drone), on the ESSP position clock.
  const xyz: Int16Array[] = Array.from({ length: fleet }, () => new Int16Array(positionSampleCount * 3));
  for (let k = 0; k < positionSampleCount; k += 1) {
    const t = startTime + k / positionRateHz;
    const positions = positionsAt(t);
    for (let d = 0; d < fleet; d += 1) {
      const raw = studioToEssp(positions[d] ?? ([0, 0, 0] as Vector3Tuple), mapping);
      const o = k * 3;
      xyz[d]![o] = raw[0];
      xyz[d]![o + 1] = raw[1];
      xyz[d]![o + 2] = raw[2];
    }
  }

  // RGB stream (per drone), on the INDEPENDENT ESSP colour clock: the RGB frames
  // are never tied to the position frame alignment.
  const rgb: Uint8Array[] = Array.from({ length: fleet }, () => new Uint8Array(rgbSampleCount * 3));
  for (let k = 0; k < rgbSampleCount; k += 1) {
    const t = startTime + k / rgbRateHz;
    const imported = reference
      ? referenceColorsAt(reference.show, reference.layer, t, fleet)
      : null;
    const colors: RGB[] =
      imported ??
      projectLightingAt(
        { project, participation: plan.participation, positions: positionsAt(t) },
        t,
      ).map(emittedColor);
    for (let d = 0; d < fleet; d += 1) {
      const c = colors[d] ?? ([0, 0, 0] as RGB);
      const o = k * 3;
      rgb[d]![o] = clampByte(c[0]);
      rgb[d]![o + 1] = clampByte(c[1]);
      rgb[d]![o + 2] = clampByte(c[2]);
    }
  }

  const files: EsspExportFile[] = [];
  for (let d = 0; d < fleet; d += 1) {
    const source = reference?.show.drones[d] ?? null;
    const profile: EsspHeaderProfile = source
      ? profileFromHeader(source.header, source.sourceFile)
      : OBSERVED_ESSP_PROFILE;
    files.push({
      name: fileNameFor(d, source?.numericSourceId ?? null),
      bytes: buildEsspFile({
        profile,
        positionRateHz,
        rgbRateHz,
        xyzSamples: xyz[d]!,
        rgbSamples: rgb[d]!,
      }),
      droneIndex: d,
      droneId: plan.drones[d]?.id ?? `DRONE-${d + 1}`,
      sourceFile: source?.sourceFile ?? null,
      profileOrigin: profile.origin,
    });
  }
  return { files, positionSampleCount, rgbSampleCount, warnings };
}

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
