import { describe, expect, it } from "vitest";
import { analyzeGeometryProposalConsequences } from "../diagnostics/geometryConsequencePreflight";
import type { SafetyLimits, ShowArea, Vector3Tuple } from "../types";

const area: ShowArea = { width: 100, depth: 100, height: 120 };
const limits: SafetyLimits = {
  maxVelocity: 10,
  maxAcceleration: 5,
  maxJerk: 10,
  maxYawRate: 90,
  minSeparation: 2,
  minAltitude: 1,
  maxAltitude: 100,
};
const p = (x: number, y: number, z: number): Vector3Tuple => [x, y, z];

describe("geometry proposal consequence preflight", () => {
  it("passes unchanged valid geometry", () => {
    const pts = [p(-10, 20, 0), p(10, 20, 0)];
    const r = analyzeGeometryProposalConsequences({ before: pts, after: pts, area, limits });
    expect(r.staticEnvelopePass).toBe(true);
    expect(r.after.minPairSeparation3D).toBe(20);
  });

  it("detects a newly introduced area violation", () => {
    const r = analyzeGeometryProposalConsequences({
      before: [p(0, 20, 0)],
      after: [p(60, 20, 0)],
      area,
      limits,
    });
    expect(r.introducesAreaViolation).toBe(true);
    expect(r.staticEnvelopePass).toBe(false);
  });

  it("detects newly introduced altitude violations", () => {
    const r = analyzeGeometryProposalConsequences({
      before: [p(0, 20, 0), p(5, 30, 0)],
      after: [p(0, -1, 0), p(5, 101, 0)],
      area,
      limits,
    });
    expect(r.introducesAltitudeViolation).toBe(true);
  });

  it("detects newly introduced static pair-separation violations", () => {
    const r = analyzeGeometryProposalConsequences({
      before: [p(0, 20, 0), p(5, 20, 0)],
      after: [p(0, 20, 0), p(1, 20, 0)],
      area,
      limits,
    });
    expect(r.before.pairSeparationViolationCount).toBe(0);
    expect(r.after.pairSeparationViolationCount).toBe(1);
    expect(r.introducesPairSeparationViolation).toBe(true);
  });

  it("does not claim a new violation when the proposal improves an existing one", () => {
    const r = analyzeGeometryProposalConsequences({
      before: [p(0, 20, 0), p(1, 20, 0)],
      after: [p(0, 20, 0), p(3, 20, 0)],
      area,
      limits,
    });
    expect(r.introducesPairSeparationViolation).toBe(false);
    expect(r.staticEnvelopePass).toBe(true);
  });

  it("fails when point counts differ and never mutates input", () => {
    const before = [p(0, 20, 0), p(10, 20, 0)];
    const after = [p(0, 20, 0)];
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);
    const r = analyzeGeometryProposalConsequences({ before, after, area, limits });
    expect(r.pointCountMatches).toBe(false);
    expect(r.staticEnvelopePass).toBe(false);
    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(JSON.stringify(after)).toBe(afterJson);
  });
});
