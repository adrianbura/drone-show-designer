/**
 * PERSISTENCE OF THE IMPORTED TRAJECTORY LAYER (lossless).
 *
 * The layer stores the COMPLETE original bytes of every .essp file, base64
 * encoded. Rehydration re-parses them with the ordinary codec, so a reopened
 * project plays back the identical decoded samples on the identical independent
 * clocks — no resampling, no requantisation, no derived approximation.
 */
import { parseEssp } from "../codec";
import { ESSP_COORDINATE_SCALE, DEFAULT_ESSP_AXIS_MAPPING, ESSP_AXIS_MAPPING_DOC, esspToStudio } from "../coordinates";
import { referenceShowHash } from "../forensics/adapter";
import { assembleReferenceShow } from "../reference";
import {
  ESSP_EXPERIMENTAL_LABEL,
  ESSP_HEADER,
  type ParsedEssp,
  type ReferenceDrone,
  type ReferenceShow,
} from "../types";
import { sanitizeScenes } from "../../../show/scene/migrate";
import type { Formation } from "../../../show/types";
import type { DynamicFormation } from "../../../show/dynamic/types";
import {
  REFERENCE_EXTRACTION_ALGORITHM_VERSION,
  REFERENCE_LAYER_KIND,
  REFERENCE_LAYER_SCHEMA_VERSION,
  ReferenceLayerError,
  type ReferenceClipBinding,
  type ReferenceExtractedSceneSnapshot,
  type ReferenceLayerDrone,
  type ReferenceTrajectoryLayer,
} from "./types";

/**
 * Defensive read of the extracted-state history. It is authoring convenience
 * only, so a malformed entry is DROPPED (the reset button then simply stops
 * offering that clip) instead of failing a lossless playback layer.
 */
function sanitizeExtractedScenes(raw: unknown): ReferenceExtractedSceneSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: ReferenceExtractedSceneSnapshot[] = [];
  for (const value of raw) {
    const entry = value as Partial<ReferenceExtractedSceneSnapshot> | null;
    if (!entry || typeof entry.clipId !== "string") continue;
    const [scene] = sanitizeScenes([entry.scene]);
    if (!scene) continue;
    const formations = Array.isArray(entry.formations)
      ? (entry.formations.filter(
          (f) => f && typeof f.id === "string" && Array.isArray(f.points),
        ) as Formation[])
      : [];
    const dynamicFormations = Array.isArray(entry.dynamicFormations)
      ? (entry.dynamicFormations.filter(
          (d) => d && typeof d.id === "string" && Array.isArray(d.points),
        ) as DynamicFormation[])
      : [];
    out.push({ clipId: entry.clipId, scene, formations, dynamicFormations });
  }
  return out;
}


/* ------------------------------------------------------------------ base64 */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Deterministic base64, independent of btoa/Buffer availability. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64[b2 & 63];
  }
  return out;
}

