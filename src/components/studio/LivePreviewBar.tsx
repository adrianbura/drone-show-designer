/**
 * LIVE PREVIEW BAR — presentation only.
 *
 * One consistent bar for BOTH colour and motion previews. It renders state it
 * is given and calls back into the CANONICAL store actions supplied by the
 * parent: it owns no preview data, no clock and no animation loop.
 */
import { Check, Pause, Play, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface LivePreviewBarProps {
  /** "LIGHTING" or "MOTION" — used for compatibility test ids only. */
  readonly kind: "LIGHTING" | "MOTION";
  /** Operator-facing preset/effect name. */
  readonly name: string;
  /** Operator-facing target name. */
  readonly targetName: string;
  /** Drones affected by the preview. */
  readonly droneCount: number;
  /** Whether the preview covers the whole visual or only selected points. */
  readonly targetScope: "OBJECTS" | "DRONES";
  readonly time: number;
  readonly playing: boolean;
  readonly onPlayPause: () => void;
  readonly onRestart: () => void;
  readonly onSeek: (time: number) => void;
  readonly seekMin: number;
  readonly seekMax: number;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}

export default function LivePreviewBar({
  kind,
  name,
  targetName,
  droneCount,
  targetScope,
  time,
  playing,
  onPlayPause,
  onRestart,
  onSeek,
  seekMin,
  seekMax,
  onApply,
  onCancel,
}: LivePreviewBarProps) {
  const scopeLabel = targetScope === "DRONES" ? "Selected drones only" : "Whole visual";
  return (
    <div
      data-testid="effect-live-preview"
      data-preview-kind={kind}
      className="sticky top-0 z-20 mt-2 w-full overflow-hidden rounded border-2 border-accent bg-panel p-2"
    >
      <div data-testid={kind === "LIGHTING" ? "lighting-effect-preview" : "motion-effect-preview"}>
        <div role="status" className="flex flex-wrap items-center gap-1.5">
          <span
            data-testid="effect-live-preview-badge"
            className="rounded bg-accent px-1 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-accent-foreground"
          >
            Preview
          </span>
          <span
            data-testid="effect-live-preview-name"
            className="min-w-0 truncate font-mono text-[10px] text-foreground"
          >
            {name}
          </span>
          <span
            data-testid="effect-live-preview-target"
            data-scope={targetScope}
            className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
          >
            {targetName} · {scopeLabel}
          </span>
          <span
            data-testid="effect-live-preview-drone-count"
            data-drones={droneCount}
            className="font-mono text-[10px] text-muted-foreground"
          >
            {droneCount} drone{droneCount === 1 ? "" : "s"}
          </span>
        </div>

        <p className="mt-0.5 font-mono text-[10px] text-warning">Project unchanged until Apply</p>

        {/* transport — wraps instead of scrolling horizontally */}
        <div
          className="mt-1 flex flex-wrap items-center gap-1"
          data-testid="effect-preview-transport"
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={playing ? "Pause preview" : "Play preview"}
            data-testid="effect-preview-play-pause"
            className="h-6 px-1.5"
            onClick={onPlayPause}
          >
            {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Restart preview"
            data-testid="effect-preview-restart"
            className="h-6 px-1.5"
            onClick={onRestart}
          >
            <RotateCcw className="size-3" />
          </Button>
          <input
            type="range"
            aria-label="Preview time"
            data-testid="effect-preview-seek"
            min={seekMin}
            max={Math.max(seekMin + 0.1, seekMax)}
            step={0.05}
            value={Math.min(Math.max(time, seekMin), Math.max(seekMin + 0.1, seekMax))}
            onChange={(event) => onSeek(Number(event.target.value))}
            className="h-4 min-w-[64px] flex-1"
          />
          <span
            data-testid="effect-preview-time"
            className="font-mono text-[10px] text-accent"
            data-time={time.toFixed(2)}
          >
            {time.toFixed(2)}s
          </span>
        </div>

        <div className="mt-1 grid grid-cols-2 gap-1">
          <Button
            type="button"
            size="sm"
            aria-label="Apply preview"
            data-testid="effect-preview-apply"
            className="h-6 gap-1 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
            onClick={onApply}
          >
            <Check className="size-3" /> Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Cancel preview"
            data-testid="effect-preview-cancel"
            className="h-6 gap-1 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
            onClick={onCancel}
          >
            <X className="size-3" /> Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
