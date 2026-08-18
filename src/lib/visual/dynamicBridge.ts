/**
 * VISUAL DESIGN -> DYNAMIC FORMATION bridge.
 *
 * Semantic parts of a compiled artwork become motion groups of the EXISTING
 * Sprint 6B dynamic formation engine — there is no second animation engine here.
 * Static creation stays the default: a dynamic version is only produced when the
 * user explicitly asks for it.
 */
import { addMotionGroup, dynamicFromFormation, pointId } from "../show/dynamic/create";
import type { DynamicFormation } from "../show/dynamic/types";
import type { Formation } from "../show/types";
import type { CompiledVisualFormation, SemanticPart, VisualFormationDesign } from "./types";

/** Parts that make sensible motion groups for a design (wings, tail, head…). */
export function animatableParts(
  design: VisualFormationDesign,
  compiled: CompiledVisualFormation,
): SemanticPart[] {
  return design.semanticParts.filter(
    (part) => part.animatable === true && (compiled.partIndices[part.id]?.length ?? 0) > 0,
  );
}

export interface DynamicBridgeOptions {
  readonly id: string;
  readonly name?: string;
  readonly duration?: number;
  readonly parts?: readonly string[];
}

/**
 * Builds a dynamic formation whose motion groups mirror the design's semantic
 * parts. Group keyframes stay neutral: the user animates them with the existing
 * dynamic panel / presets.
 */
export function dynamicFromCompiled(
  formation: Formation,
  design: VisualFormationDesign,
  compiled: CompiledVisualFormation,
  options: DynamicBridgeOptions,
): DynamicFormation {
  const base = dynamicFromFormation(formation, {
    id: options.id,
    name: options.name ?? `${formation.name} (dynamic)`,
    duration: options.duration ?? 4,
    loop: "PING_PONG",
  });
  const wanted = options.parts ?? animatableParts(design, compiled).map((p) => p.id);
  let next = base;
  for (const partId of wanted) {
    const indices = compiled.partIndices[partId] ?? [];
    if (indices.length === 0) continue;
    next = addMotionGroup(
      next,
      partId,
      indices.map((i) => pointId(i)),
      `mg-${partId.toLowerCase()}`,
    );
  }
  return next;
}
