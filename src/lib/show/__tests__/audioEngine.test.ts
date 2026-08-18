import { describe, expect, it } from "vitest";

import { extractPeaks } from "../audio";
import { createDefaultProject } from "../defaultProject";
import { showDuration } from "../types";

describe("clean startup", () => {
  it("opens with an empty timeline and no attached audio", () => {
    const project = createDefaultProject(60);
    expect(project.timeline).toHaveLength(0);
    expect(showDuration(project)).toBe(0);
    expect(project.audio.attached).toBe(false);
    expect(project.audio.duration).toBe(0);
  });

  it("still provides an authoring palette of formations", () => {
    const project = createDefaultProject(60);
    expect(project.formations.length).toBeGreaterThan(0);
    for (const f of project.formations) expect(f.points).toHaveLength(60);
  });
});

describe("waveform peaks (display only)", () => {
  const samples = Array.from({ length: 4000 }, (_, i) => Math.sin((i / 4000) * Math.PI * 8));

  it("is deterministic for identical input", () => {
    const a = extractPeaks(samples, 64);
    const b = extractPeaks(samples, 64);
    expect(Array.from(a.max)).toEqual(Array.from(b.max));
    expect(Array.from(a.min)).toEqual(Array.from(b.min));
  });

  it("returns exactly the requested bucket count within [-1, 1]", () => {
    const peaks = extractPeaks(samples, 120);
    expect(peaks.buckets).toBe(120);
    expect(peaks.min).toHaveLength(120);
    for (let i = 0; i < 120; i++) {
      expect(peaks.min[i]!).toBeLessThanOrEqual(0);
      expect(peaks.max[i]!).toBeGreaterThanOrEqual(0);
      expect(peaks.max[i]!).toBeLessThanOrEqual(1);
      expect(peaks.min[i]!).toBeGreaterThanOrEqual(-1);
    }
  });

  it("stays silent for silence and empty input", () => {
    const silent = extractPeaks(new Float32Array(1000), 16);
    expect(Array.from(silent.max).every((v) => v === 0)).toBe(true);
    const empty = extractPeaks(new Float32Array(0), 16);
    expect(empty.buckets).toBe(16);
    expect(Array.from(empty.min).every((v) => v === 0)).toBe(true);
  });
});
