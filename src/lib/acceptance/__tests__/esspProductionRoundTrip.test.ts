/**
 * IMPORTED ESSP PRODUCTION ROUND TRIP — acceptance suite.
 *
 * Paths B (imported, untouched) and C (imported, edited / mixed authority) of
 * the production acceptance matrix, plus the clock, coordinate and RGB byte
 * contracts of the generated package.
 *
 * The archives are SYNTHETIC (observed profile). Byte-exactness here proves the
 * studio's own round trip; it is NOT a vendor/hardware certification claim.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { unzipSync } from "fflate";

import { parseEssp } from "@/lib/import/essp/codec";
import {
  DEFAULT_ESSP_AXIS_MAPPING,
  esspToStudio,
  studioToEssp,
} from "@/lib/import/essp/coordinates";
import { reconcileReferenceLayer } from "@/lib/import/essp/native";
import { referenceColorsAt } from "@/lib/import/essp/native/splice";
import type { ReferenceTrajectoryLayer } from "@/lib/import/essp/native/types";
import type { ReferenceShow } from "@/lib/import/essp/types";
import { buildEsspExportPackage } from "@/lib/adapters/esspExport";
import { buildOriginalEsspDownload } from "@/lib/adapters/esspSourceRecovery";
import { EMPTY_LIGHTING_PROGRAM, type LightingEffectInstance } from "@/lib/show/lighting";
import type { FullShowValidationReport } from "@/lib/show/fullshow/types";
import type { ShowProject } from "@/lib/show/types";

import {
  ACCEPTANCE_STRATEGY,
  FIXED_GENERATED_AT,
  SOURCE_POSITION_RATE_HZ,
  SOURCE_RGB_RATE_HZ,
  forcedReady,
  importedFixture,
  planFor,
  rebuildReference,
  saveAndReopen,
  syntheticEsspArchive,
  validate,
  type ImportedFixture,
} from "./support/productionFixtures";

const DRONES = 4;
const SECONDS = 60;

let fixture: ImportedFixture;
let report: FullShowValidationReport;

function exportPackage(
  project: ShowProject,
  reference: { show: ReferenceShow; layer: ReferenceTrajectoryLayer } | null,
  fullShow: FullShowValidationReport | null,
  stale = false,
) {
  return buildEsspExportPackage({
    project,
    plan: planFor(project),
    reference,
    fullShow,
    fullShowStale: stale,
    generatedAt: FIXED_GENERATED_AT,
  });
}

beforeAll(async () => {
  fixture = await importedFixture(DRONES, SECONDS);
  report = validate(fixture.project, { show: fixture.show, layer: fixture.layer });
}, 300_000);

/* ------------------------------------------- B. imported, untouched round trip */

