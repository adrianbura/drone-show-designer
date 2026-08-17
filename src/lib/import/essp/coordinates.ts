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
