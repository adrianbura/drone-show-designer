/**
 * Sprint 6B.5 — reference segment -> editable dynamic formation.
 *
 * Every fidelity assertion reconstructs through the PUBLIC native sampler.
 */
import { describe, expect, it } from "vitest";

import { sequenceFromFrames } from "../../forensics/adapter";
import type { PointCloudSequence, ReferenceSceneSegment } from "../../forensics/types";
import { sampleDynamicFormation } from "../../../../show/dynamic/sampler";
import { validateDynamicFormation } from "../../../../show/dynamic/validate";
import { DEFAULT_LIMITS } from "../../../../show/defaultProject";
import {
  baseShape,
  localDeformationFixture,
  rotationFixture,
  translationFixture,
  type P,
} from "../../forensics/__tests__/fixtures";
import {
  convertSequenceSegment,
  dynamicFormationSignature,
  evaluateDynamicFormationFidelity,
  conversionPointId,
  comparisonFrameAt,
  decomposeSegment,
  segmentWindow,
  quatFromMatrix,
  eulerDegFromQuat,
  REFERENCE_DYNAMIC_CONVERTER_VERSION,
  segmentEligibility,
} from "..";

const RATE = 8;

function segment(
  startTime: number,
  endTime: number,
  overrides: Partial<ReferenceSceneSegment> = {},
): ReferenceSceneSegment {
  return {
    id: "seg-07",
    label: "Dynamic deformation 07",
    startTime,
    endTime,
    duration: endTime - startTime,
    classification: "DYNAMIC_DEFORMATION",
    confidence: 0.8,
    metrics: {
      centroidTravelMeters: 0,
      meanCentroidSpeedMps: 0,
      maxRotationDeg: 0,
      totalRotationDeg: 0,
      meanScale: 1,
      rigidRmsMeters: 0,
      deformationRmsMeters: 0,
      maxDeformationMeters: 0,
      medianDeformationMeters: 0,
      netShapeChangeMeters: 0,
      activeFraction: 0,
      meanAltitudeMeters: 40,
      altitudeChangeMeters: 0,
      lightingChangeEnergy: 0,
    },
    periodicity: { periodic: false, estimatedPeriodSeconds: null, confidence: 0 },
    activeDroneIds: [],
    clusters: [],
    inferred: true,
    ...overrides,
  };
}

function convert(sequence: PointCloudSequence, seg: ReferenceSceneSegment, options = {}) {
  return convertSequenceSegment(sequence, seg, "deadbeef", sequence.rateHz, options);
}

function sourceWorld(sequence: PointCloudSequence, seg: ReferenceSceneSegment): Float64Array {
  const window = segmentWindow(sequence, seg.startTime, seg.endTime);
  return decomposeSegment(sequence, window, {
    referenceFrame: "SEGMENT_START",
    referenceTime: null,
    rotationFit: "KABSCH",
  }).world;
}

/** Global translation + global rotation + a local wing deformation at once. */
function globalPlusLocalFixture(seconds = 4): PointCloudSequence {
  const shape = baseShape(40);
  const frames = Math.round(seconds * RATE);
  const out: P[][] = [];
  for (let s = 0; s < frames; s++) {
    const t = s / RATE;
    const rad = (t * 25 * Math.PI) / 180;
    const phase = Math.sin((2 * Math.PI * t) / 2);
    out.push(
      shape.map((p, i) => {
        const local: P = i < 12 ? [p[0], p[1] + phase * 5, p[2]] : [...p];
        const dx = local[0];
        const dz = local[2];
        return [
          dx * Math.cos(rad) - dz * Math.sin(rad) + t * 3,
          local[1] + t * 0.5,
          dx * Math.sin(rad) + dz * Math.cos(rad),
        ] as P;
      }),
    );
  }
  return sequenceFromFrames(out, RATE);
}