describe("imported ESSP — untouched production round trip", () => {
  it("keeps REFERENCE ownership, source profile, clocks, hash and filenames", () => {
    expect(fixture.layer.bindings.length).toBeGreaterThan(0);
    expect(fixture.layer.bindings.every((b) => b.owner === "REFERENCE")).toBe(true);
    expect(fixture.show.timing.positionRateHz).toBe(SOURCE_POSITION_RATE_HZ);
    expect(fixture.show.timing.rgbRateHz).toBe(SOURCE_RGB_RATE_HZ);
    expect(fixture.layer.showHash).toBeTruthy();
    expect(fixture.layer.drones.map((d) => d.sourceFile)).toEqual([...fixture.sourceNames]);
    expect(fixture.layer.drones.every((d) => !!d.fileBase64)).toBe(true);
  });

  it("survives save -> reopen -> rebuilt reference authority with identical bytes", () => {
    const saved = saveAndReopen({
      project: fixture.project,
      planning: { assignmentStrategy: ACCEPTANCE_STRATEGY, transitionOverrides: {} },
      referenceLayer: fixture.layer,
    });
    expect(saved.referenceLayer).not.toBeNull();
    const rebuilt = rebuildReference(saved.referenceLayer!);

    // Persisted reference authority is identical after the reopen.
    expect(rebuilt.layer.showHash).toBe(fixture.layer.showHash);
    expect(rebuilt.layer.bindings.map((b) => b.owner)).toEqual(
      fixture.layer.bindings.map((b) => b.owner),
    );
    expect(rebuilt.show.timing.positionRateHz).toBe(SOURCE_POSITION_RATE_HZ);
    expect(rebuilt.show.timing.rgbRateHz).toBe(SOURCE_RGB_RATE_HZ);
    expect(rebuilt.layer.drones.map((d) => d.sourceFile)).toEqual([...fixture.sourceNames]);

    // Revalidation after reopen, then generated export from the rebuilt authority.
    const reopenedReport = validate(saved.project, rebuilt);
    const result = exportPackage(saved.project, rebuilt, forcedReady(reopenedReport));
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("PRESERVED_PAYLOAD");
    expect(result.profileStatus).toBe("SOURCE_PROFILE");
    result.files.forEach((file, i) => {
      expect(file.name).toBe(fixture.sourceNames[i]);
      expect(Array.from(file.bytes)).toEqual(Array.from(fixture.sourceBytes[i]!));
    });
  });

  it("is byte-deterministic across three consecutive generated exports", () => {
    const runs = [0, 1, 2].map(() =>
      exportPackage(fixture.project, { show: fixture.show, layer: fixture.layer }, forcedReady(report)),
    );
    const [first, ...rest] = runs;
    for (const run of rest) {
      expect(run.files.map((f) => f.name)).toEqual(first!.files.map((f) => f.name));
      expect(run.manifest).toEqual(first!.manifest);
      run.files.forEach((f, i) => {
        expect(Array.from(f.bytes)).toEqual(Array.from(first!.files[i]!.bytes));
      });
      expect(Array.from(run.zip!)).toEqual(Array.from(first!.zip!));
    }
    const entries = unzipSync(first!.zip!);
    expect(Object.keys(entries).sort()).toEqual(
      [...fixture.sourceNames, "manifest.json"].sort(),
    );
  });

  it("reports the imported clocks and last-sample times in the manifest", () => {
    const { manifest } = exportPackage(
      fixture.project,
      { show: fixture.show, layer: fixture.layer },
      forcedReady(report),
    );
    expect(manifest?.positionRateHz).toBe(SOURCE_POSITION_RATE_HZ);
    expect(manifest?.rgbRateHz).toBe(SOURCE_RGB_RATE_HZ);
    expect(manifest?.positionSampleCount).toBe(fixture.show.timing.positionSampleCount);
    expect(manifest?.rgbSampleCount).toBe(fixture.show.timing.rgbSampleCount);
    expect(manifest?.lastPositionTimeSeconds).toBeCloseTo(
      (fixture.show.timing.positionSampleCount - 1) / SOURCE_POSITION_RATE_HZ,
      6,
    );
    expect(manifest?.lastRgbTimeSeconds).toBeCloseTo(
      (fixture.show.timing.rgbSampleCount - 1) / SOURCE_RGB_RATE_HZ,
      6,
    );
    // Independent clocks: RGB frames are not derived from position frames.
    expect(manifest!.rgbSampleCount).not.toBe(manifest!.positionSampleCount);
  });
});

/* ------------------------------------------------------ C. mixed authority */

function authoredEffect(clipId: string): LightingEffectInstance {
  return {
    id: "acceptance-mixed-color",
    type: "COLOR_TRANSITION",
    target: { kind: "SCENE", clipId },
    anchor: "FORMATION_READY",
    start: 0,
    duration: 4,
    blendMode: "REPLACE",
    priority: 10,
    enabled: true,
    parameters: { fromColor: [10, 20, 30], toColor: [200, 100, 50], easing: "LINEAR" },
  };
}

interface Mixed {
  readonly project: ShowProject;
  readonly layer: ReferenceTrajectoryLayer;
  readonly clipId: string;
}

function makeMixed(): Mixed {
  const binding = fixture.layer.bindings.find(
    (b) => b.kind === "SCENE" && b.referenceEnd - b.referenceHoldStart > 2,
  )!;
  const program = fixture.project.lighting ?? EMPTY_LIGHTING_PROGRAM;
  const project: ShowProject = {
    ...fixture.project,
    lighting: { ...program, effects: [...program.effects, authoredEffect(binding.clipId)] },
  };
  const reconciled = reconcileReferenceLayer(project, fixture.layer, {
    assignmentStrategy: ACCEPTANCE_STRATEGY,
    transitionOverrides: {},
  });
  return { project, layer: reconciled.layer, clipId: binding.clipId };
}

