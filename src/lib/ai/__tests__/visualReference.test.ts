/**
 * SPRINT 8C — AI VISUAL CREATOR TESTS.
 *
 * Only the deterministic mock provider is used: CI never performs a paid AI
 * call. The tests assert prompt enrichment, refinement mapping, determinism and
 * that the AI raster flows into the EXISTING pipeline with an exact-N result.
 */
import { describe, expect, it } from "vitest";

import {
  buildReferencePrompt,
  detailBudgetForCount,
  encodeGreyPng,
  mockVisualReferenceProvider,
  parseRefineInstruction,
  VisualReferenceError,
  wantsSymmetry,
} from "../visual";
import { analyzeImage, compileVisualFormation, designFromAnalysis } from "@/lib/visual";
import type { RgbaImage } from "@/lib/visual";

/** Decodes the mock PNG back to RGBA without a browser: re-render the raster. */
function greyToRgba(width: number, height: number, grey: Uint8Array): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const v = grey[i]!;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe("8C prompt enrichment", () => {
  it("asks for every drone-optimisation constraint", () => {
    const enriched = buildReferencePrompt({
      prompt: "Porumbel realist cu aripile complet deschise",
      droneCount: 150,
      style: "REALISTIC_STRUCTURAL",
    });
    const text = enriched.text.toLowerCase();
    for (const needle of [
      "isolated",
      "centred",
      "silhouette",
      "anatomy",
      "minimal background",
      "contrast",
      "150 drones",
    ]) {
      expect(text).toContain(needle);
    }
    expect(text).toContain("symmetric");
    expect(enriched.symmetric).toBe(true);
    expect(enriched.detailBudget).toBe("LOW");
  });

  it("scales the detail budget with the drone count", () => {
    expect(detailBudgetForCount(40)).toBe("MINIMAL");
    expect(detailBudgetForCount(150)).toBe("LOW");
    expect(detailBudgetForCount(200)).toBe("MODERATE");
    expect(detailBudgetForCount(600)).toBe("RICH");
  });

  it("is deterministic and only marks symmetry when appropriate", () => {
    const a = buildReferencePrompt({ prompt: "butterfly", droneCount: 200, style: "SILHOUETTE" });
    const b = buildReferencePrompt({ prompt: "butterfly", droneCount: 200, style: "SILHOUETTE" });
    expect(a.text).toBe(b.text);
    expect(wantsSymmetry("fluture")).toBe(true);
    expect(wantsSymmetry("a running car")).toBe(false);
  });
});

describe("8C refinement", () => {
  it("maps the mandated instructions in EN and RO", () => {
    expect(parseRefineInstruction("make wings wider")[0]).toContain("wider");
    expect(parseRefineInstruction("reduce feather detail")[0]).toContain("feather");
    expect(parseRefineInstruction("make more symmetrical")[0]).toContain("symmetric");
    expect(parseRefineInstruction("enlarge head")[0]).toContain("head");
    expect(parseRefineInstruction("open wings more")[0]).toContain("open the wings");
    expect(parseRefineInstruction("aripi mai late")[0]).toContain("wider");
  });

  it("passes an unknown instruction through verbatim", () => {
    expect(parseRefineInstruction("add a tiny crown")).toEqual(["add a tiny crown"]);
  });

  it("appends directives to the enriched prompt", () => {
    const enriched = buildReferencePrompt({
      prompt: "pigeon",
      droneCount: 150,
      style: "SILHOUETTE",
      directives: parseRefineInstruction("make wings wider"),
    });
    expect(enriched.text).toContain("Adjustments:");
  });
});

describe("8C mock provider", () => {
  it("rejects an empty prompt", async () => {
    await expect(
      mockVisualReferenceProvider.generate({
        prompt: "   ",
        droneCount: 150,
        style: "SILHOUETTE",
      }),
    ).rejects.toBeInstanceOf(VisualReferenceError);
  });

  it("is deterministic for identical requests", async () => {
    const req = { prompt: "pigeon", droneCount: 150, style: "SILHOUETTE" } as const;
    const a = await mockVisualReferenceProvider.generate(req);
    const b = await mockVisualReferenceProvider.generate(req);
    expect(a.imageBase64).toBe(b.imageBase64);
    expect(a.enrichedPrompt).toBe(b.enrichedPrompt);
    expect(a.mimeType).toBe("image/png");
  });

  it("changes the image when a refinement widens the wings", async () => {
    const base = await mockVisualReferenceProvider.generate({
      prompt: "pigeon",
      droneCount: 150,
      style: "SILHOUETTE",
    });
    const wider = await mockVisualReferenceProvider.generate({
      prompt: "pigeon",
      droneCount: 150,
      style: "SILHOUETTE",
      instruction: "make wings wider",
    });
    expect(wider.imageBase64).not.toBe(base.imageBase64);
    expect(wider.enrichedPrompt).toContain("wider");
  });

  it("emits a valid PNG signature", () => {
    const png = encodeGreyPng(2, 2, new Uint8Array([0, 255, 255, 0]));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});

describe("8C AI reference flows into the existing pipeline", () => {
  it("analyses and compiles to exactly N points without a new compiler", () => {
    // Same synthetic raster the mock provider renders, fed to 8B1 analysis.
    const size = 256;
    const grey = new Uint8Array(size * size).fill(255);
    for (let y = 60; y < 200; y += 1) {
      for (let x = 40; x < 216; x += 1) {
        const dx = (x - 128) / size;
        const dy = (y - 128) / size;
        if ((dx * dx) / 0.02 + (dy * dy) / 0.008 <= 1) grey[y * size + x] = 20;
      }
    }
    const analysis = analyzeImage(greyToRgba(size, size, grey), {
      detail: "MEDIUM",
      structure: "STRUCTURAL",
      background: "AUTO",
      simplify: 1,
      sourceName: "ai-reference.png",
    });
    const design = designFromAnalysis(analysis, { sourceName: "ai-reference.png" });
    expect(design.primitives.length).toBeGreaterThan(0);

    for (const n of [150, 200]) {
      const compiled = compileVisualFormation(design, n, { width: 120, altitude: 60 });
      expect(compiled.points.length).toBe(n);
    }
  });
});
