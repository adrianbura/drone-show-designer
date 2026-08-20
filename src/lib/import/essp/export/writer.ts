/**
 * PRODUCTION ESSP WRITER — source-profile preserving.
 *
 * EXPERIMENTAL / REVERSE-ENGINEERED FORMAT. Nothing here is vendor documented,
 * vendor confirmed or certified for flight hardware. This writer exists so a
 * show authored (or edited) in Drone Show Studio can be written back in the
 * SAME byte layout that was observed in the reference archive.
 *
 * It is deliberately separate from `buildSyntheticEssp()` (a test fixture
 * generator): this one is strict, takes an explicit header profile, and FAILS
 * instead of wrapping any out-of-range value.
 */
import {
  ESSP_INT16_MAX,
  ESSP_INT16_MIN,
  EsspRangeError,
} from "../coordinates";
import {
  ESSP_HEADER,
  ESSP_RATE_DIVISOR,
  ESSP_RGB_SAMPLE_BYTES,
  ESSP_XYZ_SAMPLE_BYTES,
  type EsspHeader,
} from "../types";

/** The parts of a header that are NOT derived from the payload. */
export interface EsspHeaderProfile {
  readonly version: number;
  /** Bytes 4..16 — meaning UNKNOWN, copied verbatim from the source when known. */
  readonly opaqueProfileBytes: Uint8Array;
  /** uint16 at offset 23 — meaning UNKNOWN. */
  readonly unknownU16: number;
  /** Where the profile came from, for the manifest / UI status. */
  readonly origin: "SOURCE_FILE" | "OBSERVED_PROFILE_UNVERIFIED";
  readonly sourceFile?: string | undefined;
}

/** The observed profile of the reference archive. UNVERIFIED for authored shows. */
export const OBSERVED_ESSP_PROFILE: EsspHeaderProfile = {
  version: ESSP_HEADER.observedVersion,
  opaqueProfileBytes: new Uint8Array(ESSP_HEADER.opaqueProfileSize),
  unknownU16: 2,
  origin: "OBSERVED_PROFILE_UNVERIFIED",
};

/** Header profile of an imported file: every opaque byte reused verbatim. */
export function profileFromHeader(header: EsspHeader, sourceFile?: string): EsspHeaderProfile {
  return {
    version: header.version,
    opaqueProfileBytes: header.opaqueProfileBytes.slice(0, ESSP_HEADER.opaqueProfileSize),
    unknownU16: header.unknownU16,
    origin: "SOURCE_FILE",
    ...(sourceFile === undefined ? {} : { sourceFile }),
  };
}

export interface EsspWriteInput {
  readonly profile: EsspHeaderProfile;
  readonly positionRateHz: number;
  readonly rgbRateHz: number;
  /** Flat int16 XYZ triplets in RAW ESSP UNITS (3 values per sample). */
  readonly xyzSamples: ArrayLike<number>;
  /** Flat RGB byte triplets (3 values per sample). */
  readonly rgbSamples: ArrayLike<number>;
}

function rateRaw(hz: number, label: string): number {
  if (!Number.isFinite(hz) || hz <= 0) {
    throw new EsspRangeError(label, hz, `${label} must be a positive finite rate, got ${String(hz)}`);
  }
  const raw = hz * ESSP_RATE_DIVISOR;
  if (Math.abs(raw - Math.round(raw)) > 1e-6) {
    throw new EsspRangeError(label, raw, `${label} ${hz} Hz is not representable as Hz x 1000`);
  }
  const rounded = Math.round(raw);
  if (rounded < 0 || rounded > 0xffff) {
    throw new EsspRangeError(label, rounded, `${label} ${hz} Hz does not fit the uint16 rate field`);
  }
  return rounded;
}

/**
 * Writes ONE .essp file. Deterministic: identical input bytes in, identical
 * bytes out, with no timestamps or environment-dependent values anywhere.
 */
export function buildEsspFile(input: EsspWriteInput): Uint8Array {
  const { profile, xyzSamples, rgbSamples } = input;
  if (profile.opaqueProfileBytes.length !== ESSP_HEADER.opaqueProfileSize) {
    throw new EsspRangeError(
      "opaqueProfileBytes",
      profile.opaqueProfileBytes.length,
      `opaque profile must be exactly ${ESSP_HEADER.opaqueProfileSize} bytes`,
    );
  }
  if (!Number.isInteger(profile.version) || profile.version < 0 || profile.version > 255) {
    throw new EsspRangeError("version", profile.version, "version must be a byte");
  }
  if (!Number.isInteger(profile.unknownU16) || profile.unknownU16 < 0 || profile.unknownU16 > 0xffff) {
    throw new EsspRangeError("unknownU16", profile.unknownU16, "unknownU16 must be a uint16");
  }
  if (xyzSamples.length % 3 !== 0) {
    throw new EsspRangeError("xyzSamples", xyzSamples.length, "XYZ stream must be whole triplets");
  }
  if (rgbSamples.length % 3 !== 0) {
    throw new EsspRangeError("rgbSamples", rgbSamples.length, "RGB stream must be whole triplets");
  }

  const positionRateRaw = rateRaw(input.positionRateHz, "position rate");
  const rgbRateRaw = rateRaw(input.rgbRateHz, "RGB rate");
  const xyzLength = (xyzSamples.length / 3) * ESSP_XYZ_SAMPLE_BYTES;
  const rgbLength = (rgbSamples.length / 3) * ESSP_RGB_SAMPLE_BYTES;

  const out = new Uint8Array(ESSP_HEADER.size + xyzLength + rgbLength);
  const view = new DataView(out.buffer);
  out[0] = 0x45; // 'E'
  out[1] = 0x53; // 'S'
  out[2] = 0x53; // 'S'
  out[ESSP_HEADER.versionOffset] = profile.version;
  out.set(profile.opaqueProfileBytes, ESSP_HEADER.opaqueProfileOffset);
  view.setUint16(ESSP_HEADER.positionRateOffset, positionRateRaw, true);
  view.setUint32(ESSP_HEADER.xyzLengthOffset, xyzLength, true);
  view.setUint16(ESSP_HEADER.unknownU16Offset, profile.unknownU16, true);
  view.setUint16(ESSP_HEADER.rgbRateOffset, rgbRateRaw, true);
  view.setUint32(ESSP_HEADER.rgbLengthOffset, rgbLength, true);

  let o = ESSP_HEADER.size;
  for (let i = 0; i < xyzSamples.length; i += 1) {
    const v = xyzSamples[i]!;
    if (!Number.isInteger(v)) {
      throw new EsspRangeError("xyz", v, `XYZ value ${String(v)} is not an integer ESSP unit`);
    }
    if (v < ESSP_INT16_MIN || v > ESSP_INT16_MAX) {
      throw new EsspRangeError("xyz", v, `XYZ value ${v} is outside the int16 range`);
    }
    view.setInt16(o, v, true);
    o += 2;
  }
  for (let i = 0; i < rgbSamples.length; i += 1) {
    const v = rgbSamples[i]!;
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new EsspRangeError("rgb", v, `RGB channel ${String(v)} is not a byte (0..255)`);
    }
    out[o] = v;
    o += 1;
  }
  return out;
}
