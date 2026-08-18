/**
 * DRONE ART COMPILER — deterministic VisualFormationDesign -> EXACTLY N points.
 *
 * HARD INVARIANT: for a compilable design, `points.length === targetPointCount`,
 * always. The compiler is pure library code: no React, no AI, no network, no
 * un-seeded randomness. Identical (design, count, options, compilerVersion)
 * always produce byte-identical geometry, and the design is never mutated.
 *
 * The produced report contains VISUAL-DESIGN diagnostics only — it never claims
 * flight safety. Assignment, trajectory planning, conflict detection and safety
 * validation stay authoritative downstream, after the asset is placed in a show.
 */
import type { Formation, RGB, Vec3 } from "../show/types";
import { allocateBudget, minPointsFor } from "./allocate";
import {
  sampleCurve,
  sampleParametricCurve,
  sampleParametricSurface,
  samplePointFeature,
  sampleRegion,
} from "./sample";
import {
  DRONE_ART_COMPILER_VERSION,
  VisualDesignError,
  type CompileVisualOptions,
  type CompiledPointSource,
  type CompiledVisualFormation,
  type DesignPoint,
  type ResolvedCompileOptions,
  type VisualCompileIssue,
  type VisualFormationDesign,
  type VisualFormationProvenance,
  type VisualPrimitive,
} from "./types";

const DEFAULT_COLOR: RGB = [255, 255, 255];

export function resolveCompileOptions(
  design: VisualFormationDesign,
  options: CompileVisualOptions = {},
): ResolvedCompileOptions {
  return {
    style: options.style ?? design.defaultStyle ?? "STRUCTURAL",
    width: options.width ?? 120,
    altitude: options.altitude ?? 60,
    depthScale: options.depthScale ?? 1,
    rotationDeg: options.rotationDeg ?? 0,
    seed: options.seed ?? 1,
    fillBias: options.fillBias ?? design.fillBias ?? "BALANCED",
  };
}

interface LocalPoint {
  readonly xy: DesignPoint;
  readonly z: number;
  readonly source: CompiledPointSource;
  readonly color: RGB;
}

function primitiveColor(
  primitive: VisualPrimitive,
  design: VisualFormationDesign,
): RGB {
  if (primitive.color) return primitive.color;
  const part = design.semanticParts.find((p) => p.id === primitive.part);
  return part?.color ?? DEFAULT_COLOR;
}

function primitiveDepth(primitive: VisualPrimitive, design: VisualFormationDesign): number {
  if (primitive.depth != null) return primitive.depth;
  const part = design.semanticParts.find((p) => p.id === primitive.part);
  return part?.depth ?? 0;
}

/** Samples one primitive in design space. Always returns exactly `count`. */
function samplePrimitive(
  primitive: VisualPrimitive,
  count: number,
  seed: number,
): { xy: DesignPoint; z: number }[] {
  if (count <= 0) return [];
  switch (primitive.type) {
    case "POLYLINE":
      return sampleCurve(primitive.path, count, false).map((xy) => ({ xy, z: 0 }));
    case "CLOSED_CONTOUR":
      return sampleCurve(primitive.path, count, true).map((xy) => ({ xy, z: 0 }));
    case "REGION":
      return sampleRegion(primitive.outline, primitive.holes ?? [], count, seed).map((xy) => ({
        xy,
        z: 0,
      }));
    case "POINT_FEATURE":
      return samplePointFeature(primitive.position, count, primitive.spread ?? 0.012).map((xy) => ({
        xy,
        z: 0,
      }));
    case "PARAMETRIC_CURVE":
      return sampleParametricCurve(
        primitive.curve,
        primitive.params,
        primitive.center ?? [0, 0],
        count,
      );
    case "PARAMETRIC_SURFACE":
      return sampleParametricSurface(
        primitive.surface,
        primitive.params,
        primitive.center ?? [0, 0],
        count,
      );
    default:
      throw new VisualDesignError("UNSUPPORTED_PRIMITIVE", "Unsupported visual primitive.", {
        primitive,
      });
  }
}

