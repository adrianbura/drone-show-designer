/**
 * DRONE ART COMPILER — point budget allocation.
 *
 * The budget is NEVER spread uniformly: it follows visual priority, primitive
 * measure (length / area), semantic importance, the requested visual style and
 * per-primitive minimum representation. Allocation is exact-sum (largest
 * remainder) and fully deterministic, and degradation at low counts drops the
 * lowest-priority details first.
 */
import { polygonArea, polylineLength } from "./sample";
import type {
  FillBias,
  PrimitiveAllocation,
  SemanticPart,
  VisualFormationDesign,
  VisualPrimitive,
  VisualStyle,
} from "./types";

/** Per-style weight multipliers by primitive type. */
const STYLE_WEIGHTS: Record<VisualStyle, Record<string, number>> = {
  OUTLINE: { CLOSED_CONTOUR: 1, POLYLINE: 0.3, REGION: 0.05, POINT_FEATURE: 1, PARAMETRIC_CURVE: 1, PARAMETRIC_SURFACE: 0.1 },
  STRUCTURAL: { CLOSED_CONTOUR: 1, POLYLINE: 1, REGION: 0.25, POINT_FEATURE: 1.4, PARAMETRIC_CURVE: 1, PARAMETRIC_SURFACE: 0.3 },
  BALANCED: { CLOSED_CONTOUR: 1, POLYLINE: 0.8, REGION: 0.85, POINT_FEATURE: 1.1, PARAMETRIC_CURVE: 1, PARAMETRIC_SURFACE: 0.9 },
  FILLED: { CLOSED_CONTOUR: 0.7, POLYLINE: 0.5, REGION: 2.2, POINT_FEATURE: 0.9, PARAMETRIC_CURVE: 0.7, PARAMETRIC_SURFACE: 2.2 },
};

const FILL_BIAS: Record<FillBias, { contour: number; fill: number }> = {
  CONTOUR_HEAVY: { contour: 1.3, fill: 0.6 },
  BALANCED: { contour: 1, fill: 1 },
  FILL_HEAVY: { contour: 0.8, fill: 1.5 },
};

const DEFAULT_MIN_POINTS: Record<string, number> = {
  CLOSED_CONTOUR: 6,
  POLYLINE: 3,
  REGION: 4,
  POINT_FEATURE: 1,
  PARAMETRIC_CURVE: 6,
  PARAMETRIC_SURFACE: 6,
};

export function primitiveMeasure(p: VisualPrimitive): number {
  switch (p.type) {
    case "POLYLINE":
      return polylineLength(p.path, false);
    case "CLOSED_CONTOUR":
      return polylineLength(p.path, true);
    case "REGION":
      return Math.sqrt(Math.max(polygonArea(p.outline), 1e-9)) * 2.2;
    case "POINT_FEATURE":
      return 0.04;
    case "PARAMETRIC_CURVE": {
      const rx = p.params["rx"] ?? p.params["r"] ?? 0.5;
      return 2 * Math.PI * rx * (p.params["turns"] ?? 1);
    }
    case "PARAMETRIC_SURFACE": {
      const rx = p.params["rx"] ?? p.params["r"] ?? 0.5;
      return 4 * Math.PI * rx * rx;
    }
  }
}

export function minPointsFor(p: VisualPrimitive): number {
  return Math.max(1, p.minPoints ?? DEFAULT_MIN_POINTS[p.type] ?? 3);
}

function partPriority(parts: readonly SemanticPart[], id: string | undefined): number {
  if (!id) return 1;
  const part = parts.find((p) => p.id === id);
  return part ? Math.min(1, Math.max(0.05, part.priority)) : 1;
}

export function primitiveWeight(
  p: VisualPrimitive,
  design: VisualFormationDesign,
  style: VisualStyle,
  fillBias: FillBias,
): number {
  const styleWeight = STYLE_WEIGHTS[style][p.type] ?? 1;
  const bias = FILL_BIAS[fillBias];
  const biasWeight =
    p.type === "REGION" || p.type === "PARAMETRIC_SURFACE" ? bias.fill : bias.contour;
  const priority = Math.min(1, Math.max(0.02, p.priority));
  const semantic = partPriority(design.semanticParts, p.part);
  // Priority is superlinear so essential structure wins at low counts.
  return primitiveMeasure(p) * styleWeight * biasWeight * Math.pow(priority, 1.6) * semantic;
}

/** Exact-sum split of `total` by weights (largest remainder, id-stable ties). */
export function allocateExact(
  total: number,
  entries: readonly { readonly id: string; readonly weight: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.id] = 0;
  if (total <= 0 || entries.length === 0) return out;
  const sum = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (sum <= 0) {
    // Weightless input: round-robin so the sum still matches exactly.
    for (let i = 0; i < total; i++) out[entries[i % entries.length]!.id]! += 1;
    return out;
  }
  const rows = entries.map((e) => {
    const exact = (total * Math.max(0, e.weight)) / sum;
    const floor = Math.floor(exact);
    return { id: e.id, floor, rest: exact - floor };
  });
  let assigned = rows.reduce((s, r) => s + r.floor, 0);
  const order = [...rows].sort((a, b) => b.rest - a.rest || a.id.localeCompare(b.id));
  let cursor = 0;
  while (assigned < total) {
    order[cursor % order.length]!.floor += 1;
    assigned += 1;
    cursor += 1;
  }
  for (let i = order.length - 1; assigned > total && i >= 0; i--) {
    const take = Math.min(order[i]!.floor, assigned - total);
    order[i]!.floor -= take;
    assigned -= take;
  }
  for (const r of rows) out[r.id] = r.floor;
  return out;
}

