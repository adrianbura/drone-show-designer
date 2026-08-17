import { describe, expect, it } from "vitest";

import {
  ESSP_HEADER,
  EsspParseError,
  bytesEqual,
  buildSyntheticEssp,
  encodeEssp,
  parseEssp,
} from "../codec";
import {
  DEFAULT_ESSP_AXIS_MAPPING,
  esspToStudio,
  esspUnitsToMeters,
  metersToEsspUnits,
} from "../coordinates";
import { inferLaunchGrid } from "../grid";
import { colorAt, rawPositionAt, referencePathPoints, sampleReferenceDrone } from "../playback";
import {
  buildReferenceShow,
  esspDroneId,
  numericSourceId,
  sortEsspFiles,
  verifyRoundTrip,
} from "../reference";
import { computeReferenceStatistics } from "../stats";

function syntheticFile(index: number, opts: { pad: [number, number]; frames?: number } ) {
  const frames = opts.frames ?? 8;
  const xyz = Array.from({ length: frames }, (_, f) => [
    opts.pad[0],
    opts.pad[1],
    f * 100,
  ]);
  const rgb = Array.from({ length: frames + 2 }, (_, f) => [f * 10, 20, 30]);
  return { name: `${index}.essp`, bytes: buildSyntheticEssp({ xyz, rgb }) };
}

describe("ESSP codec", () => {
  it("parses the observed 31-byte header layout", () => {
    const bytes = buildSyntheticEssp({ xyz: [[1, 2, 3]], rgb: [[4, 5, 6]] });
    const parsed = parseEssp(bytes);
    expect(ESSP_HEADER.size).toBe(31);
    expect(parsed.header.magic).toBe("ESS");
    expect(parsed.header.version).toBe(1);
    expect(parsed.header.positionRateRaw).toBe(8000);
    expect(parsed.header.positionRateHz).toBe(8);
    expect(parsed.header.rgbRateHz).toBe(12);
    expect(parsed.header.unknownU16).toBe(2);
    expect(parsed.header.opaqueProfileBytes.byteLength).toBe(13);
    expect(parsed.positionSampleCount).toBe(1);
    expect(parsed.rgbSampleCount).toBe(1);
    expect(Array.from(parsed.xyz)).toEqual([1, 2, 3]);
  });

  it("decodes negative int16 positions little-endian", () => {
    const parsed = parseEssp(buildSyntheticEssp({ xyz: [[-1234, 5678, -32768]], rgb: [[0, 0, 0]] }));
    expect(Array.from(parsed.xyz)).toEqual([-1234, 5678, -32768]);
  });

  it("round-trips byte for byte", () => {
    const bytes = buildSyntheticEssp({
      xyz: [[1, -2, 3], [400, 500, 600]],
      rgb: [[1, 2, 3], [255, 0, 128], [7, 7, 7]],
    });
    expect(bytesEqual(encodeEssp(parseEssp(bytes)), bytes)).toBe(true);
  });

  it("rejects malformed files with structured codes", () => {
    expect(() => parseEssp(new Uint8Array(4))).toThrowError(EsspParseError);
    const bad = buildSyntheticEssp({ xyz: [[0, 0, 0]], rgb: [[0, 0, 0]] });
    bad[0] = 0x41;
    expect(() => parseEssp(bad)).toThrowError(/magic/i);
    const trailing = new Uint8Array(bad.byteLength + 3);
    trailing.set(buildSyntheticEssp({ xyz: [[0, 0, 0]], rgb: [[0, 0, 0]] }));
    expect(() => parseEssp(trailing)).toThrowError(EsspParseError);
  });
});

describe("ESSP coordinates", () => {
  it("uses the 1 cm scale hypothesis in both directions", () => {
    expect(esspUnitsToMeters(210)).toBeCloseTo(2.1, 9);
    expect(metersToEsspUnits(2.1)).toBeCloseTo(210, 6);
  });

  it("maps ESSP Z to studio altitude by default", () => {
    expect(esspToStudio([100, 200, 300], DEFAULT_ESSP_AXIS_MAPPING)).toEqual([1, 3, 2]);
  });
});

describe("ESSP identity and ordering", () => {
  it("derives IDs from numeric filenames and orders numerically", () => {
    expect(numericSourceId("12.essp")).toBe(12);
    expect(numericSourceId("nope.essp")).toBeNull();
    expect(esspDroneId(7)).toBe("ESSP-007");
    const order = sortEsspFiles(
      ["10.essp", "2.essp", "1.essp"].map((name) => ({ name, bytes: new Uint8Array() })),
    ).map((f) => f.name);
    expect(order).toEqual(["1.essp", "2.essp", "10.essp"]);
  });
});

