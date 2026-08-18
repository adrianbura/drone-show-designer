/**
 * VISUAL DESIGN -> DYNAMIC FORMATION bridge.
 *
 * Semantic parts of a compiled artwork become motion groups of the EXISTING
 * Sprint 6B dynamic formation engine — there is no second animation engine here.
 * Static creation stays the default: a dynamic version is only produced when the
 * user explicitly asks for it.
 */
import {
  addMotionGroup,
  dynamicFromFormation,
  neutralGroupKeyframe,
  patchMotionGroup,
  pointId,
} from "../show/dynamic/create";
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
  const wanted = options.parts ?? animatableParts(design, compiled).map((p) => p.id);
  const partsById = new Map(design.semanticParts.map((p) => [p.id, p]));
  const spins = wanted.some((id) => partsById.get(id)?.motion === "SPIN_Z");
  const duration = options.duration ?? 4;
  const base = dynamicFromFormation(formation, {
    id: options.id,
    name: options.name ?? `${formation.name} (dynamic)`,
    duration,
    // A spinning part must loop continuously; ping-pong would un-spin it.
    loop: spins ? "REPEAT" : "PING_PONG",
  });
  let next = base;
  for (const partId of wanted) {
    const indices = compiled.partIndices[partId] ?? [];
    if (indices.length === 0) continue;
    const groupId = `mg-${partId.toLowerCase()}`;
    next = addMotionGroup(
      next,
      partId,
      indices.map((i) => pointId(i)),
      groupId,
    );
    // Declared part motion is written as ordinary keyframe data — fully editable.
    if (partsById.get(partId)?.motion === "SPIN_Z") {
      next = patchMotionGroup(next, groupId, {
        loop: "REPEAT",
        loopDuration: duration,
        keyframes: [
          { ...neutralGroupKeyframe(0), rotation: [0, 0, 0], interpolation: "linear" },
          { ...neutralGroupKeyframe(duration / 2), rotation: [0, 0, -180], interpolation: "linear" },
          { ...neutralGroupKeyframe(duration), rotation: [0, 0, -360], interpolation: "linear" },
        ],
      });
    }
  }
  return next;
}
