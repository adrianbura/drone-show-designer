/**
 * ESSP binary codec — parse + byte-preserving encode.
 *
 * `encode(parse(bytes))` MUST return the original bytes for an unmodified file.
 * This is the only verification path for the reverse-engineered layout; it is
 * NOT a production export feature.
 */
import {
  ESSP_HEADER,
  ESSP_RATE_DIVISOR,
  ESSP_RGB_SAMPLE_BYTES,
  ESSP_XYZ_SAMPLE_BYTES,
  EsspParseError,
  type EsspHeader,
  type ParsedEssp,
} from "./types";

function u16le(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32le(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function parseEsspHeader(bytes: Uint8Array): EsspHeader {
  if (bytes.byteLength < ESSP_HEADER.size) {
    throw new EsspParseError(
      "TOO_SHORT",
      `file is ${bytes.byteLength} bytes, shorter than the ${ESSP_HEADER.size}-byte header`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!);
  if (magic !== ESSP_HEADER.magic) {
    throw new EsspParseError("BAD_MAGIC", `expected magic "${ESSP_HEADER.magic}", got "${magic}"`);
  }
  const version = bytes[ESSP_HEADER.versionOffset]!;
  if (version !== ESSP_HEADER.observedVersion) {
    throw new EsspParseError(
      "UNSUPPORTED_VERSION",
      `observed version ${ESSP_HEADER.observedVersion} required, got ${version}`,
    );
  }
  const positionRateRaw = u16le(view, ESSP_HEADER.positionRateOffset);
  const rgbRateRaw = u16le(view, ESSP_HEADER.rgbRateOffset);
  return {
    magic,
    version,
    opaqueProfileBytes: bytes.slice(
      ESSP_HEADER.opaqueProfileOffset,
      ESSP_HEADER.opaqueProfileOffset + ESSP_HEADER.opaqueProfileSize,
    ),
    positionRateRaw,
    positionRateHz: positionRateRaw / ESSP_RATE_DIVISOR,
    xyzPayloadLength: u32le(view, ESSP_HEADER.xyzLengthOffset),
    unknownU16: u16le(view, ESSP_HEADER.unknownU16Offset),
    rgbRateRaw,
    rgbRateHz: rgbRateRaw / ESSP_RATE_DIVISOR,
    rgbPayloadLength: u32le(view, ESSP_HEADER.rgbLengthOffset),
    rawBytes: bytes.slice(0, ESSP_HEADER.size),
  };
}

/** Decodes little-endian int16 triplets independently of platform endianness. */
function decodeXyz(payload: Uint8Array): Int16Array {
  const out = new Int16Array(payload.byteLength / 2);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  for (let i = 0; i < out.length; i += 1) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function parseEssp(input: Uint8Array | ArrayBuffer): ParsedEssp {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const header = parseEsspHeader(bytes);
  const { xyzPayloadLength, rgbPayloadLength } = header;

  if (xyzPayloadLength % ESSP_XYZ_SAMPLE_BYTES !== 0) {
    throw new EsspParseError(
      "XYZ_LENGTH_NOT_DIVISIBLE",
      `XYZ payload length ${xyzPayloadLength} is not divisible by ${ESSP_XYZ_SAMPLE_BYTES}`,
    );
  }
  if (rgbPayloadLength % ESSP_RGB_SAMPLE_BYTES !== 0) {
    throw new EsspParseError(
      "RGB_LENGTH_NOT_DIVISIBLE",
      `RGB payload length ${rgbPayloadLength} is not divisible by ${ESSP_RGB_SAMPLE_BYTES}`,
    );
  }
  const expected = ESSP_HEADER.size + xyzPayloadLength + rgbPayloadLength;
  if (expected > bytes.byteLength) {
    throw new EsspParseError(
      "PAYLOAD_EXCEEDS_FILE",
      `header declares ${expected} bytes but file is ${bytes.byteLength}`,
    );
  }
  if (expected < bytes.byteLength) {
    throw new EsspParseError(
      "TRAILING_BYTES",
      `${bytes.byteLength - expected} unexpected trailing bytes after the declared payloads`,
    );
  }

  const xyzBytes = bytes.slice(ESSP_HEADER.size, ESSP_HEADER.size + xyzPayloadLength);
  const rgbBytes = bytes.slice(ESSP_HEADER.size + xyzPayloadLength, expected);
  return {
    header,
    xyzBytes,
    rgbBytes,
    xyz: decodeXyz(xyzBytes),
    rgb: rgbBytes,
    positionSampleCount: xyzPayloadLength / ESSP_XYZ_SAMPLE_BYTES,
    rgbSampleCount: rgbPayloadLength / ESSP_RGB_SAMPLE_BYTES,
    fileSize: bytes.byteLength,
  };
}

/**
 * DEVELOPER-ONLY re-encode, for round-trip verification. Rebuilds the file from
 * the preserved raw regions, so an unmodified parse round-trips byte for byte.
 */
export function encodeEssp(parsed: ParsedEssp): Uint8Array {
  const out = new Uint8Array(
    ESSP_HEADER.size + parsed.xyzBytes.byteLength + parsed.rgbBytes.byteLength,
  );
  out.set(parsed.header.rawBytes, 0);
  out.set(parsed.xyzBytes, ESSP_HEADER.size);
  out.set(parsed.rgbBytes, ESSP_HEADER.size + parsed.xyzBytes.byteLength);
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** SHA-256 hex digest via Web Crypto. Returns null when unavailable. */
export async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const copy = new Uint8Array(bytes);
  const digest = await subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Builds a synthetic ESSP file using the observed profile. Test fixture only —
 * no claim whatsoever that real hardware accepts it.
 */
export function buildSyntheticEssp(options: {
  xyz: number[][];
  rgb: number[][];
  positionRateRaw?: number;
  rgbRateRaw?: number;
  opaqueProfileBytes?: number[];
  unknownU16?: number;
  version?: number;
}): Uint8Array {
  const xyzLen = options.xyz.length * ESSP_XYZ_SAMPLE_BYTES;
  const rgbLen = options.rgb.length * ESSP_RGB_SAMPLE_BYTES;
  const out = new Uint8Array(ESSP_HEADER.size + xyzLen + rgbLen);
  const view = new DataView(out.buffer);
  out[0] = 0x45;
  out[1] = 0x53;
  out[2] = 0x53;
  out[ESSP_HEADER.versionOffset] = options.version ?? ESSP_HEADER.observedVersion;
  const profile = options.opaqueProfileBytes ?? Array.from({ length: 13 }, (_, i) => i + 1);
  out.set(new Uint8Array(profile.slice(0, 13)), ESSP_HEADER.opaqueProfileOffset);
  view.setUint16(ESSP_HEADER.positionRateOffset, options.positionRateRaw ?? 8000, true);
  view.setUint32(ESSP_HEADER.xyzLengthOffset, xyzLen, true);
  view.setUint16(ESSP_HEADER.unknownU16Offset, options.unknownU16 ?? 2, true);
  view.setUint16(ESSP_HEADER.rgbRateOffset, options.rgbRateRaw ?? 12000, true);
  view.setUint32(ESSP_HEADER.rgbLengthOffset, rgbLen, true);
  let o = ESSP_HEADER.size;
  for (const [x, y, z] of options.xyz) {
    view.setInt16(o, x ?? 0, true);
    view.setInt16(o + 2, y ?? 0, true);
    view.setInt16(o + 4, z ?? 0, true);
    o += 6;
  }
  for (const [r, g, b] of options.rgb) {
    out[o] = (r ?? 0) & 0xff;
    out[o + 1] = (g ?? 0) & 0xff;
    out[o + 2] = (b ?? 0) & 0xff;
    o += 3;
  }
  return out;
}
