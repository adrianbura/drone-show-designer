/**
 * VISUAL STATES TRACK — timeline lane for the saved-state cues of the selected
 * scene.
 *
 * PRESENTATION ONLY.
 *   - Reads `scene.visualStateCues`, `scene.visualStates` and `scene.visualGroups`
 *     (canonical) and nothing else. No second state or timeline engine.
 *   - Seeking uses the canonical `setTime`; deletion uses the canonical
 *     `removeSceneVisualStateCueById` (one existing undo revision).
 *   - Dragging is deliberately NOT implemented: no canonical move-cue action
 *     exists, so the lane declares dragging unavailable instead of mutating
 *     cue timing locally.
 */
import { ChevronDown, ChevronRight, Layers, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useStudio } from "@/lib/studio/store";
import { requestWorkspaceSection } from "@/lib/studio/workspaceSections";

function fmt(value: number): string {
  return `${value.toFixed(2)}s`;
}

export default function VisualStatesTrack({
  viewStart,
  viewEnd,
}: {
  viewStart: number;
  viewEnd: number;
}) {
  const { project, selectedClipId, selectedScene, setTime, removeSceneVisualStateCueById } =
    useStudio();
  const [open, setOpen] = useState(true);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);

  const clip = project.timeline.find((candidate) => candidate.id === selectedClipId) ?? null;

  const cues = useMemo(() => {
    if (!clip || !selectedScene) return [];
    const stateName = new Map((selectedScene.visualStates ?? []).map((s) => [s.id, s.name]));
    const groupName = new Map((selectedScene.visualGroups ?? []).map((g) => [g.id, g.name]));
    const formationReady = clip.start + clip.transition;
    return [...(selectedScene.visualStateCues ?? [])]
      .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
      .map((cue) => {
        const target = formationReady + cue.time;
        const duration = Math.max(0, cue.transitionDuration);
        return {
          id: cue.id,
          stateName: stateName.get(cue.stateId) ?? "Saved state",
          groupName: groupName.get(cue.groupId) ?? "Group",
          target,
          duration,
          transitionStart: target - duration,
        };
      });
  }, [clip, selectedScene]);

  // Empty scenes / scenes without cues add no visual noise at all.
  if (!clip || cues.length === 0) return null;

  const span = Math.max(0.001, viewEnd - viewStart);
  const pct = (value: number) => ((value - viewStart) / span) * 100;

  return (
    <div className="flex min-h-7 items-stretch" data-testid="visual-states-track">
      <div className="flex w-24 shrink-0 items-center border-r border-border px-1">
        <button
          type="button"
          data-testid="visual-states-track-toggle"
          aria-expanded={open}
          aria-controls="visual-states-track-lane"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 items-center gap-1 rounded px-1 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          title={`Visual states · ${cues.length} cue(s) · dragging unavailable`}
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <Layers className="size-3" />
          <span className="truncate">States</span>
        </button>
      </div>
      <div
        id="visual-states-track-lane"
        className="relative min-w-0 flex-1 overflow-hidden bg-surface-sunken"
      >
        {open
          ? cues.map((cue, index) => {
              const left = pct(cue.transitionStart);
              const width = pct(cue.target) - left;
              const selected = cue.id === selectedCueId;
              const details = `${cue.stateName} · ${cue.groupName} · transition ${fmt(cue.transitionStart)} → target ${fmt(cue.target)} · duration ${fmt(cue.duration)} · dragging unavailable`;
              return (
                <div
                  key={cue.id}
                  className="absolute flex h-5 items-center"
                  style={{
                    left: `${left}%`,
                    width: `max(${Math.max(0.5, width)}%, 48px)`,
                    top: 3 + (index % 2) * 2,
                  }}
                >
                  <button
                    type="button"
                    data-testid={`visual-state-cue-${cue.id}`}
                    data-selected={selected ? "1" : "0"}
                    aria-pressed={selected}
                    title={details}
                    onClick={() => {
                      setSelectedCueId(cue.id);
                      setTime(cue.target);
                      requestWorkspaceSection("visual-states");
                    }}
                    className={`min-w-0 flex-1 truncate rounded-l border px-1 text-left font-mono text-[9px] ${
                      selected
                        ? "border-warning bg-warning/30 text-foreground ring-1 ring-warning"
                        : "border-warning/50 bg-warning/15 text-muted-foreground"
                    }`}
                  >
                    {cue.stateName} · {cue.groupName} · {fmt(cue.target)}
                  </button>
                  <button
                    type="button"
                    data-testid={`visual-state-cue-delete-${cue.id}`}
                    aria-label={`Delete cue ${cue.stateName}`}
                    title={`Delete cue · ${cue.stateName}`}
                    onClick={() => {
                      removeSceneVisualStateCueById(cue.id);
                      setSelectedCueId((current) => (current === cue.id ? null : current));
                    }}
                    className="flex h-5 shrink-0 items-center rounded-r border border-l-0 border-warning/50 px-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-2.5" />
                  </button>
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}
