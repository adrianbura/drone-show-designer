/**
 * VISUAL STATES TRACK — timeline lane for the saved-state cues of the selected
 * scene.
 *
 * PRESENTATION ONLY.
 *   - Reads `scene.visualStateCues`, `scene.visualStates` and `scene.visualGroups`
 *     (canonical) and nothing else. No second state or timeline engine.
 *   - Seeking uses the canonical `setTime`; deletion uses the canonical
 *     `removeSceneVisualStateCueById`; editing uses the canonical
 *     `patchSceneVisualStateCueById` (one existing undo revision each).
 *   - Dragging keeps an ephemeral draft in component state and calls the
 *     canonical patch exactly once, on pointer release. Escape cancels the
 *     gesture without mutating the project.
 *   - Snapping goes through the single timeline snap authority supplied by the
 *     timeline (`snapContext`); no second snapping system exists here.
 */
import { ChevronDown, ChevronRight, Layers, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStudio } from "@/lib/studio/store";
import { snapTimelineTime, type SnapContext } from "@/lib/studio/timelineEdit";
import {
  setSelectedVisualStateCueId,
  useSelectedVisualStateCueId,
} from "@/lib/studio/visualStateCueSelection";
import { requestWorkspaceSection } from "@/lib/studio/workspaceSections";

function fmt(value: number): string {
  return `${value.toFixed(2)}s`;
}

type Draft = {
  readonly cueId: string;
  readonly kind: "MOVE" | "RESIZE";
  readonly target: number;
  readonly duration: number;
  readonly startX: number;
  readonly moved: boolean;
};

const DRAG_THRESHOLD_PX = 3;

export default function VisualStatesTrack({
  viewStart,
  viewEnd,
  snapContext,
}: {
  viewStart: number;
  viewEnd: number;
  snapContext?: (altKey: boolean) => SnapContext;
}) {
  const {
    project,
    selectedClipId,
    selectedScene,
    setTime,
    removeSceneVisualStateCueById,
    patchSceneVisualStateCueById,
  } = useStudio();
  const [open, setOpen] = useState(true);
  const selectedCueId = useSelectedVisualStateCueId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const suppressClickRef = useRef(false);
  draftRef.current = draft;

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

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const el = laneRef.current;
      const span = Math.max(0.001, viewEnd - viewStart);
      if (!el) return viewStart;
      const rect = el.getBoundingClientRect();
      const width = rect.width || 1;
      return viewStart + ((clientX - rect.left) / width) * span;
    },
    [viewEnd, viewStart],
  );

  /** Pointer gesture: ephemeral draft only, one canonical patch on release. */
  useEffect(() => {
    if (!draftRef.current || !clip) return;
    const formationReady = clip.start + clip.transition;
    const snap = (raw: number, altKey: boolean) =>
      snapContext ? snapTimelineTime(raw, snapContext(altKey)).time : raw;

    const onMove = (event: PointerEvent) => {
      const current = draftRef.current;
      if (!current) return;
      const moved = current.moved || Math.abs(event.clientX - current.startX) > DRAG_THRESHOLD_PX;
      if (!moved) return;
      const raw = snap(timeFromClientX(event.clientX), event.altKey);
      if (current.kind === "MOVE") {
        const target = Math.min(formationReady + clip.hold, Math.max(formationReady, raw));
        setDraft({ ...current, target, moved: true });
      } else {
        const duration = Math.max(0, current.target - Math.min(current.target, raw));
        setDraft({ ...current, duration, moved: true });
      }
    };

    const onUp = () => {
      const current = draftRef.current;
      setDraft(null);
      if (!current) return;
      if (!current.moved) return; // click without drag keeps click-to-seek behaviour
      // Pointer-up is normally followed by click. Do not let that click seek
      // back to the cue's pre-drag target from this render.
      suppressClickRef.current = true;
      if (current.kind === "MOVE") {
        patchSceneVisualStateCueById(current.cueId, { time: current.target - formationReady });
      } else {
        patchSceneVisualStateCueById(current.cueId, { transitionDuration: current.duration });
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      draftRef.current = null;
      suppressClickRef.current = true;
      setDraft(null);
    };

    const onCancel = () => {
      draftRef.current = null;
      suppressClickRef.current = true;
      setDraft(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKey);
    };
    // Gesture identity only: the draft values live in draftRef.
  }, [draft?.cueId, draft?.kind, clip, patchSceneVisualStateCueById, snapContext, timeFromClientX]);

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
          title={`Visual states · ${cues.length} cue(s) · drag to retime`}
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <Layers className="size-3" />
          <span className="truncate">States</span>
        </button>
      </div>
      <div
        id="visual-states-track-lane"
        ref={laneRef}
        className="relative min-w-0 flex-1 overflow-hidden bg-surface-sunken"
      >
        {open
          ? cues.map((cue, index) => {
              const dragging = draft?.cueId === cue.id && draft.moved;
              const target = dragging ? draft.target : cue.target;
              const duration = dragging ? draft.duration : cue.duration;
              const transitionStart = target - duration;
              const left = pct(transitionStart);
              const width = pct(target) - left;
              const selected = cue.id === selectedCueId;
              const details = `${cue.stateName} · ${cue.groupName} · transition ${fmt(transitionStart)} → target ${fmt(target)} · duration ${fmt(duration)}${dragging ? " · preview (not applied yet)" : " · drag body to retime, drag left edge to resize"}`;
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
                  <span
                    role="separator"
                    aria-label={`Resize transition of ${cue.stateName}`}
                    data-testid={`visual-state-cue-resize-${cue.id}`}
                    title={`Drag to change transition duration · ${cue.stateName}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                      setSelectedVisualStateCueId(cue.id);
                      setDraft({
                        cueId: cue.id,
                        kind: "RESIZE",
                        target: cue.target,
                        duration: cue.duration,
                        startX: event.clientX,
                        moved: false,
                      });
                    }}
                    className="h-5 w-1.5 shrink-0 cursor-ew-resize rounded-l border border-r-0 border-warning/70 bg-warning/40"
                  />
                  <button
                    type="button"
                    data-testid={`visual-state-cue-${cue.id}`}
                    data-selected={selected ? "1" : "0"}
                    data-preview={dragging ? "1" : "0"}
                    aria-pressed={selected}
                    title={details}
                    onPointerDown={(event) => {
                      setSelectedVisualStateCueId(cue.id);
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                      setDraft({
                        cueId: cue.id,
                        kind: "MOVE",
                        target: cue.target,
                        duration: cue.duration,
                        startX: event.clientX,
                        moved: false,
                      });
                    }}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      setSelectedVisualStateCueId(cue.id);
                      setTime(cue.target);
                      requestWorkspaceSection("visual-states");
                    }}
                    className={`min-w-0 flex-1 cursor-grab truncate border px-1 text-left font-mono text-[9px] ${
                      dragging
                        ? "border-dashed border-warning bg-warning/20 text-foreground"
                        : selected
                          ? "border-warning bg-warning/30 text-foreground ring-1 ring-warning"
                          : "border-warning/50 bg-warning/15 text-muted-foreground"
                    }`}
                  >
                    {dragging ? "Preview · " : null}
                    {cue.stateName} · {cue.groupName} · {fmt(target)}
                  </button>
                  <button
                    type="button"
                    data-testid={`visual-state-cue-delete-${cue.id}`}
                    aria-label={`Delete cue ${cue.stateName}`}
                    title={`Delete cue · ${cue.stateName}`}
                    onClick={() => {
                      removeSceneVisualStateCueById(cue.id);
                      setSelectedVisualStateCueId(selectedCueId === cue.id ? null : selectedCueId);
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
