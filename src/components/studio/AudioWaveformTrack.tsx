/**
 * AUDIO WAVEFORM TRACK — presentation only.
 *
 * Draws the visual peak envelope of the attached local track on the SAME time
 * axis as the clip track, so the operator can align choreography to music. It
 * renders nothing but pixels: no analysis, no beat detection, no show data.
 */
import { useEffect, useRef } from "react";

import type { WaveformPeaks } from "@/lib/show/audio";

export interface AudioWaveformTrackProps {
  readonly peaks: WaveformPeaks | null;
  /** First visible show time (negative during pre-show). */
  readonly startTime: number;
  /** Last visible show time. */
  readonly endTime: number;
  /** Show time at which the audio file starts. */
  readonly offset: number;
  readonly audioDuration: number;
  readonly time: number;
  readonly label: string;
  readonly onSeek: (t: number) => void;
}

export default function AudioWaveformTrack({
  peaks,
  startTime,
  endTime,
  offset,
  audioDuration,
  time,
  label,
  onSeek,
}: AudioWaveformTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const span = Math.max(0.001, endTime - startTime);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box || !peaks) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(box.clientWidth));
    const height = Math.max(1, Math.floor(box.clientHeight));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const style = getComputedStyle(canvas);
    ctx.fillStyle = style.color;
    const mid = height / 2;
    for (let x = 0; x < width; x++) {
      // Pixel -> show time -> audio time -> bucket. Keeps the envelope locked to
      // the timeline even while zooming or when the offset changes.
      const showTime = startTime + (x / width) * span;
      const audioTime = showTime - offset;
      if (audioTime < 0 || audioTime > audioDuration) continue;
      const bucket = Math.min(
        peaks.buckets - 1,
        Math.floor((audioTime / Math.max(0.001, audioDuration)) * peaks.buckets),
      );
      const lo = peaks.min[bucket] ?? 0;
      const hi = peaks.max[bucket] ?? 0;
      const top = mid - hi * mid * 0.94;
      const bottom = mid - lo * mid * 0.94;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [peaks, startTime, span, offset, audioDuration]);

  return (
    <div
      ref={boxRef}
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(startTime + ((e.clientX - rect.left) / rect.width) * span);
      }}
      className="relative mt-1.5 h-8 shrink-0 cursor-ew-resize overflow-hidden rounded-md border border-border bg-surface-sunken"
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full text-accent/70" />
      <span className="pointer-events-none absolute left-1.5 top-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <div
        className="pointer-events-none absolute top-0 h-full w-px bg-accent"
        style={{ left: `${((Math.max(startTime, Math.min(time, endTime)) - startTime) / span) * 100}%` }}
      />
    </div>
  );
}
