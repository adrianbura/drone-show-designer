/**
 * Stable drone identity.
 *
 * Array order is an implementation detail; `DroneDefinition.id` is the
 * conceptual identity and never changes when formations, assignment order or
 * timeline content change. Only the fleet size changes the set of IDs.
 */
import type { ShowProject, Vector3Tuple } from "./types";

export interface DroneDefinition {
  readonly id: string;
  readonly index: number;
  readonly homePosition: Vector3Tuple;
  readonly metadata?: Readonly<Record<string, string | number>>;
}

export function droneIdForIndex(index: number): string {
  return `DRN-${String(index + 1).padStart(3, "0")}`;
}

export function droneIndexFromId(id: string): number {
  const n = Number.parseInt(id.replace(/^\D+/, ""), 10);
  return Number.isFinite(n) ? n - 1 : -1;
}

/**
 * Home (take-off / landing) pad positions.
 *
 * Without a launch plan these are the XZ footprint of the first formation
 * projected onto the ground plane. When a pre-show launch grid exists, the
 * caller passes the LAUNCH PAD positions in `homeOverride` so that pads are the
 * conceptual physical home of every drone. Deterministic either way.
 */
export function buildDroneDefinitions(
  project: ShowProject,
  homeOverride?: readonly Vector3Tuple[],
): DroneDefinition[] {
  const pad = project.formations[0]?.points ?? [];
  return Array.from({ length: project.droneCount }, (_, i) => {
    const override = homeOverride?.[i];
    if (override) {
      return { id: droneIdForIndex(i), index: i, homePosition: override };
    }
    const p = pad[i % Math.max(1, pad.length)] ?? [0, 0, 0];
    return {
      id: droneIdForIndex(i),
      index: i,
      homePosition: [p[0] ?? 0, 0, p[2] ?? 0] as Vector3Tuple,
    };
  });
}
