/** Deterministic, vendor-neutral handoff bundle for external simulators. */
import { zipSync } from "fflate";

import { sha256Hex } from "../import/essp/codec";
import type { GenericExportInput } from "./export";
import { toGenericShowJson, toTrajectoryCsv } from "./export";
import { DETERMINISTIC_ZIP_MTIME } from "./deterministicZip";
import { evaluateExportEligibility } from "./exportEligibility";

export const SIMULATION_HANDOFF_SCHEMA = "DroneShowStudioSimulationHandoff";
export const SIMULATION_HANDOFF_VERSION = 1;

export interface SimulationHandoffInput extends GenericExportInput {
  /** Exact canonical Studio project envelope produced by buildProjectFile(). */
  readonly projectFileJson: string;
}

export type SimulationHandoffResult =
  | {
      readonly ok: true;
      readonly zip: Uint8Array;
      readonly fileName: string;
      readonly manifest: SimulationHandoffManifest;
    }
  | { readonly ok: false; readonly reason: string };

export interface SimulationHandoffManifest {
  readonly schema: typeof SIMULATION_HANDOFF_SCHEMA;
  readonly schemaVersion: typeof SIMULATION_HANDOFF_VERSION;
  readonly projectId: string;
  readonly projectName: string;
  readonly droneCount: number;
  readonly analysisRevision: string;
  readonly validationStatus: string;
  readonly showPackageId: string;
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
  readonly disclaimer: string;
}

const encoder = new TextEncoder();
const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "drone-show";

/**
 * Builds one immutable bundle from one validated revision. No timestamps are
 * embedded, so identical canonical inputs produce byte-identical archives.
 */
export async function buildSimulationHandoff(
  input: SimulationHandoffInput,
): Promise<SimulationHandoffResult> {
  const eligibility = evaluateExportEligibility(input.fullShow, !!input.fullShowStale);
  if (!eligibility.canExportComputedShow || !input.fullShow) {
    const reason =
      eligibility.reason === "NO_REPORT"
        ? "Run full-show validation before building a simulator handoff."
        : eligibility.reason === "STALE"
          ? "The project changed after validation; run full-show validation again."
          : "Full-show validation blocks simulator handoff export.";
    return { ok: false, reason };
  }

  const base = slug(input.project.name);
  const source: Record<string, Uint8Array> = {
    [`${base}.dss.show.json`]: encoder.encode(toGenericShowJson(input)),
    [`${base}.trajectories.csv`]: encoder.encode(
      toTrajectoryCsv(input.project, input.set, input.plan, input.referenceColorsAt),
    ),
    [`${base}.dsp.json`]: encoder.encode(input.projectFileJson),
  };
  const files = [];
  for (const path of Object.keys(source).sort()) {
    const bytes = source[path]!;
    const sha256 = await sha256Hex(bytes);
    if (!sha256) return { ok: false, reason: "SHA-256 is unavailable in this environment." };
    files.push({ path, bytes: bytes.byteLength, sha256 });
  }
  const manifest: SimulationHandoffManifest = {
    schema: SIMULATION_HANDOFF_SCHEMA,
    schemaVersion: SIMULATION_HANDOFF_VERSION,
    projectId: input.project.id,
    projectName: input.project.name,
    droneCount: input.project.droneCount,
    analysisRevision: input.fullShow.analysisRevision,
    validationStatus: input.fullShow.exportReadiness.status,
    showPackageId: input.fullShow.showPackageId,
    files,
    disclaimer:
      "Vendor-neutral simulator handoff; not a flight-controller format or authorisation to fly.",
  };
  source["manifest.json"] = encoder.encode(JSON.stringify(manifest, null, 2));
  const ordered = Object.fromEntries(
    Object.entries(source).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    ok: true,
    zip: zipSync(ordered, { level: 0, mtime: DETERMINISTIC_ZIP_MTIME }),
    fileName: `${base}.simulator-handoff.zip`,
    manifest,
  };
}