/** Minimum pairwise distance in metres. Bounded cost for typical asset sizes. */
function minSpacingOf(points: readonly Vec3[]): number {
  if (points.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    for (let j = i + 1; j < points.length; j++) {
      const b = points[j]!;
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const dz = a[2] - b[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

/**
 * Compiles a visual design into exactly `targetPointCount` show-local points.
 *
 * `targetPointCount` is the FORMATION drone count — deliberately independent of
 * the project fleet size. A 150-point pigeon stays a 150-point asset in a
 * 500-drone project; fleet participation assigns the remaining drones later.
 */
export function compileVisualFormation(
  design: VisualFormationDesign,
  targetPointCount: number,
  options: CompileVisualOptions = {},
): CompiledVisualFormation {
  if (!Number.isFinite(targetPointCount) || targetPointCount < 1) {
    throw new VisualDesignError("INVALID_COUNT", "Target point count must be >= 1.", {
      targetPointCount,
    });
  }
  const target = Math.floor(targetPointCount);
  const enabled = design.primitives.filter((p) => p.enabled !== false);
  if (enabled.length === 0) {
    throw new VisualDesignError("EMPTY_DESIGN", "The design has no enabled primitives.", {
      designId: design.id,
    });
  }
  const opts = resolveCompileOptions(design, options);
  const allocation = allocateBudget(design, target, opts.style, opts.fillBias);

  const byId = new Map(design.primitives.map((p) => [p.id, p]));
  const local: LocalPoint[] = [];
  for (const entry of allocation.allocations) {
    if (entry.points <= 0) continue;
    const primitive = byId.get(entry.primitiveId);
    if (!primitive) continue;
    const color = primitiveColor(primitive, design);
    const depth = primitiveDepth(primitive, design);
    const samples = samplePrimitive(primitive, entry.points, opts.seed + hashId(primitive.id));
    for (const s of samples) {
      local.push({
        xy: s.xy,
        z: s.z + depth,
        color,
        source: {
          primitiveId: primitive.id,
          primitiveType: primitive.type,
          part: primitive.part,
        },
      });
    }
  }

  // Exactness guard: sampling can only ever be short for degenerate geometry.
  while (local.length > target) local.pop();
  while (local.length < target && local.length > 0) {
    local.push(local[local.length % local.length === 0 ? 0 : local.length - 1]!);
  }

  const designWidth = design.bounds.width || 1;
  const scale = opts.width / designWidth;
  const yaw = (opts.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  const points: Vec3[] = [];
  const colors: RGB[] = [];
  const sources: CompiledPointSource[] = [];
  const partIndices: Record<string, number[]> = {};

  local.forEach((p, index) => {
    const x = p.xy[0] * scale;
    const y = p.xy[1] * scale;
    const z = p.z * scale * opts.depthScale;
    points.push([x * cos + z * sin, opts.altitude + y, -x * sin + z * cos]);
    colors.push(p.color);
    sources.push(p.source);
    const part = p.source.part;
    if (part) {
      (partIndices[part] ??= []).push(index);
    }
  });

  const allocationByPart: Record<string, number> = {};
  for (const s of sources) {
    const key = s.part ?? "UNASSIGNED";
    allocationByPart[key] = (allocationByPart[key] ?? 0) + 1;
  }

  const highPriority = enabled.filter((p) => p.priority >= 0.8);
  const preservedHigh = highPriority.filter((p) => !allocation.dropped.includes(p.id)).length;
  const spacingTarget = (design.spacingTarget ?? 0.05) * scale;
  const minSpacing = minSpacingOf(points);

  const issues: VisualCompileIssue[] = [];
  if (allocation.dropped.length > 0) {
    issues.push({
      code: "DETAILS_OMITTED",
      severity: "warning",
      detail: { count: allocation.dropped.length, requested: target },
    });
  }
  for (const id of allocation.underResolved) {
    const primitive = byId.get(id);
    issues.push({
      code: "UNDER_RESOLVED",
      severity: "info",
      detail: { primitiveId: id, part: primitive?.part ?? "", points: minPointsFor(primitive!) },
    });
  }
  if (Number.isFinite(minSpacing) && minSpacing < spacingTarget) {
    issues.push({
      code: "SPACING_TIGHT",
      severity: "warning",
      detail: {
        minSpacing: Number(minSpacing.toFixed(2)),
        spacingTarget: Number(spacingTarget.toFixed(2)),
      },
    });
  }
  if (allocation.symmetryAdjusted > 0) {
    issues.push({
      code: "SYMMETRY_ADJUSTED",
      severity: "info",
      detail: { pairs: allocation.symmetryAdjusted },
    });
  }

  return {
    designId: design.id,
    designVersion: design.version,
    points,
    colors,
    sources,
    partIndices,
    options: opts,
    report: {
      requestedPoints: target,
      producedPoints: points.length,
      primitivesUsed: enabled.length - allocation.dropped.length,
      primitivesTotal: design.primitives.length,
      highPriorityPreserved: highPriority.length === 0 ? 1 : preservedHigh / highPriority.length,
      droppedPrimitiveIds: allocation.dropped,
      allocationByPart,
      allocations: allocation.allocations,
      minSpacing: Number.isFinite(minSpacing) ? Number(minSpacing.toFixed(3)) : 0,
      spacingTarget: Number(spacingTarget.toFixed(3)),
      issues,
      compilerVersion: DRONE_ART_COMPILER_VERSION,
      style: opts.style,
    },
  };
}

/** Stable small integer from a primitive id — keeps region seeds distinct. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 10000;
}

export function visualProvenance(compiled: CompiledVisualFormation): VisualFormationProvenance {
  return {
    source: "VISUAL_DESIGN",
    designId: compiled.designId,
    designVersion: compiled.designVersion,
    compilerVersion: compiled.report.compilerVersion,
    targetPointCount: compiled.report.requestedPoints,
    style: compiled.report.style,
    seed: compiled.options.seed,
  };
}

/**
 * Wraps a compiled artwork as a native `Formation`. Provenance lives in
 * `params` (the existing reproducibility channel), so a saved asset can be
 * recompiled at a different drone count without redrawing the design.
 */
export function formationFromCompiled(
  compiled: CompiledVisualFormation,
  input: { readonly id: string; readonly name: string },
): Formation {
  const p = visualProvenance(compiled);
  return {
    id: input.id,
    name: input.name,
    kind: "custom",
    points: compiled.points.map((pt) => [pt[0], pt[1], pt[2]] as Vec3),
    params: {
      visualSource: p.source,
      visualDesignId: p.designId,
      visualDesignVersion: p.designVersion,
      visualCompilerVersion: p.compilerVersion,
      visualTargetPointCount: p.targetPointCount,
      visualStyle: p.style,
      seed: p.seed,
      width: compiled.options.width,
      altitude: compiled.options.altitude,
    },
  };
}

/** Reads back provenance from a formation, when it was visually compiled. */
export function readVisualProvenance(formation: Formation): VisualFormationProvenance | null {
  if (formation.params["visualSource"] !== "VISUAL_DESIGN") return null;
  return {
    source: "VISUAL_DESIGN",
    designId: String(formation.params["visualDesignId"] ?? ""),
    designVersion: Number(formation.params["visualDesignVersion"] ?? 1),
    compilerVersion: String(formation.params["visualCompilerVersion"] ?? ""),
    targetPointCount: Number(formation.params["visualTargetPointCount"] ?? formation.points.length),
    style: (formation.params["visualStyle"] as VisualFormationProvenance["style"]) ?? "STRUCTURAL",
    seed: Number(formation.params["seed"] ?? 1),
  };
}
