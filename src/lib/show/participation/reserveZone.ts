/**
 * RESERVE ZONE — airborne holding geometry for non-participating drones.
 *
 * Deterministic GRID layout: a near-square horizontal lattice centred on the
 * configured zone centre, rotated around +Y by `orientationDeg`, filled
 * row-major. Slot count always equals the number of drones that need one, never
 * rows * columns.
 *
 * `autoReserveZone` PROPOSES a zone outside the artistic footprint. It never
 * bypasses validation: the proposed geometry is planned, deconflicted and
 * validated like any other target.
 */
import type { SafetyLimits, ShowArea, Vector3Tuple } from "../types";
import { footprintOf, type Footprint } from "./cost";
import type { ReserveZoneConfig } from "./types";

/** Near-square grid dimensions, wider than deep, for `count` slots. */
export function reserveGridShape(count: number): { columns: number; rows: number } {
  if (count <= 0) return { columns: 0, rows: 0 };
  const columns = Math.ceil(Math.sqrt(count));
  return { columns, rows: Math.ceil(count / columns) };
}

/**
 * Exactly `count` deterministic reserve slot positions, ordered row-major from
 * the far/left corner. Clamped into the show volume so a badly configured zone
 * degrades to a valid position instead of an impossible one.
 */
export function reserveSlotPositions(
  count: number,
  zone: ReserveZoneConfig,
  options: { area?: ShowArea; limits?: SafetyLimits } = {},
): Vector3Tuple[] {
  if (count <= 0) return [];
  const { columns, rows } = reserveGridShape(count);
  const spacing = Math.max(0.5, zone.spacing);
  const yaw = (zone.orientationDeg * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const halfW = ((columns - 1) * spacing) / 2;
  const halfD = ((rows - 1) * spacing) / 2;
  const area = options.area;
  const limits = options.limits;
  const out: Vector3Tuple[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    const lx = col * spacing - halfW;
    const lz = row * spacing - halfD;
    let x = zone.center[0] + lx * cos - lz * sin;
    let z = zone.center[2] + lx * sin + lz * cos;
    let y = zone.center[1];
    if (area) {
      const hx = area.width / 2;
      const hz = area.depth / 2;
      x = Math.max(-hx, Math.min(hx, x));
      z = Math.max(-hz, Math.min(hz, z));
    }
    if (limits) y = Math.max(limits.minAltitude, Math.min(limits.maxAltitude, y));
    out.push([x, y, z]);
  }
  return out;
}

/**
 * Proposes a zone BELOW the artistic footprint (or above it when there is no
 * headroom below), keeping the reserve swarm out of the visible image while
 * remaining inside the show volume.
 */
export function autoReserveZone(
  input: {
    readonly area: ShowArea;
    readonly limits: SafetyLimits;
    readonly droneCount: number;
    readonly footprintPoints?: readonly Vector3Tuple[];
    readonly footprint?: Footprint;
  },
): ReserveZoneConfig {
  const { area, limits } = input;
  const footprint = input.footprint ?? footprintOf(input.footprintPoints ?? []);
  const spacing = Math.max(limits.minSeparation * 2, 3);
  const clearance = Math.max(limits.minSeparation * 3, 8);
  const floor = limits.minAltitude + spacing;
  const ceiling = Math.max(floor, limits.maxAltitude - spacing);

  let y: number;
  if (footprint.radius > 0) {
    const below = footprint.min[1] - clearance;
    y = below >= floor ? below : Math.min(ceiling, footprint.max[1] + clearance);
  } else {
    y = Math.min(ceiling, floor + 10);
  }
  y = Math.max(floor, Math.min(ceiling, y));

  // Keep the holding lattice behind the artistic centre (away from the
  // audience, which faces -Z) and inside the area footprint.
  const { columns, rows } = reserveGridShape(Math.max(1, input.droneCount));
  const halfDepth = ((rows - 1) * spacing) / 2;
  const halfWidth = ((columns - 1) * spacing) / 2;
  const maxZ = area.depth / 2 - halfDepth;
  const z = Math.max(-(area.depth / 2 - halfDepth), Math.min(maxZ, footprint.centroid[2] - clearance));
  const hx = Math.max(0, area.width / 2 - halfWidth);
  const x = Math.max(-hx, Math.min(hx, footprint.centroid[0]));

  return { center: [x, y, z], orientationDeg: 0, spacing, layout: "GRID" };
}
