import { describe, expect, it } from "vitest";

import { createWeddingStoryProject } from "../stories/weddingStory";
import {
  doubleHeartPoints,
  engagementRingPoints,
  fireworksBurstPoints,
  friendshipPoints,
  mountainsPoints,
  seaAndMoonPoints,
  splitCount,
  twoSoulsPoints,
  weddingRingsPoints,
} from "../stories/geometry";

const GENERATORS = [
  twoSoulsPoints,
  friendshipPoints,
  mountainsPoints,
  seaAndMoonPoints,
  engagementRingPoints,
  weddingRingsPoints,
  doubleHeartPoints,
  fireworksBurstPoints,
];

describe("story geometry", () => {
  it("splits a budget exactly", () => {
    expect(splitCount(200, [1, 1]).reduce((a, b) => a + b, 0)).toBe(200);
    expect(splitCount(137, [3, 1.4]).reduce((a, b) => a + b, 0)).toBe(137);
  });

  it("produces exactly N finite points for every fleet size", () => {
    for (const n of [24, 48, 137, 200, 500]) {
      for (const gen of GENERATORS) {
        const pts = gen(n);
        expect(pts).toHaveLength(n);
        expect(pts.every((p) => p.every(Number.isFinite))).toBe(true);
        expect(pts.every((p) => p[1] > 0)).toBe(true);
      }
    }
  });

  it("is deterministic", () => {
    expect(weddingRingsPoints(200)).toEqual(weddingRingsPoints(200));
  });
});

describe("wedding story show", () => {
  it("builds a complete authored timeline", () => {
    const project = createWeddingStoryProject(200);
    expect(project.timeline.length).toBeGreaterThan(10);
    expect(project.timeline[0]?.phase).toBe("TAKEOFF");
    expect(project.timeline[project.timeline.length - 1]?.phase).toBe("LANDING");
    // Every clip resolves to a formation with the exact fleet size.
    for (const clip of project.timeline) {
      const formation = project.formations.find((f) => f.id === clip.formationId);
      expect(formation, clip.formationId).toBeDefined();
      expect(formation!.points).toHaveLength(200);
    }
    // Contiguous, gapless timeline.
    let cursor = 0;
    for (const clip of project.timeline) {
      expect(clip.start).toBeCloseTo(cursor, 6);
      cursor += clip.transition + clip.hold;
    }
    expect(cursor).toBeGreaterThan(120);
  });

  it("respects the project altitude ceiling", () => {
    const project = createWeddingStoryProject(200);
    const max = project.limits.maxAltitude;
    for (const f of project.formations) {
      for (const p of f.points) expect(p[1]).toBeLessThanOrEqual(max);
    }
  });
});

describe("wedding story separation", () => {
  for (const fleet of [48, 200]) {
    it(`keeps every formation above the separation limit with ${fleet} drones`, () => {
      const project = createWeddingStoryProject(fleet);
      for (const f of project.formations) {
        let min = Infinity;
        for (let i = 0; i < f.points.length; i++) {
          for (let j = i + 1; j < f.points.length; j++) {
            const a = f.points[i]!;
            const b = f.points[j]!;
            min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
          }
        }
        expect(min, `${f.id} min separation`).toBeGreaterThanOrEqual(
          project.safety.minSeparation,
        );
      }
    });
  }
});
