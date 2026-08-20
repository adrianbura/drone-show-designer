/**
 * EXPORT PREFLIGHT — PURE PRESENTATION MODEL.
 *
 * This module RECOMPUTES NOTHING. It reads the canonical authorities
 * (`FullShowValidationReport`, the reference ownership summary, the imported
 * archive clocks) and flattens them into a display model for the operator.
 *
 * Export enablement mirrors `evaluateExportEligibility` exactly — there is no
 * second gate here.
 */
import {
  OBSERVED_POSITION_RATE_HZ,
  OBSERVED_RGB_RATE_HZ,
  type EsspExportMode,
  type EsspProfileStatus,
} from "./esspExport";
import { evaluateExportEligibility } from "./exportEligibility";
import type { FullShowValidationReport } from "@/lib/show/fullshow/types";

export type PreflightStatus = "READY" | "WARNING" | "BLOCKED" | "STALE" | "NOT_ANALYZED";

/** Clocks + fleet size of the imported ESSP archive (null when authored). */
export interface PreflightReferenceSource {
  readonly positionRateHz: number;
  readonly rgbRateHz: number;
  readonly droneFileCount: number;
}

export interface PreflightOwnershipInput {
  readonly referenceIntervalCount: number;
  readonly plannerIntervalCount: number;
  readonly referenceSeconds: number;
  readonly plannerSeconds: number;
}

export interface ExportPreflightInput {
  readonly droneCount: number;
  readonly showDuration: number;
  readonly report: FullShowValidationReport | null | undefined;
  readonly stale: boolean;
  /** Deterministic revision of the CURRENT project + analysis settings. */
  readonly currentRevision: string;
  readonly referenceSource?: PreflightReferenceSource | null;
  readonly ownership?: PreflightOwnershipInput | null;
  /** True when original imported .essp bytes are still available. */
  readonly hasSourceFiles: boolean;
}

export interface PreflightMetric {
  readonly label: string;
  readonly value: string;
}

export interface ExportPreflightOwnership {
  readonly referenceIntervals: number;
  readonly plannerIntervals: number;
  readonly referenceSeconds: number;
  readonly plannerSeconds: number;
  readonly authority: "REFERENCE_ONLY" | "PLANNER_ONLY" | "MIXED_AUTHORITY";
}

export interface ExportPreflightModel {
  readonly status: PreflightStatus;
  readonly statusDetail: string;
  readonly droneCount: number;
  readonly showDurationSeconds: number;
  readonly validationRevision: string | null;
  readonly currentRevision: string;
  readonly revisionFresh: boolean;
  readonly spliceStatus: "OK" | "DISCONTINUOUS" | "NOT_APPLICABLE";
  /** Canonical safety metrics, when a report exists. */
  readonly metrics: readonly PreflightMetric[];
  readonly positionRateHz: number;
  readonly rgbRateHz: number;
  readonly profileStatus: EsspProfileStatus;
  readonly outputMode: EsspExportMode;
  readonly ownership: ExportPreflightOwnership | null;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  /** Mirrors canonical export eligibility — never a second gate. */
  readonly canExportGenerated: boolean;
  readonly generatedBlockedReason: string | null;
  readonly canRecoverSource: boolean;
  readonly needsValidation: boolean;
}

const STATUS_DETAIL: Record<PreflightStatus, string> = {
  READY: "Validated against the current safety profile. Not a real-world safety guarantee.",
  WARNING: "Export allowed by canonical eligibility with non-blocking warnings.",
  BLOCKED: "Canonical validation BLOCKED — generated flight output is disabled.",
  STALE: "The project changed after validation — re-run full-show analysis.",
  NOT_ANALYZED: "No full-show analysis for this project yet.",
};

const GENERATED_BLOCKED_REASON: Partial<Record<PreflightStatus, string>> = {
  BLOCKED: "Full-show validation BLOCKED — resolve the blockers listed below.",
  STALE: "Validation is stale — run Full-Show Validation again before exporting.",
  NOT_ANALYZED: "Run Full-Show Validation before generating flight output.",
};

function num(value: number, digits: number, unit: string): string {
  return `${value.toFixed(digits)} ${unit}`;
}

export function buildExportPreflight(input: ExportPreflightInput): ExportPreflightModel {
  const report = input.report ?? null;
  const eligibility = evaluateExportEligibility(report, input.stale);

  const status: PreflightStatus = !report
    ? "NOT_ANALYZED"
    : input.stale
      ? "STALE"
      : eligibility.reason === "BLOCKED"
        ? "BLOCKED"
        : eligibility.reason === "OK_WITH_WARNINGS"
          ? "WARNING"
          : "READY";

  const source = input.referenceSource ?? null;
  const ownershipInput = input.ownership ?? null;

  const ownership: ExportPreflightOwnership | null = ownershipInput
    ? {
        referenceIntervals: ownershipInput.referenceIntervalCount,
        plannerIntervals: ownershipInput.plannerIntervalCount,
        referenceSeconds: ownershipInput.referenceSeconds,
        plannerSeconds: ownershipInput.plannerSeconds,
        authority:
          ownershipInput.referenceIntervalCount > 0 && ownershipInput.plannerIntervalCount > 0
            ? "MIXED_AUTHORITY"
            : ownershipInput.referenceIntervalCount > 0
              ? "REFERENCE_ONLY"
              : "PLANNER_ONLY",
      }
    : null;

  // Mirrors the exporter's own PRESERVED_PAYLOAD condition (informational).
  const preserved =
    !!source &&
    !!ownership &&
    ownership.authority === "REFERENCE_ONLY" &&
    source.droneFileCount === input.droneCount;

  const metrics: PreflightMetric[] = [];
  if (report) {
    const worst = report.safety.worst;
    metrics.push({ label: "min separation", value: num(worst.minSeparation, 2, "m") });
    metrics.push({ label: "peak speed", value: num(worst.maxVelocity, 2, "m/s") });
    metrics.push({ label: "peak acceleration", value: num(worst.maxAcceleration, 2, "m/s²") });
    metrics.push({ label: "peak jerk", value: num(report.safety.metrics.maxJerk, 1, "m/s³") });
  }

  return {
    status,
    statusDetail: STATUS_DETAIL[status],
    droneCount: input.droneCount,
    showDurationSeconds: input.showDuration,
    validationRevision: report?.analysisRevision ?? null,
    currentRevision: input.currentRevision,
    revisionFresh: !!report && !input.stale,
    spliceStatus: report?.splice ? (report.splice.ok ? "OK" : "DISCONTINUOUS") : "NOT_APPLICABLE",
    metrics,
    positionRateHz: source?.positionRateHz ?? OBSERVED_POSITION_RATE_HZ,
    rgbRateHz: source?.rgbRateHz ?? OBSERVED_RGB_RATE_HZ,
    profileStatus: source ? "SOURCE_PROFILE" : "EXPERIMENTAL_PROFILE",
    outputMode: preserved ? "PRESERVED_PAYLOAD" : "SAMPLED",
    ownership,
    blockers: eligibility.blockers,
    warnings: eligibility.warnings,
    canExportGenerated: eligibility.canExportComputedShow,
    generatedBlockedReason: GENERATED_BLOCKED_REASON[status] ?? null,
    canRecoverSource: input.hasSourceFiles,
    needsValidation: status === "STALE" || status === "NOT_ANALYZED",
  };
}
