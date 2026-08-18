/**
 * STRUCTURE EDITOR — pure commands on a VisualFormationDesign.
 *
 * Every operation is a deterministic, immutable design -> design function. This
 * is also the exact surface a future AI agent can drive ("remove the background
 * contour", "mark both wings essential", "add the missing tail line") without
 * touching React state. Unknown ids are no-ops that return the SAME reference.
 *
 * These commands never touch drone positions, trajectories, participation,
 * lighting, export or the timeline: they edit design STRUCTURE only.
 */
import type { DesignPoint, PolylinePrimitive, VisualFormationDesign, VisualPrimitive } from "../types";
import { importanceValue, type StructureImportance } from "./importance";

const EDIT_NOTE = "Manually edited structure.";

function withPrimitives(
  design: VisualFormationDesign,
  primitives: readonly VisualPrimitive[],
): VisualFormationDesign {
  const notes = design.metadata.notes ?? "";
  return {
    ...design,
    version: design.version + 1,
    primitives,
    metadata: {
      ...design.metadata,
      notes: notes.includes(EDIT_NOTE) ? notes : `${notes} ${EDIT_NOTE}`.trim(),
    },
  };
}

function mapPrimitive(
  design: VisualFormationDesign,
  id: string,
  update: (primitive: VisualPrimitive) => VisualPrimitive,
): VisualFormationDesign {
  const index = design.primitives.findIndex((p) => p.id === id);
  if (index < 0) return design;
  const next = design.primitives.slice();
  next[index] = update(design.primitives[index]!);
  return withPrimitives(design, next);
}

export function setPrimitiveEnabled(
  design: VisualFormationDesign,
  id: string,
  enabled: boolean,
): VisualFormationDesign {
  return mapPrimitive(design, id, (p) => ({ ...p, enabled }));
}

export function setPrimitiveImportance(
  design: VisualFormationDesign,
  id: string,
  level: StructureImportance,
): VisualFormationDesign {
  const { priority, essential } = importanceValue(level);
  return mapPrimitive(design, id, (p) => ({ ...p, priority, essential }));
}

/** Destructive removal. Mirror references to the deleted id are cleared. */
export function deletePrimitive(design: VisualFormationDesign, id: string): VisualFormationDesign {
  if (!design.primitives.some((p) => p.id === id)) return design;
  if (design.primitives.length <= 1) return design;
  const next = design.primitives
    .filter((p) => p.id !== id)
    .map((p) => (p.mirrorOf === id ? { ...p, mirrorOf: undefined } : p));
  return withPrimitives(design, next);
}

export function nextPolylineId(design: VisualFormationDesign): string {
  const used = new Set(design.primitives.map((p) => p.id));
  let n = 1;
  while (used.has(`edit-poly-${n}`)) n += 1;
  return `edit-poly-${n}`;
}

/** True when the path is usable: >= 2 points and not fully degenerate. */
export function isDrawablePath(path: readonly DesignPoint[]): boolean {
  if (path.length < 2) return false;
  const first = path[0]!;
  return path.some((p) => Math.hypot(p[0] - first[0], p[1] - first[1]) > 1e-6);
}

export function addPolyline(
  design: VisualFormationDesign,
  path: readonly DesignPoint[],
  level: StructureImportance = "MEDIUM",
): VisualFormationDesign {
  if (!isDrawablePath(path)) return design;
  const { priority, essential } = importanceValue(level);
  const primitive: PolylinePrimitive = {
    type: "POLYLINE",
    id: nextPolylineId(design),
    priority,
    essential,
    minPoints: 3,
    path: path.map((p) => [p[0], p[1]] as DesignPoint),
  };
  return withPrimitives(design, [...design.primitives, primitive]);
}

/** Count of primitives the compiler will actually use. */
export function enabledPrimitiveCount(design: VisualFormationDesign): number {
  return design.primitives.filter((p) => p.enabled !== false).length;
}
