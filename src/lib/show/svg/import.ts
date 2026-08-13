/**
 * Browser boundary for SVG import.
 *
 * The ONLY browser-dependent part of the package: reading a local File. The
 * markup is read as inert text, size-checked, then handed to the pure parser.
 * Nothing is uploaded, nothing is injected into the DOM, nothing is fetched.
 */
import { parseSvg } from "./parser";
import {
  DEFAULT_MAX_SVG_BYTES,
  SvgError,
  type SvgAsset,
  type SvgFormationError,
} from "./types";

export interface ImportSvgOptions {
  maxBytes?: number;
  flattenTolerance?: number;
  /** Stable id for the created asset. */
  assetId: string;
}

/** Reads and parses a local .svg file into an {@link SvgAsset}. */
export async function importSvgFile(file: File, options: ImportSvgOptions): Promise<SvgAsset> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SVG_BYTES;
  if (file.size > maxBytes) {
    throw new SvgError(
      "FILE_TOO_LARGE",
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB, above the ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit.`,
    );
  }
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".svg") && file.type !== "image/svg+xml") {
    throw new SvgError("INVALID_SVG", `"${file.name}" is not an SVG file.`);
  }
  const text = await file.text();
  const geometry = parseSvg(text, {
    fileName: file.name,
    byteLength: file.size,
    maxBytes,
    ...(options.flattenTolerance !== undefined ? { flattenTolerance: options.flattenTolerance } : {}),
  });
  return { id: options.assetId, name: file.name, fileName: file.name, geometry };
}

/** Normalises any thrown value into a user-presentable structured error. */
export function toSvgFormationError(err: unknown): SvgFormationError {
  if (err instanceof SvgError) return err.toStructured();
  const base: SvgFormationError = {
    code: "INVALID_SVG",
    message: "The SVG could not be processed.",
  };
  return err instanceof Error ? { ...base, details: err.message } : base;
}
