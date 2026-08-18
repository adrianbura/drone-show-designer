import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createDemoProject } from "../../defaultProject";
import { buildShowPlan, sampleTrajectorySet } from "../../trajectory";
import { validateShow } from "../../safety";
import { showDuration, type ShowProject, type TimelineClip } from "../../types";
import { allocateLargestRemainder, isInsideRegion, spacingStats } from "../distribute";
import {
  generateSvgFormationPoints,
  makeSvgFormation,
  regenerateSvgFormation,
  resolveSvgParams,
  withPlacementWarnings,
} from "../formation";
import { parseSvg } from "../parser";
import { parsePathData } from "../paths";
import { planeTransform, toPlane } from "../normalize";
import { SvgError, type SvgAsset, type SvgGeometry, type SvgSamplingMode } from "../types";

const FIXTURES = join(__dirname, "..", "__fixtures__");
const load = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const parse = (name: string) => parseSvg(load(name), { fileName: name });
const asset = (name: string): SvgAsset => {
  const geometry = parse(name);
  return { id: `a-${name}`, name, fileName: name, geometry };
};

describe("svg parser", () => {
  it("parses a rectangle into a closed filled contour", () => {
    const g = parse("simple-square.svg");
    expect(g.contours).toHaveLength(1);
    expect(g.contours[0]!.closed).toBe(true);
    expect(g.contours[0]!.filled).toBe(true);
    expect(g.bounds.width).toBeCloseTo(80, 3);
    expect(g.bounds.height).toBeCloseTo(80, 3);
  });

  it("parses a circle with correct bounds", () => {
    const g = parse("circle.svg");
    expect(g.bounds.width).toBeCloseTo(160, 0);
    expect(g.bounds.height).toBeCloseTo(160, 0);
    expect(g.closedRegions).toHaveLength(1);
  });

  it("parses polygons, polylines and multiple contours", () => {
    const g = parse("multi-contour.svg");
    expect(g.contours.length).toBe(4);
    const open = g.contours.filter((c) => !c.closed);
    expect(open.length).toBe(1); // the polyline
  });

  it("supports curves (C/S/Q/T/H/V/Z)", () => {
    const g = parse("curves.svg");
    expect(g.contours.length).toBe(3);
    // Adaptive flattening must produce many vertices for the long cubic.
    expect(g.contours[0]!.points.length).toBeGreaterThan(20);
  });

  it("applies nested transforms and viewBox normalization", () => {
    const g = parse("nested-transform.svg");
    // rect 10x10 scaled by 2 => 20x20, rotate(90) about (5,5) local.
    expect(g.bounds.width).toBeCloseTo(20, 3);
    expect(g.bounds.height).toBeCloseTo(20, 3);
    expect(g.sourceMetadata.viewBox?.width).toBe(200);
  });

  it("normalizes the viewBox origin offset", () => {
    const g = parseSvg('<svg viewBox="100 100 200 200"><rect x="100" y="100" width="50" height="50" fill="#000"/></svg>');
    expect(g.bounds.minX).toBeCloseTo(0, 6);
    expect(g.bounds.minY).toBeCloseTo(0, 6);
  });

  it("rejects invalid input with a structured error", () => {
    expect(() => parseSvg("not an svg at all")).toThrowError(SvgError);
    try {
      parseSvg("<html><body>nope</body></html>");
    } catch (e) {
      expect((e as SvgError).code).toBe("INVALID_SVG");
    }
  });

  it("rejects an SVG with no visible geometry", () => {
    try {
      parseSvg('<svg viewBox="0 0 10 10"><rect x="1" y="1" width="2" height="2" fill="none"/></svg>');
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SvgError).code).toBe("NO_VISIBLE_GEOMETRY");
    }
  });

  it("warns about live text, raster images, masks and strips active content", () => {
    const g = parse("invalid-or-unsupported.svg");
    const codes = g.warnings.map((w) => w.code);
    expect(codes).toContain("LIVE_TEXT_PRESENT");
    expect(codes).toContain("RASTER_IMAGE_PRESENT");
    expect(codes).toContain("MASK_UNSUPPORTED");
    expect(codes).toContain("ACTIVE_CONTENT_STRIPPED");
    // The <script> body is never retained as geometry.
    expect(g.contours.every((c) => c.source !== "script")).toBe(true);
  });

  it("parses all path commands including arcs", () => {
    const subs = parsePathData("M10 10 H 40 V 40 L 10 40 Z M50 50 A 20 20 0 1 0 90 50 C 95 55 95 65 90 70 Q 80 80 70 70 T 50 60 Z");
    expect(subs).toHaveLength(2);
    expect(subs[0]!.closed).toBe(true);
    expect(subs[1]!.segments.some((s) => s.t === "C")).toBe(true);
  });
});