describe("imported ESSP — edited / mixed authority", () => {
  it("promotes only the edited interval and keeps the rest REFERENCE-owned", () => {
    const mixed = makeMixed();
    const planner = mixed.layer.bindings.filter((b) => b.owner === "PLANNER");
    const reference = mixed.layer.bindings.filter((b) => b.owner === "REFERENCE");
    expect(planner.length).toBeGreaterThan(0);
    expect(reference.length).toBeGreaterThan(0);
    expect(planner.some((b) => b.clipId === mixed.clipId)).toBe(true);
  });

  it("preserves ownership across save -> reopen and exports in SAMPLED mode", () => {
    const mixed = makeMixed();
    const saved = saveAndReopen({
      project: mixed.project,
      planning: { assignmentStrategy: ACCEPTANCE_STRATEGY, transitionOverrides: {} },
      referenceLayer: mixed.layer,
    });
    const rebuilt = rebuildReference(saved.referenceLayer!);
    expect(rebuilt.layer.bindings.map((b) => [b.clipId, b.owner])).toEqual(
      mixed.layer.bindings.map((b) => [b.clipId, b.owner]),
    );

    const reopenedReport = validate(saved.project, rebuilt);
    const result = exportPackage(saved.project, rebuilt, forcedReady(reopenedReport));
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("SAMPLED");
    expect(result.profileStatus).toBe("SOURCE_PROFILE");

    const source = parseEssp(fixture.sourceBytes[0]!);
    const written = parseEssp(result.files[0]!.bytes);
    // Source clocks, counts and opaque profile are reused, not invented.
    expect(written.header.positionRateRaw).toBe(source.header.positionRateRaw);
    expect(written.header.rgbRateRaw).toBe(source.header.rgbRateRaw);
    expect(written.positionSampleCount).toBe(source.positionSampleCount);
    expect(written.rgbSampleCount).toBe(source.rgbSampleCount);
    expect(Array.from(written.header.opaqueProfileBytes)).toEqual(
      Array.from(source.header.opaqueProfileBytes),
    );
    // Every drone shares the same frame counts.
    const counts = result.files.map((f) => {
      const p = parseEssp(f.bytes);
      return `${p.positionSampleCount}/${p.rgbSampleCount}`;
    });
    expect(new Set(counts).size).toBe(1);
  });

  it("splice continuity remains within the canonical tolerance", () => {
    const mixed = makeMixed();
    const mixedReport = validate(mixed.project, { show: fixture.show, layer: mixed.layer });
    // Canonical splice authority only — no loosened tolerance in the test.
    expect(mixedReport.splice).not.toBeNull();
    expect(mixedReport.splice!.ok).toBe(true);
  });

  it("keeps imported RGB in reference-owned time and writes authored RGB in promoted time", () => {
    const mixed = makeMixed();
    const mixedReport = validate(mixed.project, { show: fixture.show, layer: mixed.layer });
    const result = exportPackage(
      mixed.project,
      { show: fixture.show, layer: mixed.layer },
      forcedReady(mixedReport),
    );
    expect(result.ok).toBe(true);
    const written = parseEssp(result.files[0]!.bytes);

    // t = 0 is reference-owned: exported bytes equal the canonical reference colour.
    const refColors = referenceColorsAt(fixture.show, mixed.layer, 0, mixed.project.droneCount);
    expect(refColors).not.toBeNull();
    const refColor = refColors![0]!;
    expect([written.rgb[0], written.rgb[1], written.rgb[2]]).toEqual([
      refColor[0],
      refColor[1],
      refColor[2],
    ]);

    // Somewhere in the stream the authored effect changed the bytes.
    const source = parseEssp(fixture.sourceBytes[0]!);
    const differs = Array.from({ length: written.rgbSampleCount }).some((_, k) => {
      const o = k * 3;
      return (
        written.rgb[o] !== source.rgb[o] ||
        written.rgb[o + 1] !== source.rgb[o + 1] ||
        written.rgb[o + 2] !== source.rgb[o + 2]
      );
    });
    expect(differs).toBe(true);
  });

  it("SAMPLED bytes are identical across repeated exports", () => {
    const mixed = makeMixed();
    const mixedReport = forcedReady(
      validate(mixed.project, { show: fixture.show, layer: mixed.layer }),
    );
    const runs = [0, 1, 2].map(() =>
      exportPackage(mixed.project, { show: fixture.show, layer: mixed.layer }, mixedReport),
    );
    for (const run of runs.slice(1)) {
      expect(run.manifest).toEqual(runs[0]!.manifest);
      run.files.forEach((f, i) => {
        expect(Array.from(f.bytes)).toEqual(Array.from(runs[0]!.files[i]!.bytes));
      });
      expect(Array.from(run.zip!)).toEqual(Array.from(runs[0]!.zip!));
    }
  });
});

