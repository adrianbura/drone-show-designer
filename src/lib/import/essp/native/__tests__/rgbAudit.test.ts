import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { buildSyntheticEssp } from "../../codec";
import { buildReferenceShow } from "../../reference";
import { referenceDroneFileBytes } from "../layer";
import {
  auditRgbInterval,
  benchmarkRgbIntervals,
  readRgbAuditArchive,
  rgbAuditMarkdown,
  rgbAuditWindows,
} from "../rgbAudit";

const interval = { id: "test", start: 0, end: 1, origin: "WINDOW" as const };
async function fixture(color: (x: number, y: number, f: number) => number[]) {
  return buildReferenceShow(
    Array.from({ length: 25 }, (_, d) => {
      const x = (d % 5) - 2,
        y = Math.floor(d / 5) - 2;
      return {
        name: `${d + 1}.essp`,
        bytes: buildSyntheticEssp({
          xyz: Array.from({ length: 9 }, (_, f) => [100 * x + f * 15, 0, 3000 + y * 100]),
          rgb: Array.from({ length: 13 }, (_, f) => color(x, y, f)),
        }),
      };
    }),
  );
}
describe("read-only interval RGB audit", () => {
  it("distinguishes uniform from a native-clock linear gradient", async () => {
    const uniform = auditRgbInterval(await fixture((_x, _y, f) => [100 + f, 20, 10]), interval);
    expect(uniform.reasons.uniform).toBe(12);
    expect(uniform.channels.every((c) => c.meanFit === null)).toBe(true);
    const gradient = auditRgbInterval(
      await fixture((x, _y, f) => [100 + 20 * x + f, 20, 10]),
      interval,
    );
    expect(gradient.reasons.supportedSingleAxis).toBe(12);
    expect(gradient.channels[0]?.meanFit).toBeCloseTo(1, 10);
    expect(gradient.coverage.pairedSamples).toBe(300);
    expect(gradient.spatial.temporal.apparentSpeedMetersPerSecond).toBeCloseTo(0.6, 8);
  });
  it("exposes a weak nonlinear channel hidden by high aggregate fit", async () => {
    const result = auditRgbInterval(
      await fixture((x, y) => [100 + 40 * x, 10 + 2 * y * y, 10]),
      interval,
    );
    expect(result.spatial.coherence).toBeGreaterThan(0.99);
    expect(result.channels[1]?.meanFit).toBeCloseTo(0, 10);
    expect(result.channels[1]?.meanResidualByteSquared).toBeGreaterThan(0);
    expect(result.reasons.lowChannelFit).toBe(12);
    expect(result.spatial.direction).toBeNull();
  });
  it("distinguishes linear multi-axis from discrete nonlinear RGB groups", async () => {
    const multiAxis = auditRgbInterval(
      await fixture((x, y) => [100 + 20 * x, 100 + 20 * y, 10]),
      interval,
    );
    expect(multiAxis.reasons.multipleGradientAxes).toBe(12);
    const groups = auditRgbInterval(
      await fixture((x) => (x === 0 ? [0, 0, 0] : [200, 40, 20])),
      interval,
    );
    expect(groups.colors.pairedDistinctPerTick.mean).toBe(2);
    expect(groups.colors.darkFraction).toBeCloseTo(0.2);
    expect(groups.reasons.lowChannelFit).toBe(12);
    expect(groups.recipe).toBe("UNKNOWN");
  });
  it("retains endpoint RGB without extrapolating XYZ or bridging clips", async () => {
    const show = await fixture((x, _y, f) => [100 + 20 * x + f, 20, 10]);
    const end = auditRgbInterval(show, { ...interval, start: 1, end: 2 });
    expect(end.coverage.rgbSamples).toBe(25);
    expect(end.coverage.pairedSamples).toBe(25);
    expect(end.spatial.temporal.consecutiveSupportedPairs).toBe(0);
    const missing = auditRgbInterval(
      { ...show, drones: show.drones.map((d) => ({ ...d, positionSampleCount: 0 })) },
      interval,
    );
    expect(missing.reasons.noPairs).toBe(12);
    expect(missing.coverage.pairedFraction).toBe(0);
    const insufficient = auditRgbInterval({ ...show, drones: show.drones.slice(0, 5) }, interval);
    expect(insufficient.reasons.insufficientGeometryOrFleet).toBe(12);
    const fractional = auditRgbInterval(show, { ...interval, start: 0.09, end: 0.26 });
    expect(fractional.spatial.rgbFrameRange).toEqual([2, 4]);
  });
  it("preserves source arrays, bytes and report, emits finite deterministic JSON/Markdown", async () => {
    const show = await fixture((x, y, f) => [100 + 20 * x, 30 + y * y + f, 10]);
    const bytes = show.drones.map(referenceDroneFileBytes),
      before = JSON.stringify(show.report);
    const first = auditRgbInterval(show, interval);
    expect(auditRgbInterval(show, interval)).toEqual(first);
    expect(show.drones.map(referenceDroneFileBytes)).toEqual(bytes);
    expect(JSON.stringify(show.report)).toBe(before);
    const inspect = (v: unknown) => {
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
      else if (v && typeof v === "object") Object.values(v).forEach(inspect);
    };
    inspect(first);
    expect(
      rgbAuditMarkdown({
        provenance: { archiveName: "test.zip", archiveSha256: "abc" },
        intervals: [first],
        limitations: ["UNKNOWN recipe"],
      }),
    ).not.toMatch(/NaN|Infinity/);
    expect(benchmarkRgbIntervals("| 31–77 | observed |\n| 77–88 | move |")).toHaveLength(2);
    expect(rgbAuditWindows(11).map((i) => [i.start, i.end])).toEqual([
      [0, 5],
      [5, 10],
      [10, 11],
    ]);
    expect(() => rgbAuditWindows(1, 0)).toThrow();
    expect(() => auditRgbInterval(show, { ...interval, end: NaN })).toThrow();
  });
  it("validates ZIP fleet and records checksum with byte-identical reconstruction", async () => {
    const bytes = buildSyntheticEssp({
      xyz: Array.from({ length: 9 }, () => [0, 0, 3000]),
      rgb: Array.from({ length: 13 }, () => [10, 20, 30]),
    });
    await expect(readRgbAuditArchive(zipSync({ "1.essp": bytes }), "short.zip")).rejects.toThrow(
      "150",
    );
    const archive = zipSync(
      Object.fromEntries(Array.from({ length: 150 }, (_, d) => [`${d + 1}.essp`, bytes])),
    );
    const result = await readRgbAuditArchive(archive, "synthetic.zip");
    expect(result.provenance.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.provenance.files.every((f) => f.roundTripIdentical)).toBe(true);
    expect(result.show.timing.positionRateHz).toBe(8);
    expect(result.show.timing.rgbRateHz).toBe(12);
  });
});
