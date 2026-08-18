/**
 * STRUCTURE EDITOR TESTS (Sprint 8B2).
 *
 * Pure and deterministic: commands, importance mapping, coordinate conversion,
 * hit-testing, immutability of the extracted design, serialization of edited
 * designs and — the hard invariant — exact-N compilation after every edit.
 */
import { describe, expect, it } from "vitest";

import { analyzeImage } from "../../image/analyze";
import { portraitWithHoles, simpleSilhouette } from "../../image/__tests__/fixtures";
import { designFromAnalysis } from "../../image/design";
import { compileVisualFormation } from "../../compiler";
import { parseDesign, serializeDesign, validateDesign } from "../../serialize";
import type { DesignPoint, VisualFormationDesign } from "../../types";
import {
  addPolyline,
  deletePrimitive,
  enabledPrimitiveCount,
  isDrawablePath,
  nextPolylineId,
  setPrimitiveEnabled,
  setPrimitiveImportance,
} from "../commands";
import { hitTestDesign } from "../hitTest";
import { importanceOf, importanceValue } from "../importance";
import {
  analysisToDesign,
  canvasToAnalysis,
  designToAnalysis,
  letterbox,
  screenToDesign,
  toleranceInDesignUnits,
} from "../viewTransform";

function extractedDesign(): VisualFormationDesign {
  const analysis = analyzeImage(portraitWithHoles(220), {
    detail: "MEDIUM",
    structure: "STRUCTURAL",
  });
  return designFromAnalysis(analysis, { sourceName: "fixture.png" });
}

function snapshot(design: VisualFormationDesign): string {
  return JSON.stringify(design);
}

describe("structure editor commands", () => {
  it("disables and re-enables a primitive without mutating the source", () => {
    const design = extractedDesign();
    const before = snapshot(design);
    const id = design.primitives[0]!.id;

    const disabled = setPrimitiveEnabled(design, id, false);
    expect(disabled).not.toBe(design);
    expect(disabled.primitives.find((p) => p.id === id)!.enabled).toBe(false);
    expect(enabledPrimitiveCount(disabled)).toBe(design.primitives.length - 1);
    expect(snapshot(design)).toBe(before);

    const enabled = setPrimitiveEnabled(disabled, id, true);
    expect(enabled.primitives.find((p) => p.id === id)!.enabled).toBe(true);
    expect(enabledPrimitiveCount(enabled)).toBe(design.primitives.length);
  });

  it("maps importance onto the existing priority/essential fields", () => {
    const design = extractedDesign();
    const id = design.primitives[1]!.id;
    for (const level of ["LOW", "MEDIUM", "HIGH", "ESSENTIAL"] as const) {
      const next = setPrimitiveImportance(design, id, level);
      const primitive = next.primitives.find((p) => p.id === id)!;
      expect(primitive.priority).toBe(importanceValue(level).priority);
      expect(primitive.essential).toBe(importanceValue(level).essential);
      expect(importanceOf(primitive)).toBe(level);
    }
  });

  it("deletes a primitive and clears mirror references", () => {
    const base = extractedDesign();
    const victim = base.primitives[1]!.id;
    const withMirror: VisualFormationDesign = {
      ...base,
      primitives: base.primitives.map((p, i) => (i === 0 ? { ...p, mirrorOf: victim } : p)),
    };
    const next = deletePrimitive(withMirror, victim);
    expect(next.primitives.some((p) => p.id === victim)).toBe(false);
    expect(next.primitives[0]!.mirrorOf).toBeUndefined();
    expect(validateDesign(next)).toEqual([]);
    // Source untouched.
    expect(withMirror.primitives.some((p) => p.id === victim)).toBe(true);
  });

  it("is a no-op on unknown ids and never empties the design", () => {
    const design = extractedDesign();
    expect(setPrimitiveEnabled(design, "nope", false)).toBe(design);
    expect(setPrimitiveImportance(design, "nope", "HIGH")).toBe(design);
    expect(deletePrimitive(design, "nope")).toBe(design);
    const single: VisualFormationDesign = { ...design, primitives: [design.primitives[0]!] };
    expect(deletePrimitive(single, single.primitives[0]!.id)).toBe(single);
  });

  it("adds a polyline with a stable id and rejects degenerate paths", () => {
    const design = extractedDesign();
    const path: DesignPoint[] = [
      [-0.2, 0.1],
      [0, 0.2],
      [0.2, 0.05],
    ];
    expect(nextPolylineId(design)).toBe("edit-poly-1");
    const next = addPolyline(design, path);
    const added = next.primitives.find((p) => p.id === "edit-poly-1")!;
    expect(added.type).toBe("POLYLINE");
    expect(nextPolylineId(next)).toBe("edit-poly-2");
    expect(validateDesign(next)).toEqual([]);

    expect(isDrawablePath([[0, 0]])).toBe(false);
    expect(
      isDrawablePath([
        [0.1, 0.1],
        [0.1, 0.1],
      ]),
    ).toBe(false);
    expect(addPolyline(design, [[0, 0]])).toBe(design);
  });

  it("serializes an edited design without editor-only state", () => {
    const design = extractedDesign();
    const edited = addPolyline(
      setPrimitiveImportance(setPrimitiveEnabled(design, design.primitives[0]!.id, false), design.primitives[1]!.id, "ESSENTIAL"),
      [
        [-0.1, 0],
        [0.1, 0.15],
      ],
    );
    const text = serializeDesign(edited);
    expect(text).not.toContain("selectedId");
    expect(text).not.toContain("drawing");
    expect(text).not.toContain("past");
    const round = parseDesign(text);
    expect(round.primitives.length).toBe(edited.primitives.length);
    expect(round.primitives.find((p) => p.id === "edit-poly-1")).toBeDefined();
  });
});