/* ------------------------------------------------------- coordinate contract */

describe("coordinate round trip", () => {
  it("inverts every integer ESSP triplet exactly (origin, signs, altitude, depth)", () => {
    const raws: [number, number, number][] = [
      [0, 0, 0],
      [1, -1, 2],
      [-32768, 32767, -1234],
      [12345, -12345, 9000],
      [-1, 1, -1],
    ];
    for (const raw of raws) expect(studioToEssp(esspToStudio(raw))).toEqual(raw);
  });

  it("bounds the studio -> ESSP deviation at half a centimetre", () => {
    // Fractional metres near rounding boundaries: the documented rule is
    // round-half-away-from-zero on 1 cm units, so the bound is 0.005 m.
    const metres = [0, 0.004, 0.005, 0.0051, -0.005, 1.2345, -9.8765, 123.456];
    let worst = 0;
    for (const m of metres) {
      const raw = studioToEssp([m, 50, m], DEFAULT_ESSP_AXIS_MAPPING);
      const back = esspToStudio(raw, DEFAULT_ESSP_AXIS_MAPPING);
      worst = Math.max(worst, Math.abs(back[0] - m), Math.abs(back[2] - m));
    }
    expect(worst).toBeLessThanOrEqual(0.005 + 1e-12);
  });

  it("decodes generated XYZ back through the canonical inverse within the bound", () => {
    const mixed = makeMixed();
    const mixedReport = forcedReady(
      validate(mixed.project, { show: fixture.show, layer: mixed.layer }),
    );
    const result = exportPackage(
      mixed.project,
      { show: fixture.show, layer: mixed.layer },
      mixedReport,
    );
    const written = parseEssp(result.files[0]!.bytes);
    let worst = 0;
    for (let k = 0; k < written.positionSampleCount; k += 1) {
      const raw: [number, number, number] = [
        written.xyz[k * 3]!,
        written.xyz[k * 3 + 1]!,
        written.xyz[k * 3 + 2]!,
      ];
      const back = studioToEssp(esspToStudio(raw));
      worst = Math.max(
        worst,
        Math.abs(back[0] - raw[0]),
        Math.abs(back[1] - raw[1]),
        Math.abs(back[2] - raw[2]),
      );
    }
    expect(worst).toBe(0);
  });
});

/* -------------------------------------------------------- clock disagreement */

describe("clock disagreement in the imported fleet", () => {
  it("blocks the generated export and still returns the original bytes", async () => {
    const files = syntheticEsspArchive(DRONES, 20);
    // One file declares a different position rate: no averaging policy exists.
    const odd = files[1]!;
    const bytes = new Uint8Array(odd.bytes);
    new DataView(bytes.buffer).setUint16(16, 10_000, true);
    const disagreeing = files.map((f, i) => (i === 1 ? { name: f.name, bytes } : f));

    const { buildReferenceShow } = await import("@/lib/import/essp/reference");
    const show = await buildReferenceShow(disagreeing);
    const rates = new Set(show.drones.map((d) => d.header.positionRateRaw));
    expect(rates.size).toBeGreaterThan(1);

    const result = buildEsspExportPackage({
      project: fixture.project,
      plan: planFor(fixture.project),
      reference: { show, layer: fixture.layer },
      fullShow: forcedReady(report),
    });
    expect(result.ok).toBe(false);
    expect(result.zip).toBeNull();
    expect(result.blockers.join(" ")).toMatch(/disagree on the position rate/i);

    // Source recovery is independent of the export gate.
    const recovery = buildOriginalEsspDownload({
      projectName: fixture.project.name,
      layer: fixture.layer,
    });
    expect(recovery.ok).toBe(true);
    recovery.files.forEach((f, i) => {
      expect(Array.from(f.bytes)).toEqual(Array.from(fixture.sourceBytes[i]!));
    });
  }, 120_000);
});
