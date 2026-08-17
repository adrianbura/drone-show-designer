/**
 * Measurements OF THE IMPORTED SAMPLED DATA. Nothing here modifies the show and
 * nothing here rejects it — the Studio safety limits are not applied.
 */
import { esspToStudio, esspUnitsToMeters, DEFAULT_ESSP_AXIS_MAPPING, type EsspAxisMapping } from "./coordinates";
import type { ReferenceDrone, ReferenceStatistics } from "./types";

/** Minimum pairwise distance over the sampled frames, via a uniform grid hash. */
function minPairwise(
  drones: ReferenceDrone[],
  rateHz: number,
  mapping: EsspAxisMapping,
): { distance: number; time: number } {
  const frames = Math.min(...drones.map((d) => d.positionSampleCount));
  let best = Number.POSITIVE_INFINITY;
  let bestTime = 0;
  const cell = 5; // metres — coarse enough to stay cheap, fine enough to prune
  const buckets = new Map<string, number[]>();
  const px = new Float32Array(drones.length);
  const py = new Float32Array(drones.length);
  const pz = new Float32Array(drones.length);

  for (let f = 0; f < frames; f += 1) {
    buckets.clear();
    for (let d = 0; d < drones.length; d += 1) {
      const s = drones[d]!.positionSamples;
      const a = f * 3;
      const p = esspToStudio([s[a]!, s[a + 1]!, s[a + 2]!], mapping);
      px[d] = p[0];
      py[d] = p[1];
      pz[d] = p[2];
      const key = `${Math.floor(p[0] / cell)}|${Math.floor(p[1] / cell)}|${Math.floor(p[2] / cell)}`;
      const list = buckets.get(key);
      if (list) list.push(d);
      else buckets.set(key, [d]);
    }
    for (const [key, list] of buckets) {
      const [cx, cy, cz] = key.split("|").map(Number) as [number, number, number];
      for (let dx = 0; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            const other = buckets.get(`${cx + dx}|${cy + dy}|${cz + dz}`);
            if (!other) continue;
            const same = dx === 0 && dy === 0 && dz === 0;
            for (const i of list) {
              for (const j of other) {
                if (same && j <= i) continue;
                const d2 =
                  (px[i]! - px[j]!) ** 2 + (py[i]! - py[j]!) ** 2 + (pz[i]! - pz[j]!) ** 2;
                if (d2 < best) {
                  best = d2;
                  bestTime = f / rateHz;
                }
              }
            }
          }
        }
      }
    }
  }
  return { distance: Number.isFinite(best) ? Math.sqrt(best) : Number.POSITIVE_INFINITY, time: bestTime };
}

export function computeReferenceStatistics(
  drones: ReferenceDrone[],
  positionRateHz: number,
  mapping: EsspAxisMapping = DEFAULT_ESSP_AXIS_MAPPING,
): ReferenceStatistics {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let maxStepRaw = 0;
  let sampled = 0;

  for (const drone of drones) {
    const s = drone.positionSamples;
    for (let i = 0; i < drone.positionSampleCount; i += 1) {
      const a = i * 3;
      const x = s[a]!;
      const y = s[a + 1]!;
      const z = s[a + 2]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      sampled += 1;
      if (i > 0) {
        const b = a - 3;
        const step = Math.hypot(x - s[b]!, y - s[b + 1]!, z - s[b + 2]!);
        if (step > maxStepRaw) maxStepRaw = step;
      }
    }
  }

  const boundsRaw = {
    minX: Number.isFinite(minX) ? minX : 0,
    maxX: Number.isFinite(maxX) ? maxX : 0,
    minY: Number.isFinite(minY) ? minY : 0,
    maxY: Number.isFinite(maxY) ? maxY : 0,
    minZ: Number.isFinite(minZ) ? minZ : 0,
    maxZ: Number.isFinite(maxZ) ? maxZ : 0,
  };
  const lo = esspToStudio([boundsRaw.minX, boundsRaw.minY, boundsRaw.minZ], mapping);
  const hi = esspToStudio([boundsRaw.maxX, boundsRaw.maxY, boundsRaw.maxZ], mapping);
  const boundsMeters = {
    minX: Math.min(lo[0], hi[0]),
    maxX: Math.max(lo[0], hi[0]),
    minY: Math.min(lo[1], hi[1]),
    maxY: Math.max(lo[1], hi[1]),
    minZ: Math.min(lo[2], hi[2]),
    maxZ: Math.max(lo[2], hi[2]),
  };
  const maxStepMeters = esspUnitsToMeters(maxStepRaw);
  const pair = drones.length > 1 ? minPairwise(drones, positionRateHz, mapping) : { distance: Infinity, time: 0 };

  return {
    boundsRaw,
    boundsMeters,
    maxAltitudeMeters: boundsMeters.maxY,
    maxSampleStepMeters: maxStepMeters,
    maxSampledSpeedMps: maxStepMeters * positionRateHz,
    minPairwiseDistanceMeters: pair.distance,
    minPairwiseDistanceTime: pair.time,
    sampledPositionCount: sampled,
  };
}
