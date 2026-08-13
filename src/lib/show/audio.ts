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