describe("reference segment conversion — decomposition", () => {
  it("extracts pure translation with (near) zero deformation", () => {
    const seq = translationFixture(4, 4);
    const proposal = convert(seq, segment(0, 3, { classification: "GLOBAL_TRANSLATION" }));
    const maxDeform = Math.max(...proposal.extractedDeformationTracks.map((t) => t.maxMagnitude));
    expect(maxDeform).toBeLessThan(1e-6);
    const last = proposal.extractedGlobalTransformTrack.at(-1)!;
    expect(last.translation[0]).toBeCloseTo(last.t * 4, 6);
    expect(proposal.fidelityReport.maxErrorMeters).toBeLessThan(1e-6);
  });

  it("extracts pure rotation with (near) zero deformation", () => {
    const seq = rotationFixture(4, 30);
    const proposal = convert(seq, segment(0, 3, { classification: "GLOBAL_ROTATION" }));
    const maxDeform = Math.max(...proposal.extractedDeformationTracks.map((t) => t.maxMagnitude));
    expect(maxDeform).toBeLessThan(1e-6);
    const last = proposal.extractedGlobalTransformTrack.at(-1)!;
    // 30 deg/s about the up axis.
    expect(Math.abs(last.rotationEulerDeg[1])).toBeCloseTo(last.t * 30, 3);
    expect(proposal.fidelityReport.maxErrorMeters).toBeLessThan(1e-6);
  });

  it("extracts translation and rotation together with low residual", () => {
    const seq = globalPlusLocalFixture(3);
    const proposal = convert(seq, segment(0, 2.5));
    const t = proposal.extractedGlobalTransformTrack.at(-1)!;
    expect(Math.hypot(t.translation[0], t.translation[2])).toBeGreaterThan(1);
    expect(Math.abs(t.rotationEulerDeg[1])).toBeGreaterThan(5);
    expect(proposal.fidelityReport.rmsErrorMeters).toBeLessThan(1e-6);
  });

  it("captures local deformation while the stable body stays near zero", () => {
    const seq = localDeformationFixture(4, 2);
    const proposal = convert(seq, segment(0, 3), { rotationFit: "ROBUST" });
    const tracks = proposal.extractedDeformationTracks;
    const wing = tracks.slice(0, 12);
    const body = tracks.slice(20);
    expect(Math.min(...wing.map((t) => t.maxMagnitude))).toBeGreaterThan(1);
    expect(Math.max(...body.map((t) => t.maxMagnitude))).toBeLessThan(0.05);
    expect(proposal.fidelityReport.maxErrorMeters).toBeLessThan(1e-6);
  });

  it("recovers global translation, global rotation and local deformation at once", () => {
    const seq = globalPlusLocalFixture(4);
    const proposal = convert(seq, segment(0, 3.5));
    expect(proposal.fidelityReport.maxErrorMeters).toBeLessThan(1e-6);
    expect(
      Math.max(...proposal.extractedDeformationTracks.slice(0, 12).map((t) => t.maxMagnitude)),
    ).toBeGreaterThan(1);
  });

  it("keeps quaternion sign continuity through a long rotation", () => {
    const seq = rotationFixture(8, 90);
    const proposal = convert(seq, segment(0, 7, { classification: "GLOBAL_ROTATION" }));
    const track = proposal.extractedGlobalTransformTrack;
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1]!.quaternion;
      const b = track[i]!.quaternion;
      expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]).toBeGreaterThanOrEqual(0);
    }
  });

  it("round-trips a rotation matrix through the native euler representation", () => {
    const seq = rotationFixture(4, 45);
    const window = segmentWindow(seq, 0, 3);
    const d = decomposeSegment(seq, window, {
      referenceFrame: "SEGMENT_START",
      referenceTime: null,
      rotationFit: "KABSCH",
    });
    const euler = eulerDegFromQuat(quatFromMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    expect(Math.hypot(...euler)).toBeLessThan(1e-9);
    // Local reconstruction must reproduce the world sample.
    const sampled = sampleDynamicFormation(
      convert(seq, segment(0, 3)).formation,
      d.localTimes[3]!,
    );
    for (let i = 0; i < d.droneCount; i++) {
      const o = 3 * d.droneCount * 3 + i * 3;
      expect(sampled[i]![0]).toBeCloseTo(d.world[o]!, 9);
      expect(sampled[i]![1]).toBeCloseTo(d.world[o + 1]!, 9);
      expect(sampled[i]![2]).toBeCloseTo(d.world[o + 2]!, 9);
    }
  });
});

