/**
 * STRUCTURE EDITOR — importance mapping.
 *
 * The editor exposes four human levels but stores them in the EXISTING compiler
 * fields (`priority`, `essential`). There is deliberately no second priority
 * system: `allocateBudget` already degrades by `essential` then `priority`, and
 * `primitiveWeight` raises priority to the power 1.6.
 */
import type { VisualPrimitive } from "../types";

export type StructureImportance = "LOW" | "MEDIUM" | "HIGH" | "ESSENTIAL";

export const STRUCTURE_IMPORTANCE_LEVELS: readonly StructureImportance[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "ESSENTIAL",
];

interface ImportanceValue {
  readonly priority: number;
  readonly essential: boolean;
}

const VALUES: Readonly<Record<StructureImportance, ImportanceValue>> = {
  LOW: { priority: 0.35, essential: false },
  MEDIUM: { priority: 0.6, essential: false },
  HIGH: { priority: 0.85, essential: false },
  ESSENTIAL: { priority: 1, essential: true },
};

export function importanceValue(level: StructureImportance): ImportanceValue {
  return VALUES[level];
}

/** Reads the level back: essential wins, otherwise the nearest priority band. */
export function importanceOf(primitive: VisualPrimitive): StructureImportance {
  if (primitive.essential) return "ESSENTIAL";
  const p = Number.isFinite(primitive.priority) ? primitive.priority : 0.6;
  let best: StructureImportance = "MEDIUM";
  let bestDelta = Infinity;
  for (const level of ["LOW", "MEDIUM", "HIGH"] as const) {
    const delta = Math.abs(VALUES[level].priority - p);
    if (delta < bestDelta) {
      best = level;
      bestDelta = delta;
    }
  }
  // A non-essential primitive at full priority is still visually "high".
  if (p >= 0.95) return "HIGH";
  return best;
}