describe("allocation", () => {
  it("preserves the exact total with largest remainder", () => {
    const counts = allocateLargestRemainder([42.4, 31.2, 26.4], 100, 0);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(counts[0]!).toBeGreaterThan(counts[1]!);
    expect(counts[1]!).toBeGreaterThan(counts[2]!);
  });

  it("honours a minimum per contour while keeping the total", () => {
    const counts = allocateLargestRemainder([1000, 1, 1], 20, 2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(20);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(2);
  });
});

const TARGETS = [10, 50, 100, 200];

describe("exact N", () => {
  const cases: { file: string; mode: SvgSamplingMode }[] = [
    { file: "simple-square.svg", mode: "outline" },
    { file: "simple-square.svg", mode: "fill" },
    { file: "circle.svg", mode: "outline" },
    { file: "circle.svg", mode: "fill" },
    { file: "multi-contour.svg", mode: "outline" },
    { file: "donut-evenodd.svg", mode: "fill" },
    { file: "curves.svg", mode: "outline" },
  ];

  for (const { file, mode } of cases) {
    for (const target of TARGETS) {
      it(`${file} ${mode} -> exactly ${target} points`, () => {
        const g = parse(file);
        const result = generateSvgFormationPoints(g, resolveSvgParams(target, { mode, width: 90 }));
        expect(result.points).toHaveLength(target);
        expect(result.report.generatedCount).toBe(target);
        expect(result.report.targetCount).toBe(target);
      });
    }
  }

  it("rejects an invalid target count", () => {
    const g = parse("circle.svg");
    expect(() => generateSvgFormationPoints(g, resolveSvgParams(0))).toThrowError(SvgError);
    expect(() => generateSvgFormationPoints(g, resolveSvgParams(1.5))).toThrowError(SvgError);
  });

  it("still produces exact N for a complex logo with very few drones", () => {
    const g = parse("multi-contour.svg");
    const result = generateSvgFormationPoints(g, resolveSvgParams(10, { mode: "outline" }));
    expect(result.points).toHaveLength(10);
    expect(result.report.warnings.map((w) => w.code)).toContain("LOW_DRONE_COUNT_FOR_COMPLEX_LOGO");
  });

  it("drops contours deterministically when they outnumber the drones", () => {
    const g = parse("multi-contour.svg");
    const result = generateSvgFormationPoints(g, resolveSvgParams(3, { mode: "outline" }));
    expect(result.points).toHaveLength(3);
    expect(result.report.warnings.map((w) => w.code)).toContain("SMALL_CONTOUR_DROPPED");
  });
});

describe("determinism", () => {
  for (const mode of ["outline", "fill"] as SvgSamplingMode[]) {
    it(`${mode} generation is reproducible for the same seed`, () => {
      const g = parse("circle.svg");
      const params = resolveSvgParams(200, { mode, seed: 4242 });
      const a = generateSvgFormationPoints(g, params).points;
      const b = generateSvgFormationPoints(parse("circle.svg"), params).points;
      expect(a.length).toBe(b.length);
      a.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(b[i]![0], 9);
        expect(p[1]).toBeCloseTo(b[i]![1], 9);
        expect(p[2]).toBeCloseTo(b[i]![2], 9);
      });
    });
  }

  it("fill distribution reacts to the seed", () => {
    const g = parse("simple-square.svg");
    const a = generateSvgFormationPoints(g, resolveSvgParams(100, { mode: "fill", seed: 1 })).points;
    const b = generateSvgFormationPoints(g, resolveSvgParams(100, { mode: "fill", seed: 2 })).points;
    const identical = a.every((p, i) => Math.abs(p[0] - b[i]![0]) < 1e-9 && Math.abs(p[1] - b[i]![1]) < 1e-9);
    expect(identical).toBe(false);
  });
});