describe("reference segment conversion — contracts", () => {
  it("preserves exact N and stable point identity for 10, 50, 150 and 200 drones", () => {
    for (const n of [10, 50, 150, 200]) {
      const shape = baseShape(n, 25, 40);
      const frames = Array.from({ length: 9 }, (_, s) =>
        shape.map((p) => [p[0] + s * 0.5, p[1], p[2]] as P),
      );
      const seq = sequenceFromFrames(frames, RATE);
      const proposal = convert(seq, segment(0, 1, { classification: "RIGID_MOTION" }));
      expect(proposal.formation.points).toHaveLength(n);
      expect(proposal.formation.points[0]!.id).toBe(conversionPointId(0));
      expect(proposal.formation.points.at(-1)!.id).toBe(conversionPointId(n - 1));
      expect(sampleDynamicFormation(proposal.formation, 0.5)).toHaveLength(n);
      expect(proposal.provenance.sourceDroneIds).toHaveLength(n);
    }
  });

  it("maps source drone identity onto stable point ids deterministically", () => {
    const seq = localDeformationFixture(3, 2);
    const proposal = convert(seq, segment(0, 2));
    proposal.extractedDeformationTracks.forEach((track, i) => {
      expect(track.pointId).toBe(conversionPointId(i));
      expect(track.sourceDroneId).toBe(seq.droneIds[i]);
    });
  });

  it("is deterministic for identical source and options", () => {
    const seq = globalPlusLocalFixture(3);
    const a = convert(seq, segment(0, 2.5), { mode: "SIMPLIFIED", toleranceMeters: 0.05 });
    const b = convert(seq, segment(0, 2.5), { mode: "SIMPLIFIED", toleranceMeters: 0.05 });
    expect(dynamicFormationSignature(a.formation)).toBe(dynamicFormationSignature(b.formation));
    expect(a.keyframes).toEqual(b.keyframes);
    expect(a.fidelityReport).toEqual(b.fidelityReport);
  });

  it("does not mutate the source sequence", () => {
    const seq = localDeformationFixture(3, 2);
    const positions = Float64Array.from(seq.positions);
    const times = Float64Array.from(seq.times);
    const ids = [...seq.droneIds];
    const seg = segment(0, 2);
    const frozen = JSON.stringify(seg);
    convert(seq, seg, { mode: "SIMPLIFIED", toleranceMeters: 0.02 });
    expect(seq.positions).toEqual(positions);
    expect(seq.times).toEqual(times);
    expect(seq.droneIds).toEqual(ids);
    expect(JSON.stringify(seg)).toBe(frozen);
  });

  it("reports segment eligibility without blocking experimental classes", () => {
    expect(segmentEligibility("DYNAMIC_DEFORMATION")).toBe("SUPPORTED");
    expect(segmentEligibility("FORMATION_TRANSITION")).toBe("EXPERIMENTAL");
    expect(segmentEligibility("TAKEOFF_ASCENT")).toBe("UNSUPPORTED");
    const seq = translationFixture(3, 2);
    const proposal = convert(seq, segment(0, 2, { classification: "TAKEOFF_ASCENT" }));
    expect(proposal.eligibility).toBe("UNSUPPORTED");
    expect(proposal.warnings.length).toBeGreaterThan(0);
  });
});

