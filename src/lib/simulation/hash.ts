/**
 * Deterministic simulation payload integrity digest.
 *
 * The SAME algorithm is implemented in the bridge
 * (`simulation_bridge/app/services/integrity.py`) so the service can verify
 * that the package it executes is byte-for-byte the package the studio
 * prepared. FNV-1a (32-bit) applied forward and to the reversed canonical
 * string, matching the style of the analysis-revision digest.
 */

export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Fixed 3-decimal formatting; identical in Python (`f"{v:.3f}"`). */
export function canonicalNumber(v: number): string {
  if (!Number.isFinite(v)) return "nan";
  const s = v.toFixed(3);
  return s === "-0.000" ? "0.000" : s;
}

export interface HashablePayload {
  readonly schemaVersion: number;
  readonly showPackageId: string;
  readonly analysisRevision: string;
  readonly droneId: string;
  readonly sampleRate: number;
  readonly samples: readonly {
    readonly t: number;
    readonly p: readonly [number, number, number];
  }[];
}

export function canonicalPayloadString(payload: HashablePayload): string {
  const head = [
    `sv=${payload.schemaVersion}`,
    `spid=${payload.showPackageId}`,
    `rev=${payload.analysisRevision}`,
    `drone=${payload.droneId}`,
    `sr=${canonicalNumber(payload.sampleRate)}`,
    `n=${payload.samples.length}`,
  ].join("|");
  const body = payload.samples
    .map((s) => `${canonicalNumber(s.t)}:${s.p.map(canonicalNumber).join(",")}`)
    .join(";");
  return `${head}#${body}`;
}

export function simulationPayloadHash(payload: HashablePayload): string {
  const canonical = canonicalPayloadString(payload);
  return `sph-${fnv1a32(canonical)}-${fnv1a32(canonical.split("").reverse().join(""))}`;
}
