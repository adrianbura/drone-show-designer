import { describe, expect, it } from "vitest";

import { analyzeSequence } from "../report";
import { rigidFitCentered, applyMatrix } from "../rigid";
import { detectPeriodicity } from "../periodicity";
import { BALANCED_THRESHOLDS, FORENSICS_PRESETS } from "../types";
import {
  landingFixture,
  localDeformationFixture,
  morphFixture,
  noisyRigidFixture,
  rigidMotionFixture,
  rotationFixture,
  scaleChangeFixture,
  staticFixture,
  takeoffFixture,
  translationFixture,
} from "./fixtures";

const dominant = (report: ReturnType<typeof analyzeSequence>) => {
  const byDuration = new Map<string, number>();
  for (const s of report.segments) {
    byDuration.set(s.classification, (byDuration.get(s.classification) ?? 0) + s.duration);
  }
  return [...byDuration.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "NONE";
};

describe("kabsch rigid fit", () => {
  it("recovers a known rotation with near-zero residual", () => {
    const deg = 37;
    const rad = (deg * Math.PI) / 180;
    const from: number[] = [];
    const to: number[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const p: [number, number, number] = [Math.cos(a) * 10, (i % 4) * 2 - 3, Math.sin(a) * 10];
      from.push(...p);
      to.push(
        p[0] * Math.cos(rad) - p[2] * Math.sin(rad),
        p[1],
        p[0] * Math.sin(rad) + p[2] * Math.cos(rad),
      );
    }
    const fit = rigidFitCentered(new Float64Array(from), new Float64Array(to));
    expect(fit.angleDeg).toBeCloseTo(deg, 3);
    expect(fit.rmsError).toBeLessThan(1e-8);
    expect(fit.scale).toBeCloseTo(1, 6);
    const mapped = applyMatrix(fit.rotation, [from[0]!, from[1]!, from[2]!]);
    expect(mapped[0]).toBeCloseTo(to[0]!, 6);
  });
});

describe("classification of synthetic motion", () => {
  it("classifies a frozen formation as static", () => {
    const r = analyzeSequence(staticFixture());
    expect(dominant(r)).toBe("STATIC_FORMATION");
    expect(r.motion.maxDeformationRmsMeters).toBeLessThan(1e-9);
  });

  it("classifies pure translation as global translation with ~zero deformation", () => {
    const r = analyzeSequence(translationFixture());
    expect(dominant(r)).toBe("GLOBAL_TRANSLATION");
    expect(r.motion.maxDeformationRmsMeters).toBeLessThan(1e-6);
  });

  it("classifies rigid rotation as global rotation, never deformation", () => {
    const r = analyzeSequence(rotationFixture());
    expect(dominant(r)).toBe("GLOBAL_ROTATION");
    expect(r.counts.DYNAMIC_DEFORMATION).toBe(0);
    expect(r.motion.maxDeformationRmsMeters).toBeLessThan(1e-6);
  });

  it("classifies translation plus rotation as rigid motion, not a transition", () => {
    const r = analyzeSequence(rigidMotionFixture());
    expect(dominant(r)).toBe("RIGID_MOTION");
    expect(r.counts.FORMATION_TRANSITION).toBe(0);
  });

  it("measures a global scale change without calling it rotation", () => {
    const r = analyzeSequence(scaleChangeFixture());
    const scales = r.segments.map((s) => s.metrics.meanScale);
    expect(Math.max(...scales)).toBeGreaterThan(1);
    expect(dominant(r)).not.toBe("GLOBAL_ROTATION");
  });

  it("classifies localized oscillation as dynamic deformation with ~30% active drones", () => {
    const r = analyzeSequence(localDeformationFixture());
    expect(dominant(r)).toBe("DYNAMIC_DEFORMATION");
    const seg = r.segments.find((s) => s.classification === "DYNAMIC_DEFORMATION")!;
    expect(seg.metrics.activeFraction).toBeGreaterThan(0.2);
    expect(seg.metrics.activeFraction).toBeLessThan(0.4);
    expect(seg.activeDroneIds.length).toBe(12);
    expect(seg.clusters.length).toBeGreaterThan(0);
  });

  it("detects periodic internal deformation near the fixture period", () => {
    const r = analyzeSequence(localDeformationFixture(16, 2));
    const seg = r.segments.find((s) => s.periodicity.periodic);
    expect(seg).toBeTruthy();
    expect(seg!.periodicity.estimatedPeriodSeconds).toBeGreaterThan(1);
    expect(seg!.periodicity.estimatedPeriodSeconds).toBeLessThan(3.5);
  });

  it("classifies a shape morph as a formation transition", () => {
    const r = analyzeSequence(morphFixture());
    expect(r.counts.FORMATION_TRANSITION).toBeGreaterThan(0);
    expect(dominant(r)).toBe("FORMATION_TRANSITION");
  });

  it("detects takeoff ascent", () => {
    const r = analyzeSequence(takeoffFixture());
    expect(r.takeoffInterval).toBeTruthy();
    expect(dominant(r)).toBe("TAKEOFF_ASCENT");
  });

  it("detects landing descent", () => {
    const r = analyzeSequence(landingFixture());
    expect(r.landingInterval).toBeTruthy();
    expect(dominant(r)).toBe("LANDING_DESCENT");
  });

  it("tolerates small positional noise on rigid motion", () => {
    const r = analyzeSequence(noisyRigidFixture());
    expect(["RIGID_MOTION", "GLOBAL_ROTATION"]).toContain(dominant(r));
    expect(r.counts.DYNAMIC_DEFORMATION).toBe(0);
  });
});

describe("periodicity primitive", () => {
  it("finds the dominant period of a sinusoid", () => {
    const step = 0.25;
    const series = Array.from({ length: 80 }, (_, i) => Math.sin((2 * Math.PI * i * step) / 2));
    const p = detectPeriodicity(series, step, 0.4);
    expect(p.periodic).toBe(true);
    expect(p.estimatedPeriodSeconds).toBeGreaterThan(1.5);
    expect(p.estimatedPeriodSeconds).toBeLessThan(2.5);
  });
});

describe("determinism and reporting", () => {
  it("produces identical segmentation for identical input and thresholds", () => {
    const seq = localDeformationFixture();
    const a = analyzeSequence(seq, { preset: "BALANCED" });
    const b = analyzeSequence(seq, { preset: "BALANCED" });
    expect(JSON.stringify(a.segments)).toBe(JSON.stringify(b.segments));
    expect(JSON.stringify(a.counts)).toBe(JSON.stringify(b.counts));
    expect(a.thresholds).toEqual(BALANCED_THRESHOLDS);
  });

  it("stores preset thresholds and holds in the report", () => {
    const r = analyzeSequence(staticFixture(12), { preset: "CONSERVATIVE" });
    expect(r.thresholds).toEqual(FORENSICS_PRESETS.CONSERVATIVE);
    expect(r.holds.length).toBeGreaterThan(0);
    expect(r.limitations.length).toBeGreaterThan(0);
    expect(r.algorithmVersion).toBe("0.1.0");
  });

  it("never mutates the analysed sequence", () => {
    const seq = rigidMotionFixture();
    const before = Array.from(seq.positions);
    analyzeSequence(seq);
    expect(Array.from(seq.positions)).toEqual(before);
  });
});
