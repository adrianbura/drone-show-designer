/**
 * ESSP SOURCE RECOVERY (NOT an export).
 *
 * Returns the ORIGINAL imported .essp files byte-for-byte. Nothing is sampled,
 * no header is rewritten, no coordinate is converted. The bytes come from the
 * verbatim base64 payload stored in the reference trajectory layer at import
 * time, so the recovered files are byte-identical to what the operator dropped
 * into the studio.
 *
 * This action is deliberately independent from `buildEsspExportPackage`: the
 * computed export follows the full-show validation gate, source recovery makes
 * no safety claim about generated flight output at all.
 */
import { zipSync } from "fflate";

import { base64ToBytes } from "../import/essp/native/layer";
import type { ReferenceTrajectoryLayer } from "../import/essp/native/types";
import { DETERMINISTIC_ZIP_MTIME } from "./deterministicZip";

export const ESSP_SOURCE_RECOVERY_KIND = "SOURCE_RECOVERY" as const;

export interface EsspSourceFile {
  /** Original file name when the import preserved one. */
  readonly name: string;
  /** True when `name` came from the imported archive (not a fallback). */
  readonly nameFromSource: boolean;
  readonly bytes: Uint8Array;
  readonly droneIndex: number;
  readonly sourceId: string;
}

export interface EsspSourceRecoveryManifest {
  readonly kind: typeof ESSP_SOURCE_RECOVERY_KIND;
  readonly description: string;
  readonly projectName: string;
  readonly fileCount: number;
  readonly importedAt: string;
  readonly referenceShowHash: string;
  readonly files: readonly string[];
}

export interface EsspSourceRecoveryResult {
  readonly ok: boolean;
  readonly reason: "OK" | "NO_SOURCE";
  readonly files: readonly EsspSourceFile[];
  readonly manifest: EsspSourceRecoveryManifest | null;
  readonly zip: Uint8Array | null;
  readonly zipFileName: string;
  readonly referenceShowHash: string | null;
}

const MANIFEST_NAME = "source-recovery.json";

function slug(name: string): string {
  return name.replace(/\s+/g, "-").toLowerCase();
}

/** Deterministic name: the imported one, else the numeric source id. */
function nameFor(
  drone: ReferenceTrajectoryLayer["drones"][number],
  index: number,
): { name: string; nameFromSource: boolean } {
  const source = drone.sourceFile?.trim();
  if (source) return { name: source.split(/[\\/]/).pop() || source, nameFromSource: true };
  return { name: `${drone.numericSourceId || index + 1}.essp`, nameFromSource: false };
}

export function hasEsspSourceBytes(layer: ReferenceTrajectoryLayer | null | undefined): boolean {
  return !!layer && layer.drones.length > 0 && layer.drones.every((d) => !!d.fileBase64);
}

export function buildOriginalEsspDownload(input: {
  readonly projectName: string;
  readonly layer: ReferenceTrajectoryLayer | null | undefined;
}): EsspSourceRecoveryResult {
  const zipFileName = `${slug(input.projectName || "project")}.original-essp.zip`;
  const layer = input.layer ?? null;
  if (!hasEsspSourceBytes(layer) || !layer) {
    return {
      ok: false,
      reason: "NO_SOURCE",
      files: [],
      manifest: null,
      zip: null,
      zipFileName,
      referenceShowHash: layer?.showHash ?? null,
    };
  }

  const seen = new Map<string, number>();
  const files: EsspSourceFile[] = layer.drones.map((drone, index) => {
    const { name, nameFromSource } = nameFor(drone, index);
    // Collisions would silently drop a file from the archive; disambiguate.
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    const finalName = count === 1 ? name : name.replace(/(\.essp)?$/i, `-${count}$1`);
    return {
      name: finalName,
      nameFromSource,
      bytes: base64ToBytes(drone.fileBase64),
      droneIndex: index,
      sourceId: drone.sourceId,
    };
  });

  const manifest: EsspSourceRecoveryManifest = {
    kind: ESSP_SOURCE_RECOVERY_KIND,
    description:
      "Source recovery: the original imported .essp files, returned byte-for-byte. This is NOT generated flight output.",
    projectName: input.projectName,
    fileCount: files.length,
    importedAt: layer.importedAt,
    referenceShowHash: layer.showHash,
    files: files.map((f) => f.name),
  };

  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.name] = file.bytes;
  entries[MANIFEST_NAME] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const zip = zipSync(entries, { level: 0, mtime: DETERMINISTIC_ZIP_MTIME });

  return {
    ok: true,
    reason: "OK",
    files,
    manifest,
    zip,
    zipFileName,
    referenceShowHash: layer.showHash,
  };
}
