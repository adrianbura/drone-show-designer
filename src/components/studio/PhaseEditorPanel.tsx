/**
 * PHASE EDITOR SHELL (presentation only).
 *
 * One compact workspace section for the two operator-facing parts of a SHOW
 * clip: FORMATION (incoming transition) and DISPLAY (stable hold). It reads the
 * canonical `clip.transition` / `clip.hold` numbers through the pure
 * projections in `src/lib/studio/phaseEditor.ts` and routes to the EXISTING
 * canonical editors.
 *
 * Invariants:
 *   - opening, closing and every shortcut mutate NOTHING (no project change, no
 *     history revision, no planning),
 *   - Play phase / Restart phase only move the existing show clock,
 *   - there is no Apply button here: applying belongs to the canonical editor
 *     that produced a preview.
 */
import { useEffect, useState } from "react";

import { formatShowTime } from "@/lib/studio/timelineEdit";
import { focusStudioSurface } from "@/lib/studio/inspectorFocus";
import {
  canOpenPhaseEditor,
  onPhaseEditorRequest,
  phaseEditorHeader,
  phaseInterval,
  phaseIntervalMeaning,
  phaseShortcuts,
  type PhaseShortcut,
} from "@/lib/studio/phaseEditor";
import type { ClipAuthoringPhase } from "@/lib/studio/clipAuthoringPhase";
import { useStudio } from "@/lib/studio/store";
import { requestWorkspaceSection } from "@/lib/studio/workspaceSections";

const EMPTY_NOTICE =
  "Right-click the Formation or Display part of a SHOW clip to open its phase editor.";

export default function PhaseEditorPanel() {
  const {
    project,
    setTime,
    play,
    pause,
    selectedScene,
    selectedSceneObjectIds,
    selectedScenePointIds,
  } = useStudio();
  const [target, setTarget] = useState<{ clipId: string; phase: ClipAuthoringPhase } | null>(null);

  useEffect(
    () => onPhaseEditorRequest((request) => setTarget({ clipId: request.clipId, phase: request.phase })),
    [],
  );

  const clip = target ? (project.timeline.find((c) => c.id === target.clipId) ?? null) : null;
  const phase = target?.phase ?? null;

  if (!clip || !phase || !canOpenPhaseEditor(clip)) {
    return (
      <p
        data-testid="phase-editor-empty"
        className="font-mono text-[10px] leading-relaxed text-muted-foreground"
      >
        {EMPTY_NOTICE}
      </p>
    );
  }

  const interval = phaseInterval(clip, phase);
  const objectName = selectedScene?.objects.find((o) => o.id === selectedSceneObjectIds[0])?.name;
  const displayTarget =
    selectedScenePointIds.length > 0
      ? `${selectedScenePointIds.length} drones selected`
      : (objectName ?? (selectedSceneObjectIds.length > 1
          ? `${selectedSceneObjectIds.length} visuals selected`
          : "No visual selected"));

  const openShortcut = (shortcut: PhaseShortcut) => {
    if (shortcut.kind === "SURFACE") {
      focusStudioSurface({ surface: shortcut.surface, clipId: clip.id });
      return;
    }
    requestWorkspaceSection(shortcut.control);
  };

  return (
    <div className="space-y-2" data-testid="phase-editor">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          data-testid="phase-editor-header"
          data-phase={phase}
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground"
        >
          {phaseEditorHeader(phase)}
        </span>
        <span className="min-w-0 truncate font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {clip.id}
        </span>
      </div>

      <p
        data-testid="phase-editor-interval"
        className="break-words font-mono text-[10px] leading-relaxed text-muted-foreground"
      >
        {formatShowTime(interval.start)} → {formatShowTime(interval.end)} ·{" "}
        {interval.duration.toFixed(1)}s
      </p>
      <p
        data-testid="phase-editor-interval-meaning"
        className="break-words font-mono text-[9px] leading-relaxed text-muted-foreground"
      >
        {phaseIntervalMeaning(phase)}
      </p>

      {phase === "DISPLAY" ? (
        <p
          data-testid="phase-editor-target"
          className="break-words font-mono text-[10px] leading-relaxed text-muted-foreground"
        >
          Target: {displayTarget}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className="chip-btn text-[10px]"
          data-testid="phase-editor-play"
          onClick={() => {
            setTime(interval.start);
            play();
          }}
        >
          Play phase
        </button>
        <button
          type="button"
          className="chip-btn text-[10px]"
          data-testid="phase-editor-restart"
          onClick={() => {
            pause();
            setTime(interval.start);
          }}
        >
          Restart phase
        </button>
      </div>

      <div className="flex flex-wrap gap-1" data-testid="phase-editor-shortcuts">
        {phaseShortcuts(phase).map((shortcut) => (
          <button
            key={shortcut.id}
            type="button"
            className="chip-btn text-[10px]"
            data-testid={`phase-editor-shortcut-${shortcut.id}`}
            onClick={() => openShortcut(shortcut)}
          >
            {shortcut.label}
          </button>
        ))}
      </div>

      <p
        data-testid="phase-editor-apply-note"
        className="break-words font-mono text-[9px] leading-relaxed text-muted-foreground"
      >
        Opening a phase changes nothing. Changes are applied in the editor you open.
      </p>
    </div>
  );
}
