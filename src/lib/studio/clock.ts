/**
 * CANONICAL SHOW CLOCK — the single source of truth for show time.
 *
 * Every subsystem (viewport, timeline, lighting, trajectory sampling, markers,
 * safety visualisation and future audio sync) reads `time` from here. The
 * duration passed in must always come from `showDuration(project)`; the audio
 * track duration is unrelated metadata.
 *
 * Timing model: an anchor pair (showTime, wallClock) plus the requestAnimationFrame
 * timestamp. Show time is recomputed from the anchor each frame instead of being
 * accumulated, so there is no floating-point drift over a long show.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface ShowClock {
  /** Canonical show time in seconds. */
  readonly time: number;
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
  readonly loop: boolean;
  readonly duration: number;
  /** First playable show time: negative when a PRE-SHOW is planned. */
  readonly startTime: number;
  play: () => void;
  pause: () => void;
  /** Pause and rewind to the first playable time (pre-show start). */
  stop: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
  setLoop: (loop: boolean) => void;
}

export function useShowClock(duration: number, startTime = 0): ShowClock {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [loop, setLoop] = useState(true);

  const start = Math.min(0, startTime);
  const anchorShow = useRef(0);
  const anchorWall = useRef(0);
  const raf = useRef<number | null>(null);

  const clamp = useCallback(
    (t: number) => Math.max(start, Math.min(Math.max(duration, 0), t)),
    [duration, start],
  );

  const seek = useCallback(
    (t: number) => {
      const next = clamp(t);
      anchorShow.current = next;
      anchorWall.current = typeof performance !== "undefined" ? performance.now() : 0;
      setTime(next);
    },
    [clamp],
  );

  const play = useCallback(() => {
    anchorShow.current = time >= duration ? start : time;
    anchorWall.current = typeof performance !== "undefined" ? performance.now() : 0;
    setPlaying(true);
  }, [time, duration]);

  const pause = useCallback(() => setPlaying(false), []);
  const stop = useCallback(() => {
    setPlaying(false);
    seek(start);
  }, [seek, start]);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  useEffect(() => {
    if (!playing) return;
    anchorWall.current = performance.now();
    const tick = (now: number) => {
      const elapsed = ((now - anchorWall.current) / 1000) * speed;
      let next = anchorShow.current + elapsed;
      if (next >= duration) {
        if (loop) {
          const span = duration - start;
          next = span > 0 ? start + ((next - start) % span) : start;
          anchorShow.current = next;
          anchorWall.current = now;
        } else {
          setTime(duration);
          setPlaying(false);
          return;
        }
      }
      setTime(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [playing, speed, loop, duration, start]);

  // Shrinking the show must never leave the playhead past the end.
  useEffect(() => {
    setTime((t) => Math.max(start, Math.min(t, Math.max(duration, 0))));
  }, [duration, start]);

  return useMemo(
    () => ({
      time,
      playing,
      speed,
      loop,
      duration,
      startTime: start,
      play,
      pause,
      stop,
      toggle,
      seek,
      setSpeed,
      setLoop,
    }),
    [time, playing, speed, loop, duration, start, play, pause, stop, toggle, seek],
  );
}