describe("ESSP playback", () => {
  const drone = {
    ...parseEssp(
      buildSyntheticEssp({
        xyz: [[0, 0, 0], [100, 0, 0], [200, 0, 0]],
        rgb: [[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]],
      }),
    ),
  };
  const ref = {
    sourceId: "ESSP-001",
    numericSourceId: 1,
    sourceFile: "1.essp",
    fileSize: 0,
    positionSamples: drone.xyz,
    rgbSamples: drone.rgb,
    positionSampleCount: drone.positionSampleCount,
    rgbSampleCount: drone.rgbSampleCount,
    launchPosition: [0, 0, 0] as const,
    header: drone.header,
  };

  it("returns exact samples at exact sample times", () => {
    expect(rawPositionAt(ref, 1 / 8, 8)[0]).toBeCloseTo(100, 9);
    expect(rawPositionAt(ref, 2 / 8, 8)[0]).toBeCloseTo(200, 9);
  });

  it("interpolates positions linearly between samples", () => {
    expect(rawPositionAt(ref, 0.5 / 8, 8)[0]).toBeCloseTo(50, 9);
  });

  it("holds colours (never blends) on the independent 12 Hz clock", () => {
    expect(colorAt(ref, 0, 12)).toEqual([10, 0, 0]);
    expect(colorAt(ref, 0.99 / 12, 12)).toEqual([10, 0, 0]);
    expect(colorAt(ref, 1 / 12, 12)).toEqual([20, 0, 0]);
  });

  it("clamps outside the sampled range and reports indices", () => {
    const s = sampleReferenceDrone(ref, 999, { positionRateHz: 8, rgbRateHz: 12 });
    expect(s.positionSampleIndex).toBe(2);
    expect(s.rgbSampleIndex).toBe(3);
    expect(sampleReferenceDrone(ref, -5, { positionRateHz: 8, rgbRateHz: 12 }).positionSampleIndex).toBe(0);
    expect(referencePathPoints(ref).length).toBe(3);
  });
});

describe("ESSP reference show assembly", () => {
  const files = [
    syntheticFile(1, { pad: [0, 0] }),
    syntheticFile(2, { pad: [210, 0] }),
    syntheticFile(3, { pad: [0, 210] }),
    syntheticFile(4, { pad: [210, 210] }),
  ];

  it("builds an immutable read-only reference show with a report", async () => {
    const show = await buildReferenceShow(files);
    expect(show.mode).toBe("REFERENCE_IMPORTED_TRAJECTORY");
    expect(show.drones.map((d) => d.sourceId)).toEqual([
      "ESSP-001",
      "ESSP-002",
      "ESSP-003",
      "ESSP-004",
    ]);
    expect(show.report.validFiles).toBe(4);
    expect(show.report.launchGrid.inferredGrid).toBe("2 x 2");
    expect(show.report.launchGrid.xSpacingRaw).toBe(210);
    expect(show.report.invariants.identicalPositionRate).toBe(true);
    expect(show.report.invariants.xyzPayloadsDiffer).toBe(true);
    expect(show.report.unknownFieldsPreserved).toBe(true);
    expect(show.report.experimental).toMatch(/EXPERIMENTAL/);
    expect(show.timing.positionDurationSeconds).toBeCloseTo(7 / 8, 9);
    expect(show.timing.rgbDurationSeconds).toBeCloseTo(9 / 12, 9);
  });

  it("keeps going when one file is corrupt", async () => {
    const broken = { name: "5.essp", bytes: new Uint8Array([1, 2, 3]) };
    const show = await buildReferenceShow([...files, broken]);
    expect(show.report.validFiles).toBe(4);
    expect(show.report.invalidFiles).toBe(1);
    expect(show.report.diagnostics.find((d) => d.fileName === "5.essp")?.ok).toBe(false);
  });

  it("verifies round-trip integrity across the selection", async () => {
    const result = await verifyRoundTrip(files);
    expect(result.filesTested).toBe(4);
    expect(result.bytePerfect).toBe(4);
    expect(result.failures).toEqual([]);
  });

  it("measures the imported data without rejecting it", async () => {
    const show = await buildReferenceShow(files);
    const stats = computeReferenceStatistics(show.drones, show.timing.positionRateHz);
    expect(stats.maxAltitudeMeters).toBeCloseTo(7, 6);
    expect(stats.minPairwiseDistanceMeters).toBeCloseTo(2.1, 6);
    expect(stats.maxSampledSpeedMps).toBeCloseTo(8, 6);
    expect(stats.sampledPositionCount).toBe(32);
  });

  it("reports a non-regular launch layout instead of forcing a grid", () => {
    const grid = inferLaunchGrid([
      [0, 0, 0],
      [37, 11, 0],
      [500, 900, 0],
    ]);
    expect(grid.regular).toBe(false);
  });
});
