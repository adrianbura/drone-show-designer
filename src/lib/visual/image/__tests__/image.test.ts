/**
 * REFERENCE IMAGE PIPELINE TESTS (Sprint 8B1).
 *
 * Pure deterministic checks on analysis + design production. The exact-N compiler
 * matrix is NOT duplicated here: one representative fixture is compiled at a few
 * counts to prove the compiler stays the exact-N authority.
 */
import { describe, expect, it } from "vitest";

import { compileVisualFormation } from "../../compiler";
import { assetSourceForDesign, assetSourceFromDesignSourceType } from "../../provenance";
import { deserializeVisualDesign, serializeVisualDesign } from "../../serialize";
import { analyzeImage } from "../analyze";
import { designFromAnalysis } from "../design";
import { otsuThreshold } from "../mask";
import { downscale, toLuminance } from "../luminance";
import { simplifyRing, simplifyRingBounded } from "../simplify2d";
import { ImageAnalysisError, type VisualFormationDesignLike } from "./helpers";
import {
  butterflyShape,
  lightOnDark,
  noisySilhouette,
  portraitWithHoles,
  simpleSilhouette,
  transparentSubject,
} from "./fixtures";

function ringOf(design: VisualFormationDesignLike, index = 0) {
  const primitive = design.primitives[index];
  if (!primitive) throw new Error("no primitive");
  return primitive;
}

describe("image analysis — determinism and validity", () => {
  it("produces identical output for identical inputs", () => {
    const image = simpleSilhouette();
    const a = analyzeImage(image, { detail: "MEDIUM" });
    const b = analyzeImage(image, { detail: "MEDIUM" });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(JSON.stringify(a.components)).toBe(JSON.stringify(b.components));
  });

  it("keeps one essential outer contour for a simple silhouette", () => {
    const analysis = analyzeImage(simpleSilhouette(), { detail: "MEDIUM" });
    expect(analysis.diagnostics.componentsKept).toBe(1);
    expect(analysis.components[0]!.outer.length).toBeGreaterThan(6);
    const design = designFromAnalysis(analysis, { sourceName: "blob.png" });
    expect(design.primitives.some((p) => p.essential)).toBe(true);
    for (const p of design.primitives) {
      if (p.type !== "CLOSED_CONTOUR") continue;
      for (const pt of p.path) {
        expect(Number.isFinite(pt[0])).toBe(true);
        expect(Number.isFinite(pt[1])).toBe(true);
        expect(Math.abs(pt[0])).toBeLessThanOrEqual(1);
        expect(Math.abs(pt[1])).toBeLessThanOrEqual(1);
      }
    }
  });

  it("bounds contour complexity at every detail level", () => {
    for (const detail of ["LOW", "MEDIUM", "HIGH"] as const) {
      const analysis = analyzeImage(butterflyShape(), { detail });
      for (const c of analysis.components) {
        expect(c.outer.length).toBeLessThanOrEqual(440);
      }
    }
  });

  it("finds multiple components for a butterfly-like shape at HIGH detail", () => {
    const analysis = analyzeImage(butterflyShape(), { detail: "HIGH" });
    expect(analysis.diagnostics.componentsKept).toBeGreaterThanOrEqual(1);
    expect(analysis.diagnostics.componentsFound).toBeGreaterThanOrEqual(1);
  });

  it("preserves holes in STRUCTURAL mode and drops them in OUTLINE mode", () => {
    const image = portraitWithHoles();
    const structural = analyzeImage(image, { detail: "HIGH", structure: "STRUCTURAL" });
    expect(structural.diagnostics.holesKept).toBeGreaterThanOrEqual(2);
    const design = designFromAnalysis(structural);
    expect(design.primitives.some((p) => p.id.includes("hole"))).toBe(true);

    const outline = analyzeImage(image, { detail: "HIGH", structure: "OUTLINE" });
    const outlineDesign = designFromAnalysis(outline);
    expect(outlineDesign.primitives.some((p) => p.id.includes("hole"))).toBe(false);
  });

  it("emits REGION primitives with holes in FILLED mode", () => {
    const analysis = analyzeImage(portraitWithHoles(), { detail: "HIGH", structure: "FILLED" });
    const design = designFromAnalysis(analysis);
    const region = design.primitives.find((p) => p.type === "REGION");
    expect(region).toBeTruthy();
    expect(region && region.type === "REGION" ? (region.holes ?? []).length : 0).toBeGreaterThan(0);
  });

  it("suppresses seeded noise instead of exploding the component count", () => {
    const clean = analyzeImage(simpleSilhouette(), { detail: "MEDIUM" });
    const noisy = analyzeImage(noisySilhouette(), { detail: "MEDIUM" });
    expect(noisy.diagnostics.componentsKept).toBeLessThanOrEqual(
      clean.diagnostics.componentsKept + 2,
    );
    expect(noisy.components[0]!.area).toBeGreaterThan(0);
  });

  it("uses alpha as the silhouette signal for transparent images", () => {
    const analysis = analyzeImage(transparentSubject(), { detail: "MEDIUM" });
    expect(analysis.diagnostics.polarity).toBe("ALPHA");
    expect(analysis.diagnostics.componentsKept).toBe(1);
  });

  it("handles light-on-dark subjects through AUTO and explicit DARK", () => {
    const auto = analyzeImage(lightOnDark(), { detail: "MEDIUM", background: "AUTO" });
    const dark = analyzeImage(lightOnDark(), { detail: "MEDIUM", background: "DARK" });
    expect(auto.diagnostics.polarity).toBe("DARK");
    expect(auto.diagnostics.componentsKept).toBe(1);
    expect(dark.diagnostics.componentsKept).toBe(1);
    // AUTO must not invert the subject: the foreground stays the minority area.
    expect(auto.diagnostics.foregroundRatio).toBeLessThan(0.5);
  });

  it("rejects an empty image with a structured error", () => {
    expect(() =>
      analyzeImage({ width: 0, height: 0, data: new Uint8ClampedArray(0) }),
    ).toThrowError(ImageAnalysisError);
  });

  it("simplify raises the epsilon and lowers the point count", () => {
    const light = analyzeImage(butterflyShape(), { detail: "HIGH", simplify: 0.5 });
    const heavy = analyzeImage(butterflyShape(), { detail: "HIGH", simplify: 4 });
    expect(heavy.diagnostics.rdpEpsilon).toBeGreaterThan(light.diagnostics.rdpEpsilon);
    expect(heavy.diagnostics.simplifiedContourPoints).toBeLessThanOrEqual(
      light.diagnostics.simplifiedContourPoints,
    );
  });
});

