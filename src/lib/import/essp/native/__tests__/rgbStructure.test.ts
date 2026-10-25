import { describe, expect, it } from "vitest";
import { buildSyntheticEssp } from "../../codec";
import { buildReferenceShow } from "../../reference";
import { referenceDroneFileBytes } from "../layer";
import {
  analyzeRgbGroups,
  analyzeRgbNearGroups,
  analyzeRgbStructure,
  analyzeRgbTemporal,
  evaluateRgbReconstruction,
} from "../rgbStructure";
import type { ReferenceClipBinding } from "../types";

const bind = (end: number): ReferenceClipBinding => ({
  clipId: "c",
  order: 0,
  kind: "SCENE",
  sourceSegmentId: null,
  sourceClassification: null,
  referenceStart: 0,
  referenceHoldStart: 0,
  referenceEnd: end,
  owner: "REFERENCE",
  signature: "",
});
const TICKS = 240; // 20 s @ 12 Hz
async function show(color: (d: number, x: number, y: number, f: number) => number[], drones = 36) {
  return buildReferenceShow(
    Array.from({ length: drones }, (_, d) => {
      const x = d % 6,
        y = Math.floor(d / 6);
      return {
        name: `${d + 1}.essp`,
        bytes: buildSyntheticEssp({
          xyz: Array.from({ length: 161 }, () => [x * 200, 0, 3000 + y * 200]),
          rgb: Array.from({ length: TICKS + 1 }, (_, f) => color(d, x, y, f)),
        }),
      };
    }),
  );
}
const b20 = bind(TICKS / 12);
const sine = (f: number, phase = 0) =>
  Math.round(127 + 100 * Math.sin((2 * Math.PI * f) / 24 + phase));

describe("A — simultaneous exact color groups", () => {
  it("finds two supported groups", async () => {
    const s = await show((d) => (d < 18 ? [255, 0, 0] : [0, 0, 255]));
    const g = analyzeRgbGroups(s, b20);
    expect(g.status).toBe("MULTIPLE_GROUPS");
    expect(g.groups.map((x) => x.support)).toEqual([18, 18]);
    expect(g.ambiguousFraction).toBe(0);
  });
  it("reports ambiguity for per-drone unique noise", async () => {
    const s = await show((d, _x, _y, f) => [(d * 37 + f * 11) % 256, (d * 13) % 256, f % 256]);
    expect(analyzeRgbGroups(s, b20).status).toBe("AMBIGUOUS");
  });
});

describe("B — temporal evidence with held-out validation", () => {
  it("static colors", async () => {
    expect(analyzeRgbTemporal(await show(() => [10, 20, 30]), b20).status).toBe("STATIC");
  });
  it("in-phase pulsation validated on the second half", async () => {
    const r = analyzeRgbTemporal(await show((_d, _x, _y, f) => [sine(f), sine(f), sine(f)]), b20);
    expect(r.status).toBe("PULSATION_SUPPORTED");
    expect(r.periodSeconds).toBeCloseTo(2, 5);
    expect(r.heldOutCorrelation!).toBeGreaterThan(0.9);
  });
  it("position-dependent phase becomes a wave validated on held-out drones", async () => {
    const r = analyzeRgbTemporal(
      await show((_d, x, _y, f) => {
        const v = sine(f, (-2 * Math.PI * x) / 12);
        return [v, v, v];
      }),
      b20,
    );
    expect(r.status).toBe("WAVE_SUPPORTED");
    expect(r.waveHeldOutR2!).toBeGreaterThan(0.8);
  });
  it("periodicity only in the first half fails held-out validation", async () => {
    const r = analyzeRgbTemporal(
      await show((d, _x, _y, f) => {
        const v = f < TICKS / 2 ? sine(f) : (d * 97 + f * 53) % 256;
        return [v, v, v];
      }),
      b20,
    );
    expect(["PULSATION_SUPPORTED", "WAVE_SUPPORTED"]).not.toContain(r.status);
  });
  it("long intervals are bounded and reported unknown", async () => {
    const s = await buildReferenceShow(
      Array.from({ length: 4 }, (_, d) => ({
        name: `${d + 1}.essp`,
        bytes: buildSyntheticEssp({
          xyz: [[d * 100, 0, 3000]],
          rgb: Array.from({ length: 1300 }, (_, f) => [f % 256, 0, 0]),
        }),
      })),
    );
    expect(analyzeRgbTemporal(s, bind(1300 / 12)).status).toBe("TOO_LONG");
    expect(analyzeRgbTemporal(s, bind(10)).status).not.toBe("TOO_LONG");
  });
});

