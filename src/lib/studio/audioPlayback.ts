/**
 * AUDIO PLAYBACK SLAVE.
 *
 * The canonical show clock stays the master: audio NEVER drives show time. This
 * hook only follows the clock — it starts, stops, re-seeks and re-rates a
 * decoded local buffer so the operator hears the track at the playhead. Nothing
 * here influences trajectories, safety or export.
 *
 * Audio time = show time - track offset. Drift beyond DRIFT_TOLERANCE re-syncs.
 */
import { useEffect, useRef } from "react";

/** Seconds of allowed divergence before the audio node is restarted. */
export const DRIFT_TOLERANCE = 0.25;

export interface AudioPlaybackOptions {
  /** Decoded local buffer, or null when no track is attached. */
  readonly buffer: AudioBuffer | null;
  readonly playing: boolean;
  /** Canonical show time (master). */
  readonly time: number;
  readonly speed: number;
  /** Show time at which the audio file starts (seconds). */
  readonly offset: number;
  /** 0..1 */
  readonly volume: number;
  readonly muted: boolean;
}

export function useAudioPlayback(options: AudioPlaybackOptions): void {
  const { buffer, playing, time, speed, offset, volume, muted } = options;
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  /** Show time the current node was started at, and the ctx time then. */
  const anchorRef = useRef<{ showTime: number; ctxTime: number } | null>(null);
  const timeRef = useRef(time);
  timeRef.current = time;

  const stop = () => {
    const source = sourceRef.current;
    sourceRef.current = null;
    anchorRef.current = null;
    if (!source) return;
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source.disconnect();
  };

  // Start / stop. Restarting is the only way to re-seek a buffer source.
  useEffect(() => {
    if (!buffer || !playing || muted) {
      stop();
      return;
    }
    const Ctx =
      (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!ctxRef.current) {
      ctxRef.current = new Ctx();
      gainRef.current = ctxRef.current.createGain();
      gainRef.current.connect(ctxRef.current.destination);
    }
    const ctx = ctxRef.current;
    void ctx.resume();
    const gain = gainRef.current!;

    const audioTime = timeRef.current - offset;
    // Before the track starts (or past its end) there is simply no sound.
    if (audioTime < 0 || audioTime >= buffer.duration) {
      stop();
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.05, speed);
    source.connect(gain);
    source.start(0, audioTime);
    sourceRef.current = source;
    anchorRef.current = { showTime: timeRef.current, ctxTime: ctx.currentTime };
    return stop;
  }, [buffer, playing, muted, speed, offset]);

  // Volume is continuous — never restarts the node.
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = muted ? 0 : Math.max(0, Math.min(1, volume));
  }, [volume, muted]);

  // Drift / seek correction: compares the expected show time of the running
  // node with the master clock and restarts only when they diverge audibly.
  useEffect(() => {
    const ctx = ctxRef.current;
    const anchor = anchorRef.current;
    if (!playing || !ctx || !anchor || !sourceRef.current || !buffer) return;
    const expected = anchor.showTime + (ctx.currentTime - anchor.ctxTime) * Math.max(0.05, speed);
    if (Math.abs(expected - time) <= DRIFT_TOLERANCE) return;
    const audioTime = time - offset;
    stop();
    if (audioTime < 0 || audioTime >= buffer.duration) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.05, speed);
    source.connect(gainRef.current!);
    source.start(0, audioTime);
    sourceRef.current = source;
    anchorRef.current = { showTime: time, ctxTime: ctx.currentTime };
  }, [time, playing, speed, offset, buffer]);

  // Release the context when the studio unmounts.
  useEffect(
    () => () => {
      stop();
      const ctx = ctxRef.current;
      ctxRef.current = null;
      gainRef.current = null;
      if (ctx) void ctx.close();
    },
    [],
  );
}