describe("structure editor coordinates", () => {
  it("round-trips screen -> design -> analysis", () => {
    const t = letterbox(268, 200, 384, 288);
    const rect = { left: 40, top: 10, width: 268, height: 200 };
    const point = screenToDesign(rect, t, 40 + 134, 10 + 100);
    const [ax, ay] = designToAnalysis(384, 288, point);
    // The canvas centre maps to the analysis centre, and back exactly.
    expect(ax).toBeCloseTo(192, 5);
    expect(ay).toBeCloseTo(144, 5);
  });

  it("keeps geometry stable when the preview is CSS-scaled", () => {
    const t = letterbox(268, 200, 384, 288);
    const a = screenToDesign({ left: 0, top: 0, width: 268, height: 200 }, t, 100, 80);
    const b = screenToDesign({ left: 0, top: 0, width: 536, height: 400 }, t, 200, 160);
    expect(b[0]).toBeCloseTo(a[0], 9);
    expect(b[1]).toBeCloseTo(a[1], 9);
  });

  it("inverts the letterbox and the design mapping exactly", () => {
    const t = letterbox(268, 200, 300, 200);
    const [ax, ay] = canvasToAnalysis(t, t.offsetX + 10 * t.scale, t.offsetY + 20 * t.scale);
    expect(ax).toBeCloseTo(10, 9);
    expect(ay).toBeCloseTo(20, 9);
    const design = analysisToDesign(300, 200, 123, 45);
    const back = designToAnalysis(300, 200, design);
    expect(back[0]).toBeCloseTo(123, 9);
    expect(back[1]).toBeCloseTo(45, 9);
  });
});

describe("structure editor hit-testing", () => {
  it("selects the nearest structure and rejects empty space", () => {
    const analysis = analyzeImage(simpleSilhouette(200), { detail: "MEDIUM", structure: "OUTLINE" });
    const design = designFromAnalysis(analysis);
    const t = letterbox(268, 200, analysis.diagnostics.analysisWidth, analysis.diagnostics.analysisHeight);
    const tolerance = toleranceInDesignUnits(t, 6);
    const primitive = design.primitives[0]!;
    const onPath = (primitive as { path: readonly DesignPoint[] }).path[0]!;
    expect(hitTestDesign(design, onPath, tolerance)).toBe(primitive.id);
    expect(hitTestDesign(design, [10, 10], tolerance)).toBeNull();
    // Deterministic: repeated calls agree.
    expect(hitTestDesign(design, onPath, tolerance)).toBe(primitive.id);
  });
});

describe("exact-N after structure edits", () => {
  it("compiles the requested count after disable, delete, polyline and priority edits", () => {
    const design = extractedDesign();
    const disabled = setPrimitiveEnabled(design, design.primitives[design.primitives.length - 1]!.id, false);
    const deleted = deletePrimitive(disabled, disabled.primitives[1]!.id);
    const prioritised = setPrimitiveImportance(deleted, deleted.primitives[0]!.id, "ESSENTIAL");
    const edited = addPolyline(prioritised, [
      [-0.2, -0.1],
      [0, 0],
      [0.2, 0.12],
    ]);
    for (const n of [80, 150, 200, 300]) {
      expect(compileVisualFormation(edited, n).points.length).toBe(n);
    }
    // The extracted design is unchanged and still compiles.
    expect(compileVisualFormation(design, 150).points.length).toBe(150);
  });
});
