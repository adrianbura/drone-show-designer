import { Pause, Play, Plus, Repeat, SkipBack, Square, Trash2 } from "lucide-react";
import { useCallback, useRef } from "react";

import { rgbToHex } from "@/lib/show/lights";
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from "@/lib/studio/clock";
import { useStudio } from "@/lib/studio/store";

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 25);
  return `${m}:${s.toString().padStart(2, "0")}.${f.toString().padStart(2, "0")}`;
}

export default function Timeline() {
  const {
    project,
    duration,
    time,
    playing,
    togglePlay,
    stop,
    speed,
    setSpeed,
    loop,
    setLoop,
    setTime,
    selectedClipId,
    selectClip,
    removeClip,
    beatGrid,
    addClip,
    fullShowReport,
    focusIssue,
  } = useStudio();
  const trackRef = useRef<HTMLDivElement>(null);

  const scrub = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setTime(((clientX - rect.left) / rect.width) * duration);
    },
    [duration, setTime],
  );

  const pct = (v: number) => `${(v / duration) * 100}%`;

  return (
    <section className="flex h-full flex-col bg-panel">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <button
          onClick={() => setTime(0)}
          className="control-btn"
          aria-label="Return to show start"
        >
          <SkipBack className="size-4" />
        </button>
        <button onClick={togglePlay} className="control-btn control-btn-accent" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <button onClick={stop} className="control-btn" aria-label="Stop and rewind">
          <Square className="size-3.5" />
        </button>
        <span className="font-mono text-sm tabular-nums text-accent">{fmt(time)}</span>
        <span className="font-mono text-xs text-muted-foreground">/ {fmt(duration)}</span>
        <div className="ml-auto flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) as PlaybackSpeed)}
            className="studio-input w-16 py-0.5 font-mono text-[11px]"
            aria-label="Playback speed"
          >
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <button
            onClick={() => setLoop(!loop)}
            className={`control-btn ${loop ? "text-accent" : ""}`}
            aria-label="Toggle loop"
            aria-pressed={loop}
          >
            <Repeat className="size-4" />
          </button>
          <span>{project.audio.bpm} BPM</span>
          <span>{project.timeline.length} clips</span>
          <button
            onClick={() => addClip(project.formations[0]?.id ?? "")}
            className="control-btn"
            aria-label="Append clip"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden px-4 pb-3 pt-2">
        <div
          ref={trackRef}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e.clientX);
          }}
          className="relative h-full min-h-24 cursor-ew-resize rounded-md border border-border bg-surface-sunken"
        >
          {/* Beat grid */}
          {beatGrid.bars.map((b) => (
            <div
              key={`bar-${b}`}
              className="absolute top-0 h-full w-px bg-border/70"
              style={{ left: pct(b) }}
            />
          ))}

          {/* Full-show validation markers (errors and warnings, in show time) */}
          {fullShowReport?.issues
            .filter((i) => typeof i.time === "number" && i.severity !== "info")
            .slice(0, 400)
            .map((issue) => (
              <button
                key={`iss-${issue.id}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  focusIssue(issue);
                }}
                title={issue.message}
                aria-label={issue.message}
                className={`absolute bottom-0 h-2.5 w-[3px] ${
                  issue.severity === "error" ? "bg-destructive" : "bg-warning"
                }`}
                style={{ left: pct(issue.time ?? 0) }}
              />
            ))}

          {/* Clips */}
          {project.timeline.map((clip, row) => {
            const formation = project.formations.find((f) => f.id === clip.formationId);
            const total = clip.transition + clip.hold;
            const selected = clip.id === selectedClipId;
            return (
              <button
                key={clip.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  selectClip(clip.id);
                }}
                className={`clip-block ${selected ? "clip-block-selected" : ""}`}
                style={{
                  left: pct(clip.start),
                  width: pct(total),
                  top: `${8 + (row % 3) * 30}px`,
                  borderColor: rgbToHex(clip.color),
                  background: `linear-gradient(90deg, ${rgbToHex(clip.color)}33, ${rgbToHex(clip.color)}12)`,
                }}
              >
                <span className="truncate">{formation?.name ?? "Missing formation"}</span>
                <span
                  className="absolute inset-y-0 left-0 border-r border-dashed opacity-60"
                  style={{
                    width: `${(clip.transition / Math.max(0.01, total)) * 100}%`,
                    borderColor: rgbToHex(clip.color),
                  }}
                />
              </button>
            );
          })}

          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-0 h-full w-[2px] bg-accent shadow-[0_0_12px_var(--accent)]"
            style={{ left: pct(Math.min(time, duration)) }}
          >
            <div className="absolute -left-[5px] top-0 size-3 rotate-45 bg-accent" />
          </div>
        </div>

        {selectedClipId && (
          <button
            onClick={() => removeClip(selectedClipId)}
            className="absolute bottom-4 right-6 flex items-center gap-1.5 rounded border border-border bg-panel px-2 py-1 text-[11px] uppercase tracking-widest text-destructive hover:border-destructive"
          >
            <Trash2 className="size-3" /> Delete clip
          </button>
        )}
      </div>
    </section>
  );
}
