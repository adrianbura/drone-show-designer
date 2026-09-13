/**
 * Operator-facing phases inside one SHOW clip.
 *
 * FORMATION is the incoming transition; DISPLAY is the stable hold. This is a
 * pure projection of canonical clip timing, not a new timeline or flight state.
 */
export type ClipAuthoringPhase = "FORMATION" | "DISPLAY";

export function clipAuthoringPhaseAtOffset(
  transition: number,
  hold: number,
  offset: number,
): ClipAuthoringPhase {
  const safeTransition = Math.max(0, Number.isFinite(transition) ? transition : 0);
  const total = Math.max(0, safeTransition + Math.max(0, Number.isFinite(hold) ? hold : 0));
  const local = Math.max(0, Math.min(total, Number.isFinite(offset) ? offset : 0));
  return local < safeTransition ? "FORMATION" : "DISPLAY";
}

export const clipAuthoringPhaseLabel = (phase: ClipAuthoringPhase): string =>
  phase === "FORMATION" ? "Formation" : "Display";