describe("reference segment conversion — modes and fidelity", () => {
  it("EXACT_SAMPLED reconstructs to floating-point tolerance", () => {
    const seq = globalPlusLocalFixture(4);
    const proposal = convert(seq, segment(0, 3.5), { mode: "EXACT_SAMPLED" });
    expect(proposal.fidelityReport.maxErrorMeters).toBeLessThan(1e-8);
    expect(proposal.fidelityReport.status).toBe("EXCELLENT");
    expect(proposal.keyframes.totalKeyframes).toBe(proposal.keyframes.exactTotalKeyframes);
    expect(proposal.keyframes.reduction).toBe(0);
  });

  it("SIMPLIFIED reduces keyframes while respecting the tolerance", () => {
    const seq = translationFixture(6, 4);
    const proposal = convert(seq, segment(0, 5), {
      mode: "SIMPLIFIED",
      toleranceMeters: 0.05,
      classification: undefined,
    } as never);
    expect(proposal.keyframes.totalKeyframes).toBeLessThan(proposal.keyframes.exactTotalKeyframes);
    expect(proposal.keyframes.reduction).toBeGreaterThan(0.3);
    expect(proposal.fidelityReport.maxErrorMeters).toBeLessThanOrEqual(0.05);
  });

  it("SIMPLIFIED retains keyframes across a short high-curvature event", () => {
    const shape = baseShape(30);
    const frames = Array.from({ length: 41 }, (_, s) => {
      const t = s / RATE;
      // Flat, then a sharp 1 s jolt, then flat again.
      const jolt = t > 2 && t < 3 ? Math.sin((t - 2) * Math.PI * 4) * 6 : 0;
      return shape.map((p) => [p[0], p[1] + jolt, p[2]] as P);
    });
    const seq = sequenceFromFrames(frames, RATE);
    const smooth = convert(seq, segment(0, 2, { classification: "STATIC_FORMATION" }), {
      mode: "SIMPLIFIED",
      toleranceMeters: 0.05,
    });
    const jolted = convert(seq, segment(0, 5), { mode: "SIMPLIFIED", toleranceMeters: 0.05 });
    expect(jolted.keyframes.totalKeyframes).toBeGreaterThan(smooth.keyframes.totalKeyframes);
    expect(jolted.fidelityReport.maxErrorMeters).toBeLessThanOrEqual(0.05);
  });

  it("reports mean, median, rms, p95, p99, max and the worst drone/time", () => {
    const seq = globalPlusLocalFixture(3);
    const proposal = convert(seq, segment(0, 2.5), { mode: "SIMPLIFIED", toleranceMeters: 0.05 });
    const r = proposal.fidelityReport;
    expect(r.totalComparedPositions).toBe(r.droneCount * r.sourceSampleCount);
    expect(r.meanErrorMeters).toBeLessThanOrEqual(r.maxErrorMeters);
    expect(r.p95ErrorMeters).toBeLessThanOrEqual(r.p99ErrorMeters);
    expect(r.p99ErrorMeters).toBeLessThanOrEqual(r.maxErrorMeters);
    expect(seq.droneIds).toContain(r.maxErrorDroneId);
    expect(r.perDroneRmsError).toHaveLength(r.droneCount);
    expect(r.perFrameRmsError).toHaveLength(r.sourceSampleCount);
    expect(r.algorithmVersion).toBe(REFERENCE_DYNAMIC_CONVERTER_VERSION);
  });

  it("reports the loop candidate honestly for periodic and non-periodic motion", () => {
    const periodic = localDeformationFixture(6, 2);
    // Exactly two full 2 s periods: start and end geometry match.
    const loopProposal = convert(periodic, segment(0, 4), { rotationFit: "ROBUST" });
    expect(loopProposal.loop.loopClosureRms).toBeLessThan(0.5);
    expect(loopProposal.loop.loopCandidate).toBe(true);

    const nonLoop = convert(periodic, segment(0, 0.5), { rotationFit: "ROBUST" });
    expect(nonLoop.loop.loopClosureRms).toBeGreaterThan(0.5);
    expect(nonLoop.loop.loopCandidate).toBe(false);
  });

  it("suggests generic motion groups from forensic clusters and a stable core", () => {
    const seq = localDeformationFixture(4, 2);
    const wingIds = seq.droneIds.slice(0, 12);
    const proposal = convert(
      seq,
      segment(0, 3, {
        clusters: [{ id: "c1", droneIds: wingIds, meanResidualMeters: 3 }],
        activeDroneIds: wingIds,
      }),
      { rotationFit: "ROBUST" },
    );
    const cluster = proposal.suggestedMotionGroups.find((g) => g.kind === "CLUSTER");
    expect(cluster?.id).toBe("REFERENCE_CLUSTER_1");
    expect(cluster?.pointIds).toHaveLength(12);
    expect(proposal.suggestedMotionGroups.some((g) => g.id === "REFERENCE_STABLE_CORE")).toBe(true);
    // Suggestions are membership only: disabled, so geometry is untouched.
    const suggestionGroups = proposal.formation.groups.filter((g) => !g.enabled);
    expect(suggestionGroups.length).toBe(proposal.suggestedMotionGroups.length);
    expect(proposal.fidelityReport.maxErrorMeters).toBeLessThan(1e-8);
    expect(proposal.provenance.activeSourceDroneIds).toEqual(wingIds);
  });

  it("marks fidelity stale once the converted formation is edited", () => {
    const seq = globalPlusLocalFixture(3);
    const proposal = convert(seq, segment(0, 2.5));
    const before = dynamicFormationSignature(proposal.formation);
    const edited = {
      ...proposal.formation,
      transform: proposal.formation.transform.map((k, i) =>
        i === 1 ? { ...k, translation: [k.translation[0] + 3, k.translation[1], k.translation[2]] as [number, number, number] } : k,
      ),
    };
    expect(dynamicFormationSignature(edited)).not.toBe(before);
    const recomputed = evaluateDynamicFormationFidelity(
      {
        segmentId: proposal.sourceSegmentId,
        droneIds: proposal.provenance.sourceDroneIds,
        droneCount: proposal.droneCount,
        sampleCount: proposal.sourceTimes.length,
        times: proposal.sourceTimes,
        positions: sourceWorld(seq, segment(0, 2.5)),
        duration: proposal.formation.duration,
      },
      edited,
    );
    expect(recomputed.maxErrorMeters).toBeGreaterThan(0.5);
  });

  it("produces overlay comparison data at the exact source timestamp", () => {
    const seq = localDeformationFixture(3, 2);
    const seg = segment(0, 2);
    const proposal = convert(seq, seg);
    const frame = comparisonFrameAt(proposal, sourceWorld(seq, seg), 1.02);
    expect(frame.time).toBeCloseTo(1, 6);
    expect(frame.original).toHaveLength(proposal.droneCount);
    expect(frame.reconstructed).toHaveLength(proposal.droneCount);
    expect(frame.maxError).toBeLessThan(1e-8);
  });

  it("runs native design-time validation on the converted formation", () => {
    const seq = globalPlusLocalFixture(4);
    const proposal = convert(seq, segment(0, 3.5));
    const report = validateDynamicFormation(proposal.formation, {
      limits: DEFAULT_LIMITS,
      expectedPointCount: proposal.droneCount,
    });
    expect(report.metrics.pointCount).toBe(proposal.droneCount);
    expect(["ok", "warning", "error"]).toContain(report.status);
  });
});
