/**
 * SOURCE-DERIVED SAFETY PROFILE for an imported ESSP show.
 *
 * Pure, read-only measurement of the imported trajectories (every source
 * position frame, all drones). The profile lets "Make editable" judge the
 * imported show against its own measured envelope instead of another
 * project's defaults. It NEVER authorises flight: limits only loosen up to
 * what the source itself already flies, and are never stricter than defaults.
 */
import { DEFAULT_ALTITUDES, DEFAULT_AREA, DEFAULT_LIMITS } from "../../../show/defaultProject";
import type {
  ImportedSafetyProfile,
  PhaseAltitudes,
  SafetyLimits,
  ShowArea,
} from "../../../show/types";
import type { ReferenceForensicsReport } from "../forensics/types";
import { sampleReferenceShow } from "../playback";
import type { ReferenceShow } from "../types";

export const IMPORTED_PROFILE_NOTE =
  "Validated against the profile derived from the imported show — NOT flight authorization.";

const floorTo = (v: number, s: number) => Math.floor(v / s + 1e-9) * s;
const ceilTo = (v: number, s: number) => Math.ceil(v / s - 1e-9) * s;
const r = (v: number) => Math.round(v * 1000) / 1000;

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function frameMinSeparation(pts: readonly (readonly number[])[], cell: number): number {
  const grid = new Map<string, number[]>();
  let best = Infinity;
  pts.forEach((p, i) => {
    const cx = Math.floor(p[0]! / cell);
    const cy = Math.floor(p[1]! / cell);
    const cz = Math.floor(p[2]! / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const j of list) {
            const q = pts[j]!;
            const d = Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
            if (d < best) best = d;
          }
        }
    const key = `${cx},${cy},${cz}`;
    const own = grid.get(key);
    if (own) own.push(i);
    else grid.set(key, [i]);
  });
  return best;
}

export function deriveImportedSafetyProfile(
  show: ReferenceShow,
  report: ReferenceForensicsReport | null,
): { area: ShowArea; altitudes: PhaseAltitudes; limits: SafetyLimits; profile: ImportedSafetyProfile } {
  const rate = show.timing.positionRateHz;
  const count = show.timing.positionSampleCount;
  const dt = 1 / rate;
  const airStart = report?.takeoffInterval?.endTime ?? 0;
  const airEnd = report?.landingInterval?.startTime ?? (count - 1) / rate;
  let maxAbsX = 0;
  let maxAbsZ = 0;
  let maxY = 0;
  let minAirY = Infinity;
  let minSep = Infinity;
  let maxV = 0;
  let maxA = 0;
  let maxJ = 0;
  const showHeights: number[] = [];
  let prevP: number[][] | null = null;
  let prevV: number[][] | null = null;
  let prevA: number[][] | null = null;
  const sepCell = Math.max(DEFAULT_LIMITS.minSeparation, 3);
  for (let f = 0; f < count; f++) {
    const t = f / rate;
    const pts = sampleReferenceShow(show, t).map((s) => s.position as number[]);
    const air = t >= airStart - 1e-9 && t <= airEnd + 1e-9;
    const v: number[][] = [];
    const a: number[][] = [];
    const j: number[][] = [];
    pts.forEach((p, i) => {
      maxAbsX = Math.max(maxAbsX, Math.abs(p[0]!));
      maxAbsZ = Math.max(maxAbsZ, Math.abs(p[2]!));
      maxY = Math.max(maxY, p[1]!);
      if (air) minAirY = Math.min(minAirY, p[1]!);
      if (prevP) {
        const q = prevP[i]!;
        v[i] = [(p[0]! - q[0]!) / dt, (p[1]! - q[1]!) / dt, (p[2]! - q[2]!) / dt];
        maxV = Math.max(maxV, Math.hypot(...(v[i] as [number, number, number])));
        if (prevV) {
          const pv = prevV[i]!;
          a[i] = v[i]!.map((x, k) => (x - pv[k]!) / dt);
          maxA = Math.max(maxA, Math.hypot(...(a[i] as [number, number, number])));
          if (prevA) {
            const pa = prevA[i]!;
            j[i] = a[i]!.map((x, k) => (x - pa[k]!) / dt);
            maxJ = Math.max(maxJ, Math.hypot(...(j[i] as [number, number, number])));
          }
        }
      }
    });
    if (air) {
      minSep = Math.min(minSep, frameMinSeparation(pts, sepCell));
      if (f % Math.max(1, Math.round(rate)) === 0) showHeights.push(median(pts.map((p) => p[1]!)));
    }
    prevP = pts;
    prevV = prevP && v.length ? v : null;
    prevA = a.length ? a : null;
  }
  const takeoffEnd = report?.takeoffInterval?.endTime;
  const takeoffHeight =
    takeoffEnd !== undefined
      ? median(sampleReferenceShow(show, takeoffEnd).map((s) => s.position[1]))
      : DEFAULT_ALTITUDES.takeoff;
  const area: ShowArea = {
    width: Math.max(DEFAULT_AREA.width, ceilTo(2 * maxAbsX + 10, 1)),
    depth: Math.max(DEFAULT_AREA.depth, ceilTo(2 * maxAbsZ + 10, 1)),
    height: Math.max(DEFAULT_AREA.height, ceilTo(maxY + 5, 1)),
  };
  const limits: SafetyLimits = {
    maxVelocity: Math.max(DEFAULT_LIMITS.maxVelocity, r(ceilTo(maxV, 0.1))),
    maxAcceleration: Math.max(DEFAULT_LIMITS.maxAcceleration, r(ceilTo(maxA, 0.1))),
    maxJerk: Math.max(DEFAULT_LIMITS.maxJerk, r(ceilTo(maxJ, 0.1))),
    // ESSP carries no yaw channel: the default stays, measured value unknown.
    maxYawRate: DEFAULT_LIMITS.maxYawRate,
    minSeparation: Number.isFinite(minSep)
      ? Math.min(DEFAULT_LIMITS.minSeparation, r(floorTo(minSep, 0.05)))
      : DEFAULT_LIMITS.minSeparation,
    minAltitude: Number.isFinite(minAirY)
      ? Math.max(0, Math.min(DEFAULT_LIMITS.minAltitude, r(floorTo(minAirY, 0.1))))
      : DEFAULT_LIMITS.minAltitude,
    maxAltitude: Math.min(area.height, Math.max(DEFAULT_LIMITS.maxAltitude, ceilTo(maxY, 1))),
  };
  const showMedian = median(showHeights);
  const altitudes: PhaseAltitudes = {
    takeoff: Number.isFinite(takeoffHeight) ? r(takeoffHeight) : DEFAULT_ALTITUDES.takeoff,
    show: Number.isFinite(showMedian) ? r(showMedian) : DEFAULT_ALTITUDES.show,
    landing: 0,
  };
  return {
    area,
    altitudes,
    limits,
    profile: {
      source: "IMPORTED_SHOW",
      note: IMPORTED_PROFILE_NOTE,
      measured: {
        maxAbsX: r(maxAbsX),
        maxAbsZ: r(maxAbsZ),
        maxAltitude: r(maxY),
        minAirborneAltitude: Number.isFinite(minAirY) ? r(minAirY) : null,
        minAirborneSeparation: Number.isFinite(minSep) ? r(minSep) : null,
        maxVelocity: r(maxV),
        maxAcceleration: r(maxA),
        maxJerk: r(maxJ),
        maxYawRate: null,
      },
    },
  };
}
