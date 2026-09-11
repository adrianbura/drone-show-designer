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
import {
  CLIP_PHASE_NOTICE,
  NO_SHOW_CLIP_NOTICE,
  clipPhaseBadge,
  nearestShowClip,
} from "@/lib/studio/clipPhaseNotice";
import { useStudio } from "@/lib/studio/store";
import { requestWorkspaceSection } from "@/lib/studio/workspaceSections";

import type { TimelineClip } from "@/lib/show/types";

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
