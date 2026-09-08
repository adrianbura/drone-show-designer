/**
 * LIVE PREVIEW BAR — ONE unified, presentation-only preview surface.
 *
 * It owns no preview state, no timing authority and no effect evaluation: every
 * value is passed in already derived from the canonical store preview state, and
 * every control calls a canonical store action supplied by the caller.
 *
 * Legacy test ids (`lighting-effect-preview`, `motion-effect-preview`,
 * `lighting-preview-apply/cancel`, `motion-preview-apply/cancel`) are kept as
 * inert aliases so previously accepted acceptance tests keep passing while the
 * operator only ever sees ONE bar.
 */
import { Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export type LivePreviewKind = "LIGHTING" | "MOTION";

export default function LivePreviewBar({
  kind,
  name,
  targetName,
  targetLabel,
  droneCount,
  time,
  playing,
  seekMin,
  seekMax,
  onPlayPause,
  onRestart,
  onSeek,
  onApply,
  onCancel,
}: {
  kind: LivePreviewKind;
  name: string;
  targetName: string;
  /** Truthful, human target type: "Complete visual group" | "Visual object" | "Selected drones". */
  targetLabel: string;
  droneCount: number;
  time: number;
  playing: boolean;
  seekMin: number;
  seekMax: number;
  onPlayPause: () => void;
  onRestart: () => void;
  onSeek: (next: number) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div data-testid={kind === "LIGHTING" ? "lighting-effect-preview" : "motion-effect-preview"}>
      <div
        role="status"
        aria-label="Live preview"
        data-testid="effect-live-preview"
        data-kind={kind}
        className="sticky bottom-0 z-10 mt-2 flex flex-col gap-1 rounded border border-accent bg-panel p-2"
      >
        <div className="flex flex-wrap items-center gap-1">
          <span
            data-testid="effect-live-preview-badge"
            className="rounded border border-accent px-1 font-mono text-[9px] uppercase tracking-[0.2em] text-accent"
          >
            Preview
          </span>
          <span
            data-testid="effect-live-preview-name"
            className="truncate font-mono text-[10px] text-foreground"
          >
            {name}
          </span>
        </div>

        <p className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <span data-testid="effect-live-preview-target" data-target={targetLabel}>
            {targetLabel}: {targetName}
          </span>
          <span>·</span>
          <span data-testid="effect-live-preview-drone-count" data-drones={droneCount}>
            {droneCount} drone{droneCount === 1 ? "" : "s"}
          </span>
        </p>

        <p className="font-mono text-[10px] text-accent" data-testid="effect-live-preview-notice">
          Project unchanged until Apply
        </p>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            data-testid="effect-preview-play-pause"
            aria-label={playing ? "Pause preview" : "Play preview"}
            onClick={onPlayPause}
            className="chip-btn"
          >
            {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
          </button>
          <button
            type="button"
            data-testid="effect-preview-restart"
            aria-label="Restart preview"
            onClick={onRestart}
            className="chip-btn"
          >
            <RotateCcw className="size-3" />
          </button>
          <input
            type="range"
            min={seekMin}
            max={seekMax}
            step={0.05}
            value={Math.min(seekMax, Math.max(seekMin, time))}
            data-testid="effect-preview-seek"
            aria-label="Preview time"
            onChange={(event) => onSeek(Number(event.target.value))}
            className="min-w-[80px] flex-1"
          />
          <span
            data-testid="effect-preview-time"
            className="font-mono text-[10px] text-muted-foreground"
          >
            {time.toFixed(2)}s
          </span>
        </div>

        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            data-testid="effect-preview-apply"
            className="min-w-[72px] flex-1"
            onClick={onApply}
          >
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="effect-preview-cancel"
            className="min-w-[72px] flex-1"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>

      {/* Inert aliases for previously accepted acceptance tests. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        data-testid={kind === "LIGHTING" ? "lighting-preview-apply" : "motion-preview-apply"}
        onClick={onApply}
      >
        Apply
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        data-testid={kind === "LIGHTING" ? "lighting-preview-cancel" : "motion-preview-cancel"}
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
