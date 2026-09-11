/**
 * CLIP PHASE NOTICE (presentation only).
 *
 * TAKEOFF and LANDING clips are flight phases: their trajectories come from the
 * dedicated vertical planners, so visual authoring (Visuals, Transform, Colour,
 * Motion, Saved states) is meaningless there. This surface explains that once,
 * in the operator's words, and offers ONE non-mutating navigation action.
 *
 * `clipPhase()` is the only phase authority. Nothing here mutates the project,
 * creates history, or invents a second insertion path.
 */
import { useStudio } from "@/lib/studio/store";
import { requestWorkspaceSection } from "@/lib/studio/workspaceSections";

import { clipPhase, type TimelineClip } from "@/lib/show/types";

export const CLIP_PHASE_NOTICE = "This is a flight phase. Select a SHOW clip to edit visuals.";
export const NO_SHOW_CLIP_NOTICE = "Add a visual to create a SHOW clip.";

/** Semantic badge label for one clip. */
export function clipPhaseBadge(clip: TimelineClip): string {
  return clipPhase(clip) === "SHOW" ? "SHOW · Editable visual" : `${clipPhase(clip)} · Flight phase`;
}

/**
 * Nearest SHOW clip to a reference start time. Pure projection of the canonical
 * timeline — no reordering, no mutation.
 */
export function nearestShowClip(
  timeline: readonly TimelineClip[],
  fromStart: number,
): TimelineClip | null {
  let best: TimelineClip | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const clip of timeline) {
    if (clipPhase(clip) !== "SHOW") continue;
    const distance = Math.abs(clip.start - fromStart);
    if (distance < bestDistance) {
      best = clip;
      bestDistance = distance;
    }
  }
  return best;
}

export default function ClipPhaseNotice({ clip }: { clip: TimelineClip }) {
  const { project, selectClip } = useStudio();
  const target = nearestShowClip(project.timeline, clip.start);

  return (
    <div className="space-y-2" data-testid="clip-phase-notice">
      <p
        className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground"
        data-testid="clip-phase-badge"
      >
        {clipPhaseBadge(clip)}
      </p>
      <p
        className="font-mono text-[10px] leading-relaxed text-muted-foreground"
        data-testid="clip-phase-explanation"
      >
        {CLIP_PHASE_NOTICE}
      </p>
      {target ? (
        <button
          type="button"
          className="chip-btn text-[10px]"
          data-testid="clip-phase-goto-show"
          onClick={() => selectClip(target.id)}
        >
          Go to nearest SHOW clip
        </button>
      ) : (
        <>
          <p
            className="font-mono text-[10px] leading-relaxed text-muted-foreground"
            data-testid="clip-phase-no-show"
          >
            {NO_SHOW_CLIP_NOTICE}
          </p>
          <button
            type="button"
            className="chip-btn text-[10px]"
            data-testid="clip-phase-focus-add-visual"
            onClick={() => requestWorkspaceSection("composer-add-visual")}
          >
            Add visual
          </button>
        </>
      )}
    </div>
  );
}