export interface AllocationResult {
  readonly allocations: readonly PrimitiveAllocation[];
  readonly dropped: readonly string[];
  /** Primitives kept at their bare minimum — candidates for a warning. */
  readonly underResolved: readonly string[];
  readonly symmetryAdjusted: number;
}

/**
 * Allocates `total` points across the design's enabled primitives.
 *
 * Graceful degradation: while the remaining budget cannot cover the minimum
 * representation of every kept primitive, the lowest-priority NON-essential
 * primitive is dropped (deterministic tie-break by id).
 */
export function allocateBudget(
  design: VisualFormationDesign,
  total: number,
  style: VisualStyle,
  fillBias: FillBias,
): AllocationResult {
  const enabled = design.primitives.filter((p) => p.enabled !== false);
  const dropped: string[] = [];
  const sortedByImportance = [...enabled].sort((a, b) => {
    const ea = a.essential ? 1 : 0;
    const eb = b.essential ? 1 : 0;
    if (ea !== eb) return ea - eb;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

  let kept = [...enabled];
  const minSum = (list: readonly VisualPrimitive[]) =>
    list.reduce((s, p) => s + minPointsFor(p), 0);

  let dropIndex = 0;
  while (kept.length > 1 && minSum(kept) > total && dropIndex < sortedByImportance.length) {
    const victim = sortedByImportance[dropIndex++]!;
    if (kept.length <= 1) break;
    // Keep essential primitives until nothing else is left to drop.
    if (victim.essential && kept.some((p) => !p.essential)) continue;
    kept = kept.filter((p) => p.id !== victim.id);
    dropped.push(victim.id);
  }
  // Extremely small budgets: keep only the single most important primitive.
  if (kept.length > 1 && minSum(kept) > total) {
    const best = [...kept].sort(
      (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
    )[0]!;
    for (const p of kept) if (p.id !== best.id) dropped.push(p.id);
    kept = [best];
  }

  const mins: Record<string, number> = {};
  for (const p of kept) mins[p.id] = Math.min(minPointsFor(p), total);
  const minTotal = Object.values(mins).reduce((s, v) => s + v, 0);
  const free = Math.max(0, total - minTotal);
  const weighted = allocateExact(
    free,
    kept.map((p) => ({ id: p.id, weight: primitiveWeight(p, design, style, fillBias) })),
  );

  const counts: Record<string, number> = {};
  for (const p of kept) counts[p.id] = (mins[p.id] ?? 0) + (weighted[p.id] ?? 0);

  // Cap greedy primitives, redistributing the surplus deterministically.
  let surplus = 0;
  for (const p of kept) {
    if (p.maxPoints != null && counts[p.id]! > p.maxPoints) {
      surplus += counts[p.id]! - p.maxPoints;
      counts[p.id] = p.maxPoints;
    }
  }
  if (surplus > 0) {
    const open = kept
      .filter((p) => p.maxPoints == null || counts[p.id]! < p.maxPoints)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    let i = 0;
    while (surplus > 0 && open.length > 0) {
      const p = open[i % open.length]!;
      counts[p.id]! += 1;
      surplus -= 1;
      i += 1;
    }
  }

  // Symmetry: mirrored structures receive balanced allocations. An odd leftover
  // goes to the highest-priority non-mirrored primitive (typically the body).
  let symmetryAdjusted = 0;
  if (design.symmetry !== "NONE") {
    const byId = new Map(kept.map((p) => [p.id, p]));
    const seen = new Set<string>();
    const central = [...kept]
      .filter((p) => !p.mirrorOf && !byId.get(p.id)?.mirrorOf)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
    for (const p of kept) {
      if (seen.has(p.id) || !p.mirrorOf) continue;
      const peer = byId.get(p.mirrorOf);
      if (!peer) continue;
      seen.add(p.id);
      seen.add(peer.id);
      const pair = counts[p.id]! + counts[peer.id]!;
      const half = Math.floor(pair / 2);
      const leftover = pair - half * 2;
      if (counts[p.id] !== half || counts[peer.id] !== half) symmetryAdjusted += 1;
      counts[p.id] = half;
      counts[peer.id] = half;
      if (leftover > 0) {
        if (central && central.id !== p.id && central.id !== peer.id) {
          counts[central.id]! += leftover;
        } else {
          counts[p.id]! += leftover;
        }
      }
    }
  }

  const underResolved = kept
    .filter((p) => counts[p.id]! <= minPointsFor(p) && p.priority >= 0.8)
    .map((p) => p.id);

  const allocations: PrimitiveAllocation[] = design.primitives.map((p) => ({
    primitiveId: p.id,
    part: p.part,
    priority: p.priority,
    points: counts[p.id] ?? 0,
    dropped: counts[p.id] == null,
  }));

  return { allocations, dropped, underResolved, symmetryAdjusted };
}