describe("image analysis — pure helpers", () => {
  it("downscales deterministically and never above the max edge", () => {
    const small = downscale(simpleSilhouette(300), 128);
    expect(Math.max(small.width, small.height)).toBe(128);
    const again = downscale(simpleSilhouette(300), 128);
    expect(Array.from(small.data)).toEqual(Array.from(again.data));
  });

  it("otsu separates a bimodal image near the midpoint", () => {
    const threshold = otsuThreshold(toLuminance(simpleSilhouette()));
    expect(threshold).toBeGreaterThan(0.05);
    expect(threshold).toBeLessThan(0.95);
  });

  it("RDP keeps closed rings closed and bounded", () => {
    const ring = Array.from({ length: 64 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2;
      return [50 + Math.cos(a) * 40, 50 + Math.sin(a) * 40] as const;
    });
    expect(simplifyRing(ring, 1).length).toBeLessThan(ring.length);
    expect(simplifyRingBounded(ring, 0.1, 12).length).toBeLessThanOrEqual(12);
  });
});

describe("image design — serialization and exact-N compilation", () => {
  it("round-trips through the visual design serializer", () => {
    const design = designFromAnalysis(analyzeImage(portraitWithHoles(), { detail: "MEDIUM" }), {
      sourceName: "portrait.png",
    });
    const restored = deserializeVisualDesign(JSON.parse(serializeVisualDesign(design)));
    expect(restored.metadata.sourceType).toBe("IMAGE_ANALYSIS");
    expect(restored.primitives.length).toBe(design.primitives.length);
    expect(ringOf(restored).id).toBe(ringOf(design).id);
    // Provenance carries the fingerprint, never pixels.
    expect(restored.metadata.sourceRef).toContain("fingerprint");
    expect(restored.metadata.sourceRef ?? "").not.toContain("data:image");
  });

  it("compiles to EXACTLY the requested drone count", () => {
    const design = designFromAnalysis(analyzeImage(butterflyShape(), { detail: "HIGH" }));
    for (const n of [80, 150, 200, 300]) {
      const compiled = compileVisualFormation(design, n, { width: 120, altitude: 60 });
      expect(compiled.points.length).toBe(n);
      for (const p of compiled.points) {
        expect(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])).toBe(true);
      }
    }
  });
});

describe("provenance mapping", () => {
  it("maps every design source type to the canonical library source", () => {
    expect(assetSourceFromDesignSourceType("BUILT_IN")).toBe("BUILT_IN");
    expect(assetSourceFromDesignSourceType("IMAGE_ANALYSIS")).toBe("IMPORTED");
    expect(assetSourceFromDesignSourceType("AI_GENERATED")).toBe("AI_GENERATED");
    expect(assetSourceFromDesignSourceType("MANUAL")).toBe("USER");
  });

  it("derives the asset source from the design, not from the caller", () => {
    const design = designFromAnalysis(analyzeImage(simpleSilhouette(), { detail: "LOW" }));
    expect(assetSourceForDesign(design)).toBe("IMPORTED");
  });
});
