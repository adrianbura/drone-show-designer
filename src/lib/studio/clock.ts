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
  play: () => void;
  pause: () => void;
  /** Pause and rewind to 0. */
  stop: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
  setLoop: (loop: boolean) => void;
}

export function useShowClock(duration: number): ShowClock {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [loop, setLoop] = useState(true);

  const anchorShow = useRef(0);
  const anchorWall = useRef(0);
  const raf = useRef<number | null>(null);

  const clamp = useCallback(
    (t: number) => Math.max(0, Math.min(Math.max(duration, 0), t)),
    [duration],
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
    anchorShow.current = time >= duration ? 0 : time;
    anchorWall.current = typeof performance !== "undefined" ? performance.now() : 0;
    setPlaying(true);
  }, [time, duration]);

  const pause = useCallback(() => setPlaying(false), []);
  const stop = useCallback(() => {
    setPlaying(false);
    seek(0);
  }, [seek]);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  useEffect(() => {
    if (!playing) return;
    anchorWall.current = performance.now();
    const tick = (now: number) => {
      const elapsed = ((now - anchorWall.current) / 1000) * speed;
      let next = anchorShow.current + elapsed;
      if (next >= duration) {
        if (loop) {
          next = duration > 0 ? next % duration : 0;
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
  }, [playing, speed, loop, duration]);

  // Shrinking the show must never leave the playhead past the end.
  useEffect(() => {
    setTime((t) => Math.min(t, Math.max(duration, 0)));
  }, [duration]);

  return useMemo(
    () => ({
      time,
      playing,
      speed,
      loop,
      duration,
      play,
      pause,
      stop,
      toggle,
      seek,
      setSpeed,
      setLoop,
    }),
    [time, playing, speed, loop, duration, play, pause, stop, toggle, seek],
  );
}
