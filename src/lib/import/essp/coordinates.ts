/**
 * ESSP -> studio coordinate adapter.
 *
 * REVERSE-ENGINEERED. The scale and axis mapping are hypotheses derived from
 * the reference archive, never vendor confirmed. This is the ONLY place where
 * ESSP units are converted; raw decoded values are never mutated.
 */

/** 1 ESSP position unit = 1 cm (HIGH-confidence inference). */
export const ESSP_COORDINATE_SCALE = {
  metersPerUnit: 0.01,
  confidence: "HIGH",
  source: "REFERENCE_ARCHIVE_ANALYSIS",
} as const;

export type EsspAxis = "x" | "y" | "z";

/**
 * Developer-only axis mapping. Default: ESSP X -> studio X (east),
 * ESSP Y -> studio Z (north/depth), ESSP Z -> studio Y (up/altitude).
 * The launch grid of the reference archive varies in ESSP X/Y with a constant
 * ESSP Z, which is consistent with Z being the altitude axis.
 */
export interface EsspAxisMapping {
  studioX: EsspAxis;
  studioY: EsspAxis;
  studioZ: EsspAxis;
  invertX: boolean;
  invertY: boolean;
  invertZ: boolean;
}

export const DEFAULT_ESSP_AXIS_MAPPING: EsspAxisMapping = {
  studioX: "x",
  studioY: "z",
  studioZ: "y",
  invertX: false,
  invertY: false,
  invertZ: false,
};

export const ESSP_AXIS_MAPPING_DOC: Record<string, string> = {
  studioX: "ESSP X (east/right)",
  studioY: "ESSP Z (up / altitude)",
  studioZ: "ESSP Y (north/depth)",
  scale: "0.01 m per ESSP unit (hypothesis)",
  confidence: "HIGH-CONFIDENCE INFERENCE — not vendor confirmed",
};

/** Raw ESSP unit value -> studio metres. */
export function esspUnitsToMeters(value: number): number {
  return value * ESSP_COORDINATE_SCALE.metersPerUnit;
}

export function metersToEsspUnits(meters: number): number {
  return meters / ESSP_COORDINATE_SCALE.metersPerUnit;
}

/** Maps a raw ESSP triplet to studio metres using the given axis mapping. */
export function esspToStudio(
  raw: readonly [number, number, number],
  mapping: EsspAxisMapping = DEFAULT_ESSP_AXIS_MAPPING,
): [number, number, number] {
  const pick = (axis: EsspAxis) => (axis === "x" ? raw[0] : axis === "y" ? raw[1] : raw[2]);
  return [
    esspUnitsToMeters(pick(mapping.studioX)) * (mapping.invertX ? -1 : 1),
    esspUnitsToMeters(pick(mapping.studioY)) * (mapping.invertY ? -1 : 1),
    esspUnitsToMeters(pick(mapping.studioZ)) * (mapping.invertZ ? -1 : 1),
  ];
}

/* ------------------------------------------------ studio -> ESSP (inverse) */

export const ESSP_INT16_MIN = -32768;
export const ESSP_INT16_MAX = 32767;

/**
 * Rounding rule of the metres -> ESSP-unit direction. HALF AWAY FROM ZERO, so
 * the mapping is symmetric around 0 and never biased toward one hemisphere.
 * `Math.round` alone is half-UP (biased for negatives) and is NOT used here.
 */
export const ESSP_ROUNDING = {
  rule: "HALF_AWAY_FROM_ZERO",
  unit: "1 ESSP unit = 0.01 m",
} as const;

export class EsspRangeError extends Error {
  constructor(
    readonly axis: string,
    readonly value: number,
    message: string,
  ) {
    super(message);
    this.name = "EsspRangeError";
  }
}

/** Metres -> integer ESSP units, half away from zero. Never wraps silently. */
export function metersToEsspUnitsRounded(meters: number, axisLabel = "value"): number {
  if (!Number.isFinite(meters)) {
    throw new EsspRangeError(axisLabel, meters, `${axisLabel} is not finite (${String(meters)})`);
  }
  const raw = metersToEsspUnits(meters);
  const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw);
  if (rounded < ESSP_INT16_MIN || rounded > ESSP_INT16_MAX) {
    throw new EsspRangeError(
      axisLabel,
      rounded,
      `${axisLabel} ${meters.toFixed(3)} m = ${rounded} ESSP units, outside the int16 range ` +
        `[${ESSP_INT16_MIN}, ${ESSP_INT16_MAX}] (max ±327.67 m)`,
    );
  }
  return rounded;
}

/** studio axis slot (0=x,1=y,2=z) that carries each ESSP axis, plus inversion. */
function invertMapping(mapping: EsspAxisMapping): {
  x: { slot: 0 | 1 | 2; invert: boolean };
  y: { slot: 0 | 1 | 2; invert: boolean };
  z: { slot: 0 | 1 | 2; invert: boolean };
} {
  const slots: [EsspAxis, 0 | 1 | 2, boolean][] = [
    [mapping.studioX, 0, mapping.invertX],
    [mapping.studioY, 1, mapping.invertY],
    [mapping.studioZ, 2, mapping.invertZ],
  ];
  const out: Partial<Record<EsspAxis, { slot: 0 | 1 | 2; invert: boolean }>> = {};
  for (const [axis, slot, invert] of slots) {
    if (out[axis]) {
      throw new EsspRangeError(axis, slot, `axis mapping is not bijective: ESSP ${axis} used twice`);
    }
    out[axis] = { slot, invert };
  }
  if (!out.x || !out.y || !out.z) {
    throw new EsspRangeError("mapping", 0, "axis mapping does not cover ESSP x, y and z");
  }
  return { x: out.x, y: out.y, z: out.z };
}

/**
 * EXACT inverse of `esspToStudio`: studio metres -> raw ESSP int16 triplet.
 * Integer-centimetre inputs round-trip bit for bit. Overflow is a hard error —
 * an int16 wrap would silently teleport a drone across the field.
 */
export function studioToEssp(
  studio: readonly [number, number, number],
  mapping: EsspAxisMapping = DEFAULT_ESSP_AXIS_MAPPING,
): [number, number, number] {
  const inv = invertMapping(mapping);
  const read = (entry: { slot: 0 | 1 | 2; invert: boolean }, label: string) =>
    metersToEsspUnitsRounded(studio[entry.slot]! * (entry.invert ? -1 : 1), label);
  return [read(inv.x, "ESSP X"), read(inv.y, "ESSP Y"), read(inv.z, "ESSP Z")];
}
