/**
 * IMPORTED LIGHTING AUDIT ACCEPTANCE.
 *
 * The audit is a DESCRIPTION of the imported RGB track, never a rewrite. This
 * suite pins:
 *   - segmentation into blackout / held colour / varying runs on the RGB clock,
 *   - the ZERO-ERROR claim: every interval marked reconstructible reproduces the
 *     ORIGINAL bytes of every drone exactly (max deviation 0),
 *   - no loss for varying intervals: they stay owned by the imported track,
 *   - the audit never mutates the reference show or its bytes.
 */
import { describe, expect, it } from "vitest";

import {
  analyzeImportedLighting,
  verifyExactReconstruction,
} from "../../import/essp/native/lightingAudit";
import { customerShapedEsspArchive, importArchiveFixture } from "./support/productionFixtures";

describe("imported lighting audit", () => {
  it("segments the customer-shaped RGB track and never claims a lossy reconstruction", async () => {
    const fixture = await importArchiveFixture(customerShapedEsspArchive(6));
    const audit = analyzeImportedLighting(fixture.show, fixture.layer);
    expect(audit).not.toBeNull();
    const report = audit!;

    expect(report.droneCount).toBe(6);
    expect(report.rgbRateHz).toBe(fixture.show.timing.rgbRateHz);
    expect(report.frameCount).toBeGreaterThan(0);
    expect(report.intervals.length).toBeGreaterThan(1);

    // Segmentation is a partition of the RGB clock: contiguous, no gaps, no overlap.
    let cursor = 0;
    for (const interval of report.intervals) {
      expect(interval.startTime).toBeCloseTo(cursor, 9);
      expect(interval.endTime).toBeGreaterThan(interval.startTime);
      cursor = interval.endTime;
    }
    expect(cursor).toBeCloseTo(report.frameCount / report.rgbRateHz, 6);

    // Durations account for the whole track.
    expect(report.blackoutSeconds + report.solidSeconds + report.varyingSeconds).toBeCloseTo(
      report.frameCount / report.rgbRateHz,
      6,
    );

    // ZERO ERROR OR NO CLAIM: every "exact" interval is verified byte-for-byte
    // against the original samples of every drone.
    for (const interval of report.intervals) {
      if (!interval.exactlyReconstructible) {
        expect(interval.kind).toBe("VARYING");
        continue;
      }
      expect(verifyExactReconstruction(fixture.show, interval)).toBe(0);
    }
    expect(report.exactCoverage).toBeGreaterThanOrEqual(0);
    expect(report.exactCoverage).toBeLessThanOrEqual(1);
  });

  it("classifies a per-drone divergence as VARYING instead of averaging it away", async () => {
    const fixture = await importArchiveFixture(customerShapedEsspArchive(4));
    const report = analyzeImportedLighting(fixture.show, fixture.layer)!;
    for (const interval of report.intervals) {
      if (!interval.fleetUniform) {
        expect(interval.kind).toBe("VARYING");
        expect(interval.exactlyReconstructible).toBe(false);
        // The mean colour is descriptive only and must never be presented as exact.
        expect(verifyExactReconstruction(fixture.show, interval)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("reads only: the reference bytes are untouched by an audit", async () => {
    const fixture = await importArchiveFixture(customerShapedEsspArchive(3));
    const before = fixture.show.drones.map((d) => Array.from(d.rgbSamples));
    analyzeImportedLighting(fixture.show, fixture.layer);
    analyzeImportedLighting(fixture.show, null);
    const after = fixture.show.drones.map((d) => Array.from(d.rgbSamples));
    expect(after).toEqual(before);
  });

  it("marks a fleet-uniform track fully reconstructible with zero error", async () => {
    // Same bytes on every drone: the whole track is a held fleet colour per run,
    // so every segment must be claimed exact AND verify at zero deviation.
    const files = customerShapedEsspArchive(4);
    const uniform = files.map((f, i) => ({ name: `${i + 1}.essp`, bytes: files[0]!.bytes }));
    const fixture = await importArchiveFixture(uniform);
    const report = analyzeImportedLighting(fixture.show, fixture.layer)!;
    expect(report.exactCoverage).toBe(1);
    for (const interval of report.intervals) {
      expect(interval.fleetUniform).toBe(true);
      expect(interval.exactlyReconstructible).toBe(true);
      expect(verifyExactReconstruction(fixture.show, interval)).toBe(0);
    }
  });

  it("returns null when there is nothing imported to describe", () => {
    expect(analyzeImportedLighting(null, null)).toBeNull();
  });
});
