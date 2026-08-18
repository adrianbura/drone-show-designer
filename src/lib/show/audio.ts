/**
 * Audio/Music Engine (client-side analysis layer).
 *
 * A BPM grid is generated locally so choreography can snap to musical time
 * without a backend. Real onset/beat detection (librosa/aubio) is expected to
 * live in the Python computation service behind `analyzeTrack`.
 */
import type { AudioTrack } from "./types";

export interface BeatGrid {
  beats: number[];
  bars: number[];
  beatDuration: number;
}

export function buildBeatGrid(track: AudioTrack, beatsPerBar = 4): BeatGrid {
  const beatDuration = 60 / Math.max(1, track.bpm);
  const beats: number[] = [];
  for (let t = track.offset; t <= track.duration; t += beatDuration) {
    beats.push(Number(t.toFixed(3)));
  }
  return {
    beats,
    bars: beats.filter((_, i) => i % beatsPerBar === 0),
    beatDuration,
  };
}

export function snapToBeat(time: number, grid: BeatGrid): number {
  if (grid.beats.length === 0) return time;
  return grid.beats.reduce((best, b) => (Math.abs(b - time) < Math.abs(best - time) ? b : best), grid.beats[0]!);
}

/** Reads duration from a local audio file without uploading it anywhere. */
export async function probeAudioFile(file: File): Promise<{ name: string; duration: number }> {
  const url = URL.createObjectURL(file);
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const el = document.createElement("audio");
      el.preload = "metadata";
      el.onloadedmetadata = () => resolve(el.duration);
      el.onerror = () => reject(new Error("Unsupported audio file"));
      el.src = url;
    });
    return { name: file.name, duration: Math.round(duration * 100) / 100 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * VISUAL PEAK ENVELOPE (pure).
 *
 * Reduces raw PCM samples to `buckets` min/max pairs for drawing. It is display
 * data only: no beat detection, no onset analysis and no influence on flight
 * computation. Deterministic for identical input.
 */
export interface WaveformPeaks {
  /** Number of buckets, i.e. horizontal resolution of the envelope. */
  readonly buckets: number;
  /** Per-bucket minimum sample value, -1..0. */
  readonly min: Float32Array;
  /** Per-bucket maximum sample value, 0..1. */
  readonly max: Float32Array;
}

export function extractPeaks(samples: ArrayLike<number>, buckets = 1200): WaveformPeaks {
  const count = Math.max(1, Math.floor(buckets));
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  const total = samples.length;
  if (total === 0) return { buckets: count, min, max };
  for (let b = 0; b < count; b++) {
    const from = Math.floor((b * total) / count);
    const to = Math.max(from + 1, Math.floor(((b + 1) * total) / count));
    let lo = 0;
    let hi = 0;
    for (let i = from; i < to && i < total; i++) {
      const v = samples[i] ?? 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { buckets: count, min, max };
}

/** Mono mixdown of a decoded buffer — input for the visual envelope. */
export function mixdownToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const out = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i]! += data[i]! / channels;
  }
  return out;
}

/**
 * Decodes a LOCAL audio file in the browser. The file never leaves the machine
 * and is never embedded in the project file: only its name, duration and tempo
 * metadata are persisted.
 */
export async function decodeAudioFile(
  file: File,
): Promise<{ name: string; duration: number; buffer: AudioBuffer; peaks: WaveformPeaks }> {
  const Ctx =
    (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("Web Audio is unavailable in this browser");
  const ctx = new Ctx();
  try {
    const bytes = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    return {
      name: file.name,
      duration: Math.round(buffer.duration * 1000) / 1000,
      buffer,
      peaks: extractPeaks(mixdownToMono(buffer)),
    };
  } finally {
    void ctx.close();
  }
}
