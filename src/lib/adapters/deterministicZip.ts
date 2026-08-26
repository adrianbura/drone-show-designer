/**
 * Earliest timestamp representable by the ZIP DOS date field.
 *
 * fflate serializes Date values through local calendar fields. Constructing the
 * instant with Date.UTC can therefore become 31 December 1979 in time zones
 * west of UTC and is rejected as outside the ZIP range. A local-calendar Date
 * keeps the serialized fields fixed at 1980-01-01 in every time zone, so the
 * archive remains byte-deterministic.
 */
export const DETERMINISTIC_ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0);