const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i += 1) B64_INDEX[B64[i]!] = i;

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const size = Math.floor((clean.length * 3) / 4) - pad;
  const out = new Uint8Array(Math.max(0, size));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_INDEX[clean[i]!] ?? 0;
    const c1 = B64_INDEX[clean[i + 1]!] ?? 0;
    const c2 = B64_INDEX[clean[i + 2]!] ?? 0;
    const c3 = B64_INDEX[clean[i + 3]!] ?? 0;
    if (o < out.length) out[o++] = (c0 << 2) | (c1 >> 4);
    if (o < out.length) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (o < out.length) out[o++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

/* ------------------------------------------------------- file reconstruction */

/**
 * Rebuilds the exact source file bytes of one imported drone: the verbatim
 * header, the XYZ payload re-encoded little-endian from the decoded int16
 * samples, then the verbatim RGB bytes. Byte-identical to the imported file.
 */
export function referenceDroneFileBytes(drone: ReferenceDrone): Uint8Array {
  const xyzLength = drone.positionSampleCount * 3 * 2;
  const rgbLength = drone.rgbSampleCount * 3;
  const out = new Uint8Array(ESSP_HEADER.size + xyzLength + rgbLength);
  out.set(drone.header.rawBytes.subarray(0, ESSP_HEADER.size), 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < drone.positionSampleCount * 3; i += 1) {
    view.setInt16(ESSP_HEADER.size + i * 2, drone.positionSamples[i] ?? 0, true);
  }
  out.set(drone.rgbSamples.subarray(0, rgbLength), ESSP_HEADER.size + xyzLength);
  return out;
}

/* ------------------------------------------------------------- layer build */

export function buildReferenceLayer(
  show: ReferenceShow,
  bindings: readonly ReferenceClipBinding[],
  options: { extractedAt?: string } = {},
): ReferenceTrajectoryLayer {
  const drones: ReferenceLayerDrone[] = show.drones.map((d) => ({
    sourceId: d.sourceId,
    numericSourceId: d.numericSourceId,
    sourceFile: d.sourceFile,
    fileBase64: bytesToBase64(referenceDroneFileBytes(d)),
  }));
  return {
    kind: REFERENCE_LAYER_KIND,
    schemaVersion: REFERENCE_LAYER_SCHEMA_VERSION,
    importedAt: show.importedAt,
    extractedAt: options.extractedAt ?? new Date().toISOString(),
    extractionAlgorithmVersion: REFERENCE_EXTRACTION_ALGORITHM_VERSION,
    showHash: referenceShowHash(show),
    positionRateHz: show.timing.positionRateHz,
    rgbRateHz: show.timing.rgbRateHz,
    positionSampleCount: show.timing.positionSampleCount,
    rgbSampleCount: show.timing.rgbSampleCount,
    positionDurationSeconds: show.timing.positionDurationSeconds,
    rgbDurationSeconds: show.timing.rgbDurationSeconds,
    playbackDurationSeconds: show.timing.playbackDurationSeconds,
    metersPerUnit: ESSP_COORDINATE_SCALE.metersPerUnit,
    axisMapping: ESSP_AXIS_MAPPING_DOC,
    drones,
    bindings: bindings.map((b) => ({ ...b })),
    experimental: ESSP_EXPERIMENTAL_LABEL,
  };
}

export function withBindings(
  layer: ReferenceTrajectoryLayer,
  bindings: readonly ReferenceClipBinding[],
): ReferenceTrajectoryLayer {
  return { ...layer, bindings: bindings.map((b) => ({ ...b })) };
}

/* -------------------------------------------------------------- rehydration */

/** Rebuilds the immutable reference show from a persisted layer (synchronous). */
export function referenceShowFromLayer(layer: ReferenceTrajectoryLayer): ReferenceShow {
  if (layer.kind !== REFERENCE_LAYER_KIND) {
    throw new ReferenceLayerError("MALFORMED_LAYER", "Not an imported ESSP trajectory layer.");
  }
  const drones: ReferenceDrone[] = [];
  const parsedFiles: ParsedEssp[] = [];
  for (const entry of layer.drones) {
    const parsed = parseEssp(base64ToBytes(entry.fileBase64));
    const s = parsed.xyz;
    drones.push({
      sourceId: entry.sourceId,
      numericSourceId: entry.numericSourceId,
      sourceFile: entry.sourceFile,
      fileSize: parsed.fileSize,
      positionSamples: parsed.xyz,
      rgbSamples: parsed.rgb,
      positionSampleCount: parsed.positionSampleCount,
      rgbSampleCount: parsed.rgbSampleCount,
      launchPosition: esspToStudio(
        [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0],
        DEFAULT_ESSP_AXIS_MAPPING,
      ),
      header: parsed.header,
    });
    parsedFiles.push(parsed);
  }
  if (drones.length === 0) {
    throw new ReferenceLayerError("MALFORMED_LAYER", "The trajectory layer contains no drones.");
  }
  return assembleReferenceShow(drones, parsedFiles, { importedAt: layer.importedAt });
}

/* ---------------------------------------------------------------- migration */

function isBinding(value: unknown): value is ReferenceClipBinding {
  const b = value as Partial<ReferenceClipBinding> | null;
  return (
    !!b &&
    typeof b === "object" &&
    typeof b.clipId === "string" &&
    typeof b.order === "number" &&
    (b.kind === "TAKEOFF" || b.kind === "SCENE" || b.kind === "LANDING") &&
    typeof b.referenceStart === "number" &&
    typeof b.referenceHoldStart === "number" &&
    typeof b.referenceEnd === "number" &&
    (b.owner === "REFERENCE" || b.owner === "PLANNER") &&
    typeof b.signature === "string"
  );
}

/**
 * Validates a persisted layer. A malformed layer is a hard error: silently
 * dropping it would replace reference-exact playback with generated
 * trajectories without telling the operator.
 */
export function migrateReferenceLayer(raw: unknown): ReferenceTrajectoryLayer {
  const c = raw as Partial<ReferenceTrajectoryLayer> | null;
  if (!c || typeof c !== "object") {
    throw new ReferenceLayerError("MALFORMED_LAYER", "The reference layer is malformed.");
  }
  if (c.kind !== REFERENCE_LAYER_KIND) {
    throw new ReferenceLayerError("MALFORMED_LAYER", "Unknown reference layer kind.", {
      kind: c.kind,
    });
  }
  if (typeof c.schemaVersion !== "number" || c.schemaVersion > REFERENCE_LAYER_SCHEMA_VERSION) {
    throw new ReferenceLayerError(
      "MALFORMED_LAYER",
      `Reference layer schema version ${String(c.schemaVersion)} was written by a newer build.`,
      { version: c.schemaVersion },
    );
  }
  if (!Array.isArray(c.drones) || c.drones.length === 0) {
    throw new ReferenceLayerError("MALFORMED_LAYER", "The reference layer has no drone payloads.");
  }
  for (const d of c.drones) {
    if (
      !d ||
      typeof d.sourceId !== "string" ||
      typeof d.numericSourceId !== "number" ||
      typeof d.fileBase64 !== "string" ||
      d.fileBase64.length === 0
    ) {
      throw new ReferenceLayerError("MALFORMED_LAYER", "A reference layer drone payload is malformed.");
    }
  }
  if (!Array.isArray(c.bindings) || !c.bindings.every(isBinding)) {
    throw new ReferenceLayerError("MALFORMED_LAYER", "Reference layer clip bindings are malformed.");
  }
  for (const key of [
    "positionRateHz",
    "rgbRateHz",
    "positionSampleCount",
    "rgbSampleCount",
    "playbackDurationSeconds",
  ] as const) {
    if (typeof c[key] !== "number" || !Number.isFinite(c[key])) {
      throw new ReferenceLayerError("MALFORMED_LAYER", `Reference layer field ${key} is invalid.`);
    }
  }
  return {
    kind: REFERENCE_LAYER_KIND,
    schemaVersion: REFERENCE_LAYER_SCHEMA_VERSION,
    importedAt: typeof c.importedAt === "string" ? c.importedAt : "",
    extractedAt: typeof c.extractedAt === "string" ? c.extractedAt : "",
    extractionAlgorithmVersion:
      typeof c.extractionAlgorithmVersion === "string"
        ? c.extractionAlgorithmVersion
        : REFERENCE_EXTRACTION_ALGORITHM_VERSION,
    showHash: typeof c.showHash === "string" ? c.showHash : "",
    positionRateHz: c.positionRateHz!,
    rgbRateHz: c.rgbRateHz!,
    positionSampleCount: c.positionSampleCount!,
    rgbSampleCount: c.rgbSampleCount!,
    positionDurationSeconds: c.positionDurationSeconds ?? 0,
    rgbDurationSeconds: c.rgbDurationSeconds ?? 0,
    playbackDurationSeconds: c.playbackDurationSeconds!,
    metersPerUnit: c.metersPerUnit ?? ESSP_COORDINATE_SCALE.metersPerUnit,
    axisMapping: c.axisMapping ?? ESSP_AXIS_MAPPING_DOC,
    drones: c.drones.map((d) => ({
      sourceId: d.sourceId,
      numericSourceId: d.numericSourceId,
      sourceFile: typeof d.sourceFile === "string" ? d.sourceFile : `${d.numericSourceId}.essp`,
      fileBase64: d.fileBase64,
    })),
    bindings: c.bindings.map((b) => ({ ...b })),
    ...(() => {
      const extractedScenes = sanitizeExtractedScenes(c.extractedScenes);
      return extractedScenes.length > 0 ? { extractedScenes } : {};
    })(),

    experimental: typeof c.experimental === "string" ? c.experimental : ESSP_EXPERIMENTAL_LABEL,
  };
}
