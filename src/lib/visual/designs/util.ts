/**
 * Built-in design authoring helpers. Pure geometry in design space
 * (X right, Y up, normalised units), so every built-in design is reproducible
 * and mirror-symmetric by construction.
 */
import type { DesignPoint, VisualPrimitive } from "../types";

export function ellipsePath(
  center: DesignPoint,
  rx: number,
  ry: number,
  segments = 24,
): DesignPoint[] {
  const out: DesignPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push([center[0] + Math.cos(a) * rx, center[1] + Math.sin(a) * ry]);
  }
  return out;
}

export function circlePath(center: DesignPoint, r: number, segments = 24): DesignPoint[] {
  return ellipsePath(center, r, r, segments);
}

/** Mirrors a path across the design Y axis, preserving winding order. */
export function mirrorPath(path: readonly DesignPoint[]): DesignPoint[] {
  return [...path].reverse().map((p) => [-p[0], p[1]] as DesignPoint);
}

/**
 * Produces a left/right pair from a left-hand primitive. Both primitives point
 * at each other through `mirrorOf`, which is what keeps allocation balanced.
 */
export function mirrorPair(
  left: VisualPrimitive,
  rightId: string,
  rightPart?: string,
): VisualPrimitive[] {
  const right = mirrorPrimitive(left, rightId, rightPart);
  const leftWithPeer = { ...left, mirrorOf: rightId } as VisualPrimitive;
  return [leftWithPeer, { ...right, mirrorOf: left.id } as VisualPrimitive];
}

function mirrorPrimitive(
  primitive: VisualPrimitive,
  id: string,
  part?: string,
): VisualPrimitive {
  const base = { ...primitive, id, ...(part ? { part } : {}) };
  switch (primitive.type) {
    case "POLYLINE":
      return { ...base, type: "POLYLINE", path: mirrorPath(primitive.path) };
    case "CLOSED_CONTOUR":
      return { ...base, type: "CLOSED_CONTOUR", path: mirrorPath(primitive.path) };
    case "REGION":
      return {
        ...base,
        type: "REGION",
        outline: mirrorPath(primitive.outline),
        ...(primitive.holes ? { holes: primitive.holes.map((h) => mirrorPath(h)) } : {}),
      };
    case "POINT_FEATURE":
      return {
        ...base,
        type: "POINT_FEATURE",
        position: [-primitive.position[0], primitive.position[1]],
      };
    case "PARAMETRIC_CURVE":
      return {
        ...base,
        type: "PARAMETRIC_CURVE",
        curve: primitive.curve,
        params: primitive.params,
        ...(primitive.center ? { center: [-primitive.center[0], primitive.center[1]] } : {}),
      };
    case "PARAMETRIC_SURFACE":
      return {
        ...base,
        type: "PARAMETRIC_SURFACE",
        surface: primitive.surface,
        params: primitive.params,
        ...(primitive.center ? { center: [-primitive.center[0], primitive.center[1]] } : {}),
      };
  }
}
