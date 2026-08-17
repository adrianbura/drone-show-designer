/**
 * Launch grid reconstruction from the FIRST decoded XYZ sample of every file.
 * Dimensions are inferred from data — never hard-coded.
 */
import type { LaunchGridInference } from "./types";

function uniqueSorted(values: number[], tolerance = 1): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || Math.abs(v - last) > tolerance) out.push(v);
  }
  return out;
}

function medianSpacing(values: number[]): number | null {
  if (values.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i += 1) diffs.push(values[i]! - values[i - 1]!);
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs.length % 2 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
}

/** `firstSamples` are RAW ESSP triplets, one per drone, in numeric ID order. */
export function inferLaunchGrid(firstSamples: readonly (readonly [number, number, number])[]): LaunchGridInference {
  const xs = firstSamples.map((p) => p[0]);
  const ys = firstSamples.map((p) => p[1]);
  const zs = firstSamples.map((p) => p[2]);
  const ux = uniqueSorted(xs);
  const uy = uniqueSorted(ys);
  const uz = uniqueSorted(zs);
  const regular = firstSamples.length > 0 && ux.length * uy.length === firstSamples.length;
  return {
    droneCount: firstSamples.length,
    uniqueXCount: ux.length,
    uniqueYCount: uy.length,
    uniqueZValues: uz,
    xSpacingRaw: medianSpacing(ux),
    ySpacingRaw: medianSpacing(uy),
    boundsRaw: {
      minX: Math.min(...xs, 0),
      maxX: Math.max(...xs, 0),
      minY: Math.min(...ys, 0),
      maxY: Math.max(...ys, 0),
      minZ: Math.min(...zs, 0),
      maxZ: Math.max(...zs, 0),
    },
    inferredGrid: `${ux.length} x ${uy.length}`,
    regular,
  };
}