describe("transforms and placement", () => {
  const g = () => parse("simple-square.svg");

  it("preserves the aspect ratio and reports the size", () => {
    const t = planeTransform(g().bounds, resolveSvgParams(10, { width: 40, lockAspect: true }));
    expect(t.width).toBeCloseTo(40, 6);
    expect(t.height).toBeCloseTo(40, 6);
  });

  it("centres geometry around the origin in plane space", () => {
    const geo = g();
    const t = planeTransform(geo.bounds, resolveSvgParams(10, { width: 40 }));
    const pts = geo.contours[0]!.points.map((p) => toPlane(p, t));
    const xs = pts.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-20, 4);
    expect(Math.max(...xs)).toBeCloseTo(20, 4);
  });

  it("applies position, altitude and depth", () => {
    const result = generateSvgFormationPoints(
      g(),
      resolveSvgParams(50, { width: 40, positionX: 12, altitude: 60, depth: -7 }),
    );
    const ys = result.points.map((p) => p[1]);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(60, 3);
    expect(result.points.every((p) => Math.abs(p[2] - -7) < 1e-9)).toBe(true);
    const xs = result.points.map((p) => p[0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(12, 3);
  });

  it("rotates in the logo plane without touching depth", () => {
    const straight = generateSvgFormationPoints(g(), resolveSvgParams(40, { width: 40, rotation: 0 }));
    const turned = generateSvgFormationPoints(g(), resolveSvgParams(40, { width: 40, rotation: 45 }));
    const spanY = (r: typeof straight) =>
      Math.max(...r.points.map((p) => p[1])) - Math.min(...r.points.map((p) => p[1]));
    expect(spanY(turned)).toBeGreaterThan(spanY(straight) * 1.2);
    expect(turned.points.every((p) => p[2] === 0)).toBe(true);
  });

  it("flags formations that leave the show area or altitude envelope", () => {
    const project = createDemoProject(50);
    const big = generateSvgFormationPoints(
      parse("circle.svg"),
      resolveSvgParams(50, { width: project.area.width * 3, altitude: 400 }),
    );
    const codes = withPlacementWarnings(big, project).report.warnings.map((w) => w.code);
    expect(codes).toContain("SHOW_AREA_EXCEEDED");
    expect(codes).toContain("ALTITUDE_LIMIT_EXCEEDED");
  });
});

describe("distribution quality", () => {
  it("allocates outline points proportionally to contour length", () => {
    // Long rectangle: the long sides must hold clearly more drones than the short ones.
    const g = parseSvg(
      '<svg viewBox="0 0 400 100"><rect x="0" y="40" width="380" height="20" fill="none" stroke="#000"/></svg>',
    );
    const result = generateSvgFormationPoints(g, resolveSvgParams(100, { mode: "outline", width: 100 }));
    const xs = result.points.map((p) => p[0]);
    const nearTop = result.points.filter((p) => p[1] > 0).length;
    expect(result.points).toHaveLength(100);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 1);
    expect(nearTop).toBeGreaterThan(20);
  });

  it("keeps total count exact across a multi-contour logo", () => {
    const g = parse("multi-contour.svg");
    for (const target of TARGETS) {
      expect(
        generateSvgFormationPoints(g, resolveSvgParams(target, { mode: "outline" })).points,
      ).toHaveLength(target);
    }
  });

  it("produces no duplicate points for normal fixtures", () => {
    for (const file of ["simple-square.svg", "circle.svg", "multi-contour.svg", "curves.svg"]) {
      for (const mode of ["outline", "fill"] as SvgSamplingMode[]) {
        const g = parse(file);
        if (mode === "fill" && g.closedRegions.length === 0) continue;
        const result = generateSvgFormationPoints(g, resolveSvgParams(200, { mode, width: 100 }));
        expect(result.report.duplicatePoints).toBe(0);
        expect(result.report.minSpacing).toBeGreaterThan(0.05);
      }
    }
  });

  it("reports formation spacing metrics", () => {
    const result = generateSvgFormationPoints(
      parse("circle.svg"),
      resolveSvgParams(100, { mode: "outline", width: 100 }),
    );
    expect(result.report.avgNearestNeighborSpacing).toBeGreaterThan(result.report.minSpacing * 0.5);
    const stats = spacingStats(result.points);
    expect(stats.min).toBeCloseTo(result.report.minSpacing, 6);
  });
});