describe("C — reconstruction vs exact source", () => {
  it("accepts an exact group model and falls back to UNKNOWN for noise", async () => {
    const groupsShow = await show((d, _x, _y, f) => (d < 18 ? [f % 256, 0, 0] : [0, 0, 255]));
    const ok = evaluateRgbReconstruction(groupsShow, b20);
    expect(ok.reference).toBe("EXACT_SOURCE");
    expect(ok.best).toBe("EXACT_GROUPS_PLUS_UNGROUPED_UNKNOWN");
    const noise = evaluateRgbReconstruction(
      await show((d, _x, _y, f) => [(d * 37 + f * 11) % 256, (d * 61) % 256, (f * 7) % 256]),
      b20,
    );
    expect(noise.best).toBe("UNKNOWN");
    expect(noise.models.every((m) => m.maxAbsError > 2)).toBe(true);
  });
  it("never mutates source samples and keeps recipe UNKNOWN", async () => {
    const s = await show((d, _x, _y, f) => [d, f % 256, 3]);
    const before = s.drones.map(referenceDroneFileBytes);
    const report = JSON.stringify(s.report);
    expect(analyzeRgbStructure(s, b20).recipe).toBe("UNKNOWN");
    expect(s.drones.map(referenceDroneFileBytes)).toEqual(before);
    expect(JSON.stringify(s.report)).toBe(report);
  });
});

describe("A2 — near-identical groups per 5 s window", () => {
  it("groups ±1-byte noise that exact grouping rejects", async () => {
    const s = await show((d, _x, _y, f) => {
      const j = (f + d) % 36 === 0 ? 1 : 0;
      return d < 18 ? [200 + j, 10, 10] : [10, 10, 200 - j];
    });
    expect(analyzeRgbGroups(s, b20).status).toBe("AMBIGUOUS");
    const n = analyzeRgbNearGroups(s, b20);
    expect(n.windows).toHaveLength(4);
    for (const w of n.windows) {
      expect(w.status).toBe("MULTIPLE_GROUPS");
      expect(w.groups.map((g) => g.support)).toEqual([18, 18]);
      expect(w.groups[0]!.maxPairDistance).toBe(1);
      expect(w.groups[0]!.exact).toBe(false);
    }
  });
  it("rejects a difference of 3 bytes", async () => {
    const s = await show((d) => [100 + (d % 2) * 3, 0, 0], 4);
    const w = analyzeRgbNearGroups(s, b20).windows[0]!;
    expect(w.status).toBe("NO_GROUPS");
  });
  it("complete link does not chain 0→2→4", async () => {
    // values 0,0,0,2,2,2,4,4,4: chaining would merge all; complete link must not
    const s = await show((d) => [Math.floor(d / 3) * 2, 0, 0], 9);
    const w = analyzeRgbNearGroups(s, b20).windows[0]!;
    for (const g of w.groups) expect(g.maxPairDistance).toBeLessThanOrEqual(2);
    expect(w.groups.some((g) => g.support === 9)).toBe(false);
    expect(w.status).toBe("AMBIGUOUS");
    expect(w.contestedDrones).toBeGreaterThan(0);
  });
  it("windows are independent of scene boundaries", async () => {
    const s = await show((d, _x, _y, f) =>
      f < 60 ? [50, 50, 50] : d < 18 ? [255, 0, 0] : [0, 255, 0],
    );
    const n = analyzeRgbNearGroups(s, b20);
    expect(n.windows[0]!.status).toBe("SINGLE_GROUP");
    expect(n.windows[1]!.groups.map((g) => g.support)).toEqual([18, 18]);
  });
  it("requires support of at least 3", async () => {
    const s = await show((d) => [d < 2 ? 9 : 100 + d * 10, 0, 0], 6);
    expect(analyzeRgbNearGroups(s, b20).windows[0]!.status).toBe("NO_GROUPS");
  });
  it("structure keeps recipe UNKNOWN", async () => {
    const s = await show(() => [1, 2, 3]);
    const r = analyzeRgbStructure(s, b20);
    expect(r.recipe).toBe("UNKNOWN");
    expect(r.nearGroups.windows[0]!.status).toBe("SINGLE_GROUP");
  });
});
