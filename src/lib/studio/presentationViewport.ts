import { audienceOrientation, type ShowSite } from "@/lib/show/geo";
import type { ShowArea } from "@/lib/show/types";

export interface PresentationCameraPlan {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly source: "AUDIENCE" | "ESTIMATED";
}

/**
 * Presentation-only camera placement. A configured audience position is used
 * verbatim in the show-local frame; otherwise the fallback is labelled as an
 * estimate and must never be described as the real audience view.
 */
export function buildPresentationCameraPlan(
  area: ShowArea,
  site: ShowSite | undefined,
): PresentationCameraPlan {
  const target: readonly [number, number, number] = [0, Math.max(8, area.height * 0.42), 0];
  const audience = site ? audienceOrientation(site) : null;
  if (audience) {
    return {
      position: [audience.local.x, 2.2, audience.local.z],
      target,
      source: "AUDIENCE",
    };
  }
  return {
    position: [
      0,
      Math.max(10, area.height * 0.18),
      -(area.depth / 2 + Math.max(60, area.width * 0.65)),
    ],
    target,
    source: "ESTIMATED",
  };
}

/** Constant-draw-call contract for the cinematic swarm at production scale. */
export function presentationRenderBudget(droneCount: number) {
  const count = Math.max(0, Math.floor(droneCount));
  return {
    bodyInstances: count,
    glowInstances: count,
    instancedDrawSurfaces: 2,
  } as const;
}