describe("holes", () => {
  it("keeps the hole of an even-odd donut empty", () => {
    const g = parse("donut-evenodd.svg");
    const params = resolveSvgParams(200, { mode: "fill", width: 100, altitude: 60 });
    const result = generateSvgFormationPoints(g, params);
    // Outer radius 50 m (width 100), inner hole radius ~22 m.
    const inHole = result.points.filter(
      (p) => Math.hypot(p[0], p[1] - 60) < 20,
    );
    expect(result.points).toHaveLength(200);
    expect(inHole).toHaveLength(0);
  });

  it("evaluates fill rules on raw polygons", () => {
    const outer = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as [number, number][];
    const inner = [
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
    ] as [number, number][];
    expect(isInsideRegion([outer, inner], 5, 5, "evenodd")).toBe(false);
    expect(isInsideRegion([outer, inner], 1, 1, "evenodd")).toBe(true);
    expect(isInsideRegion([outer], 5, 5, "nonzero")).toBe(true);
  });
});

describe("project integration", () => {
  it("runs the full pipeline: svg -> formation -> plan -> sampling -> safety", () => {
    const project = createDemoProject(50);
    const svgAsset = asset("circle.svg");
    const params = resolveSvgParams(project.droneCount, {
      mode: "outline",
      width: 70,
      altitude: 55,
    });
    const result = generateSvgFormationPoints(svgAsset.geometry, params);
    const formation = makeSvgFormation("f-svg", "Circle — Outline", svgAsset, result);

    expect(formation.kind).toBe("svg");
    expect(formation.points).toHaveLength(project.droneCount);
    expect(formation.svg?.svgAlgorithmVersion).toBe("0.1.0");
    expect(formation.svg?.sourceFileName).toBe("circle.svg");

    const lastClip = project.timeline[project.timeline.length - 1]!;
    const clip: TimelineClip = {
      ...lastClip,
      id: "c-svg",
      formationId: formation.id,
      start: lastClip.start,
      transition: 10,
      hold: 8,
      phase: "SHOW",
    };
    const withSvg: ShowProject = {
      ...project,
      formations: [...project.formations, formation],
      timeline: [
        ...project.timeline.slice(0, -1),
        clip,
        { ...lastClip, id: "c-land", start: clip.start + clip.transition + clip.hold },
      ],
    };

    const plan = buildShowPlan(withSvg);
    expect(plan.drones).toHaveLength(project.droneCount);
    const set = sampleTrajectorySet(plan, { sampleRate: 10 });
    expect(set.duration).toBeCloseTo(showDuration(withSvg), 3);
    const report = validateShow(withSvg, set, plan.drones);
    expect(report.issues).toBeInstanceOf(Array);
    expect(Number.isFinite(report.metrics.maxVelocity)).toBe(true);
  });

  it("regenerates exact N when the fleet size changes", () => {
    const svgAsset = asset("simple-square.svg");
    const base = makeSvgFormation(
      "f1",
      "Square",
      svgAsset,
      generateSvgFormationPoints(svgAsset.geometry, resolveSvgParams(50)),
    );
    for (const n of TARGETS) {
      expect(regenerateSvgFormation(base, svgAsset, n).points).toHaveLength(n);
    }
  });
});

describe("performance", () => {
  it("generates 200-drone formations interactively", () => {
    const files: { file: string; geometry: SvgGeometry }[] = ["simple-square.svg", "curves.svg"].map(
      (file) => ({ file, geometry: parse(file) }),
    );
    for (const { geometry } of files) {
      for (const target of TARGETS) {
        const t0 = performance.now();
        generateSvgFormationPoints(geometry, resolveSvgParams(target, { mode: "outline" }));
        expect(performance.now() - t0).toBeLessThan(1500);
      }
    }
  });
});
