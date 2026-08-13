/**
 * LAUNCH GRID ENGINE — physical ground positions.
 *
 * Produces EXACTLY one pad per DroneDefinition (never rows * columns) in the
 * existing show-local frame. Unused grid cells are allowed: a 5-column layout
 * for 23 drones yields 23 pads and a partially populated final row.
 */
import { droneIdForIndex } from "../drones";
import type { Vector3Tuple } from "../types";
import {
  LAUNCH_ALGORITHM_VERSION,
  PreShowError,
  type LaunchBounds,
  type LaunchGridConfig,
  type LaunchLayout,
  type LaunchPad,
} from "./types";

export const DEFAULT_LAUNCH_GRID: LaunchGridConfig = {
  kind: "grid",
  rows: 10,
  columns: 20,
  spacingX: 3,
  spacingZ: 3,
  originX: 0,
  originZ: 0,
  groundAltitude: 0,
  rotationDeg: 0,
};

export function launchPadId(index: number): string {
  return `PAD-${String(index + 1).padStart(3, "0")}`;
}

/** Yaw rotation about +Y in the XZ plane: +X rotates toward +Z. */
export function rotateXZ(x: number, z: number, degrees: number): [number, number] {
  if (degrees === 0) return [x, z];
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - z * s, x * s + z * c];
}

/**
 * Resolves the grid shape for a fleet size. `columns` is authoritative; rows
 * grow when the configured rows cannot hold the fleet, so the engine never
 * requires rows * columns === droneCount and never truncates the fleet.
 */
export function resolveGridShape(
  droneCount: number,
  config: LaunchGridConfig,
): { rows: number; columns: number } {
  const columns = Math.max(1, Math.floor(config.columns));
  const configuredRows = Math.max(1, Math.floor(config.rows));
  const neededRows = Math.max(1, Math.ceil(droneCount / columns));
  return { rows: Math.max(configuredRows, neededRows), columns };
}

export function buildLaunchLayout(droneCount: number, config: LaunchGridConfig): LaunchLayout {
  if (!Number.isFinite(droneCount) || droneCount <= 0) {
    throw new PreShowError("INVALID_LAUNCH_LAYOUT", "Launch layout needs at least one drone", {
      droneCount,
    });
  }
  if (!Number.isFinite(config.spacingX) || !Number.isFinite(config.spacingZ)) {
    throw new PreShowError("INVALID_LAUNCH_LAYOUT", "Pad spacing must be finite", {
      spacingX: config.spacingX,
      spacingZ: config.spacingZ,
    });
  }
  const { rows, columns } = resolveGridShape(droneCount, config);
  const y = config.groundAltitude;
  const pads: LaunchPad[] = [];
  const droneToPad: Record<string, string> = {};
  const padToDrone: Record<string, string> = {};

  for (let i = 0; i < droneCount; i++) {
    const row = Math.floor(i / columns);
    const column = i % columns;
    const localX = (column - (columns - 1) / 2) * config.spacingX;
    const localZ = (row - (rows - 1) / 2) * config.spacingZ;
    const [rx, rz] = rotateXZ(localX, localZ, config.rotationDeg);
    const pad: LaunchPad = {
      id: launchPadId(i),
      index: i,
      position: [rx + config.originX, y, rz + config.originZ] as Vector3Tuple,
      row,
      column,
    };
    pads.push(pad);
    const droneId = droneIdForIndex(i);
    droneToPad[droneId] = pad.id;
    padToDrone[pad.id] = droneId;
  }

  return {
    kind: "grid",
    rows,
    columns,
    pads,
    droneToPad,
    padToDrone,
    bounds: launchBounds(pads),
    center: [config.originX, y, config.originZ],
    minPadSpacing: minPadSpacing(pads),
    duplicatePads: duplicatePads(pads),
    config,
    algorithmVersion: LAUNCH_ALGORITHM_VERSION,
  };
}

export function launchBounds(pads: readonly LaunchPad[]): LaunchBounds {
  if (pads.length === 0) {
    return { width: 0, depth: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pads) {
    minX = Math.min(minX, p.position[0]);
    maxX = Math.max(maxX, p.position[0]);
    minZ = Math.min(minZ, p.position[2]);
    maxZ = Math.max(maxZ, p.position[2]);
  }
  return { width: maxX - minX, depth: maxZ - minZ, minX, maxX, minZ, maxZ };
}

/**
 * Smallest STATIC pad-to-pad distance. This is a site-layout metric and must not
 * be confused with dynamic in-flight separation (see conflicts.ts).
 */
export function minPadSpacing(pads: readonly LaunchPad[]): number {
  let min = Infinity;
  for (let i = 0; i < pads.length; i++) {
    for (let j = i + 1; j < pads.length; j++) {
      const a = pads[i]!.position;
      const b = pads[j]!.position;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < min) min = d;
    }
  }
  return pads.length < 2 ? Infinity : min;
}

/** Structurally invalid: two pads at (effectively) the same physical point. */
export function duplicatePads(
  pads: readonly LaunchPad[],
  tolerance = 0.05,
): (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [];
  const cell = Math.max(tolerance, 0.01);
  const buckets = new Map<string, LaunchPad[]>();
  const key = (p: LaunchPad) =>
    `${Math.round(p.position[0] / cell)}:${Math.round(p.position[2] / cell)}`;
  for (const p of pads) {
    const k = key(p);
    const list = buckets.get(k);
    if (list) list.push(p);
    else buckets.set(k, [p]);
  }
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const d = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
        if (d <= tolerance) out.push([a.id, b.id] as const);
      }
    }
  }
  return out;
}

export function padPositions(layout: LaunchLayout): Vector3Tuple[] {
  return layout.pads.map((p) => p.position);
}
