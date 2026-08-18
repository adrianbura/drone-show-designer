/**
 * VisualFormationDesign (de)serialisation.
 *
 * Designs are plain JSON so a future `Image -> VisualFormationDesign` module
 * (Sprint 8B) or a real AI provider can produce one and have it validated before
 * it becomes project content. Image bytes are NEVER part of a design.
 */
import {
  VISUAL_DESIGN_SCHEMA_VERSION,
  VisualDesignError,
  type VisualFormationDesign,
  type VisualPrimitive,
} from "./types";

export function serializeDesign(design: VisualFormationDesign): string {
  return JSON.stringify(design, null, 2);
}

function isPointList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (p) =>
        Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && isFinite(n)),
    )
  );
}

/** Structural validation of a single primitive. Returns issue codes. */
export function validatePrimitive(primitive: VisualPrimitive): string[] {
  const issues: string[] = [];
  if (!primitive.id) issues.push("PRIMITIVE_ID");
  if (!Number.isFinite(primitive.priority) || primitive.priority < 0 || primitive.priority > 1) {
    issues.push("PRIMITIVE_PRIORITY");
  }
  switch (primitive.type) {
    case "POLYLINE":
    case "CLOSED_CONTOUR":
      if (!isPointList(primitive.path) || primitive.path.length < 2) issues.push("PRIMITIVE_PATH");
      break;
    case "REGION":
      if (!isPointList(primitive.outline) || primitive.outline.length < 3) {
        issues.push("PRIMITIVE_OUTLINE");
      }
      break;
    case "POINT_FEATURE":
      if (!isPointList([primitive.position])) issues.push("PRIMITIVE_POSITION");
      break;
    default:
      break;
  }
  return issues;
}

export function validateDesign(design: VisualFormationDesign): string[] {
  const issues: string[] = [];
  if (!design || typeof design !== "object") return ["DESIGN_MALFORMED"];
  if (!Array.isArray(design.primitives)) issues.push("DESIGN_PRIMITIVES");
  if (!Array.isArray(design.semanticParts)) issues.push("DESIGN_PARTS");
  if (!design.bounds || typeof design.bounds !== "object") issues.push("DESIGN_BOUNDS");
  if (issues.length > 0) return issues;
  if (design.schemaVersion !== VISUAL_DESIGN_SCHEMA_VERSION) issues.push("SCHEMA_VERSION");
  if (!design.id) issues.push("DESIGN_ID");
  if (!design.name) issues.push("DESIGN_NAME");
  if (design.primitives.length === 0) issues.push("DESIGN_EMPTY");
  if (!(design.bounds.width > 0)) issues.push("DESIGN_BOUNDS");
  const ids = new Set<string>();
  for (const p of design.primitives) {
    if (ids.has(p.id)) issues.push("DUPLICATE_PRIMITIVE_ID");
    ids.add(p.id);
    issues.push(...validatePrimitive(p));
  }
  for (const p of design.primitives) {
    if (p.mirrorOf && !ids.has(p.mirrorOf)) issues.push("MIRROR_TARGET_MISSING");
    if (p.part && !design.semanticParts.some((s) => s.id === p.part)) issues.push("PART_MISSING");
  }
  return [...new Set(issues)];
}

/** Parses and validates an untrusted design document. */
export function parseDesign(text: string): VisualFormationDesign {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new VisualDesignError("EMPTY_DESIGN", "The design document is not valid JSON.");
  }
  const design = raw as VisualFormationDesign;
  const issues = validateDesign(design);
  if (issues.length > 0) {
    throw new VisualDesignError("EMPTY_DESIGN", "The design document failed validation.", {
      issues,
    });
  }
  return design;
}
