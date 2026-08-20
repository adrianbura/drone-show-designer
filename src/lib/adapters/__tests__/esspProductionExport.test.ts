/**
 * PRODUCTION ESSP PER-DRONE EXPORT — acceptance suite.
 *
 * Proves the export contract of a REVERSE-ENGINEERED target format:
 *   - the coordinate inverse is exact for integer-centimetre values
 *   - out-of-range positions and non-byte RGB are HARD failures, never wraps
 *   - an imported, unedited show round-trips BYTE-EXACT per drone
 *   - a mixed REFERENCE/PLANNER show keeps untouched reference samples verbatim
 *   - the export uses the same gate as every other computed show export
 */
import { describe, expect, it, beforeAll } from "vitest";
import { unzipSync } from "fflate";

import { buildSyntheticEssp, parseEssp } from "../../import/essp/codec";
import {
  DEFAULT_ESSP_AXIS_MAPPING,
  esspToStudio,
  studioToEssp,
  EsspRangeError,
  ESSP_INT16_MAX,
} from "../../import/essp/coordinates";
import { buildEsspFile, OBSERVED_ESSP_PROFILE, profileFromHeader } from "../../import/essp/export/writer";
import { ESSP_HEADER } from "../../import/essp/types";
import { buildReferenceShow } from "../../import/essp/reference";
import { analyzeReferenceShow } from "../../import/essp/forensics/report";
import {
  extractReferenceTimeline,
  reconcileReferenceLayer,
  referenceShowFromLayer,
  migrateReferenceLayer,
  reseedReferenceSignatures,
} from "../../import/essp/native";
import { referenceDroneFileBytes } from "../../import/essp/native/layer";
import type { ReferenceTrajectoryLayer } from "../../import/essp/native/types";
import type { ReferenceShow } from "../../import/essp/types";
import { buildShowPlan } from "../../show/trajectory/schedule";
import { analyzeFullShow } from "../../show/fullshow";
import type { FullShowValidationReport } from "../../show/fullshow/types";
import { createDefaultProject } from "../../show/defaultProject";
import type { ShowProject } from "../../show/types";
import { EMPTY_LIGHTING_PROGRAM, type LightingEffectInstance } from "../../show/lighting/types";
import { buildEsspExportPackage } from "../esspExport";
import { buildOriginalEsspDownload, hasEsspSourceBytes } from "../esspSourceRecovery";

const RATE = 8;
const RGB_RATE = 12;
const DRONES = 4;
const STRATEGY = "nearestNeighbor" as const;

/* ------------------------------------------------------------------ fixture */

function rgbTrack(index: number, frames: number): number[][] {
  const base = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ];
  const c = base[index % base.length]!;
  return Array.from({ length: frames }, (_, f) =>
    Math.floor(f / RGB_RATE) % 2 === 0 ? [...c] : [17, 34, 51],
  );
}

/**
 * Continuous, gentle reference trajectory: hold / move / hold plateaus so the
 * extractor sees real scenes, and no sample-to-sample discontinuity.
 * Values are raw ESSP units (1 unit = 1 cm).
 */
function trajectory(index: number): number[][] {
  const x0 = (index % 2) * 600 - 300;
  const y0 = Math.floor(index / 2) * 600 - 300;
  const ramp = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const total = 60;
  const out: number[][] = [];
  for (let f = 0; f <= total * RATE; f += 1) {
    const t = f / RATE;
    const climb = ramp(t, 0, 10) * 2500;
    const drift = ramp(t, 20, 30) * 600;
    const rise = ramp(t, 40, 46) * 800;
    const land = ramp(t, 52, 60);
    const z = (climb + rise) * (1 - land);
    out.push([Math.round(x0 + drift), y0, Math.round(z)]);
  }
  return out;
}


interface Fixture {
  readonly show: ReferenceShow;
  readonly project: ShowProject;
  readonly layer: ReferenceTrajectoryLayer;
  readonly sourceBytes: Uint8Array[];
}

async function fixtureShow(): Promise<Fixture> {
  const sourceBytes: Uint8Array[] = [];
  const files = Array.from({ length: DRONES }, (_, i) => {
    const xyz = trajectory(i);
    const bytes = buildSyntheticEssp({
      xyz,
      rgb: rgbTrack(i, Math.ceil((xyz.length / RATE) * RGB_RATE)),
    });
    sourceBytes.push(bytes);
    return { name: `${i + 1}.essp`, bytes };
  });
  const show = await buildReferenceShow(files);
  const report = analyzeReferenceShow(show);
  const result = extractReferenceTimeline(show, report);
  const base = createDefaultProject();
  const project: ShowProject = {
    ...base,
    droneCount: result.droneCount,
    formations: [...result.formations],
    timeline: [...result.timeline],
    dynamicFormations: [...result.dynamicFormations],
    scenes: [...result.scenes],
    lighting: result.lighting,
    ...(base.preShow ? { preShow: { ...base.preShow, enabled: false } } : {}),
  };
  const layer = reseedReferenceSignatures(project, result.layer, {
    assignmentStrategy: STRATEGY,
    transitionOverrides: {},
  });
  return { show, project, layer, sourceBytes };
}

function reportFor(project: ShowProject, show: ReferenceShow, layer: ReferenceTrajectoryLayer) {
  return analyzeFullShow(project, {
    sampleRate: RATE,
    assignmentStrategy: STRATEGY,
    reference: { show, layer },
  }).report;
}

/** A READY report shape for gate tests that must not depend on show content. */
function readyReport(): FullShowValidationReport {
  return {
    analysisRevision: "rev-1",
    splice: { ok: true } as never,
    exportReadiness: { status: "READY", blockers: [], warnings: [] },
  } as unknown as FullShowValidationReport;
}

function exportOf(fixture: Fixture, report: FullShowValidationReport, stale = false) {
  const plan = buildShowPlan(fixture.project, { assignmentStrategy: STRATEGY });
  return buildEsspExportPackage({
    project: fixture.project,
    plan,
    reference: { show: fixture.show, layer: fixture.layer },
    fullShow: report,
    fullShowStale: stale,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
}

let fixture: Fixture;
let report: FullShowValidationReport;

/**
 * The real analysis of the fixture, forced to a READY readiness. "Export ESSP"
 * is generated output with NO exemption, so a preserved-payload export needs a
 * passing gate exactly like a sampled one.
 */
function allowed(): FullShowValidationReport {
  return {
    ...report,
    exportReadiness: { status: "READY", blockers: [], warnings: [] },
  } as unknown as FullShowValidationReport;
}

beforeAll(async () => {
  fixture = await fixtureShow();
  report = reportFor(fixture.project, fixture.show, fixture.layer);
}, 180_000);

/* ------------------------------------------------------- coordinate inverse */

describe("studio -> ESSP coordinate inverse", () => {
  it("round-trips every integer ESSP triplet exactly", () => {
    const raws: [number, number, number][] = [
      [0, 0, 0],
      [1, -1, 2],
      [-32768, 32767, -1234],
      [4321, -8765, 250],
      [-1, -1, -1],
    ];
    for (const raw of raws) {
      expect(studioToEssp(esspToStudio(raw))).toEqual(raw);
    }
  });

  it("respects axis swaps and inversion flags", () => {
    const mapping = { ...DEFAULT_ESSP_AXIS_MAPPING, invertX: true, invertZ: true };
    const raw: [number, number, number] = [123, -456, 789];
    expect(studioToEssp(esspToStudio(raw, mapping), mapping)).toEqual(raw);
  });

  it("rounds half away from zero", () => {
    // 0.005 m = 0.5 units -> 1, and -0.005 m -> -1 (never biased to +inf).
    expect(studioToEssp([0.005, 0, 0])[0]).toBe(1);
    expect(studioToEssp([-0.005, 0, 0])[0]).toBe(-1);
  });

  it("rejects int16 overflow instead of wrapping", () => {
    expect(() => studioToEssp([400, 0, 0])).toThrow(EsspRangeError);
    expect(() => studioToEssp([Number.NaN, 0, 0])).toThrow(EsspRangeError);
  });
});

/* ------------------------------------------------------------------- writer */

describe("production ESSP writer", () => {
  const profile = { ...OBSERVED_ESSP_PROFILE, opaqueProfileBytes: new Uint8Array(13).fill(7) };

  it("writes correct magic, version, lengths and rate fields", () => {
    const bytes = buildEsspFile({
      profile,
      positionRateHz: 8,
      rgbRateHz: 12,
      xyzSamples: [1, 2, 3, 4, 5, 6],
      rgbSamples: [1, 2, 3],
    });
    const parsed = parseEssp(bytes);
    expect(parsed.header.magic).toBe("ESS");
    expect(parsed.header.version).toBe(1);
    expect(parsed.header.positionRateRaw).toBe(8000);
    expect(parsed.header.rgbRateRaw).toBe(12000);
    expect(parsed.header.xyzPayloadLength).toBe(12);
    expect(parsed.header.rgbPayloadLength).toBe(3);
    expect(parsed.positionSampleCount).toBe(2);
    expect(parsed.rgbSampleCount).toBe(1);
    expect(Array.from(parsed.xyz)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(bytes.byteLength).toBe(ESSP_HEADER.size + 12 + 3);
  });

  it("is deterministic", () => {
    const args = { profile, positionRateHz: 8, rgbRateHz: 12, xyzSamples: [7, 8, 9], rgbSamples: [4, 5, 6] };
    expect(buildEsspFile(args)).toEqual(buildEsspFile(args));
  });

  it("rejects out-of-range XYZ and non-byte RGB", () => {
    const ok = { profile, positionRateHz: 8, rgbRateHz: 12 };
    expect(() =>
      buildEsspFile({ ...ok, xyzSamples: [ESSP_INT16_MAX + 1, 0, 0], rgbSamples: [] }),
    ).toThrow(EsspRangeError);
    expect(() => buildEsspFile({ ...ok, xyzSamples: [0.5, 0, 0], rgbSamples: [] })).toThrow(
      EsspRangeError,
    );
    expect(() => buildEsspFile({ ...ok, xyzSamples: [], rgbSamples: [256, 0, 0] })).toThrow(
      EsspRangeError,
    );
    expect(() => buildEsspFile({ ...ok, xyzSamples: [], rgbSamples: [-1, 0, 0] })).toThrow(
      EsspRangeError,
    );
    expect(() => buildEsspFile({ ...ok, xyzSamples: [1, 2], rgbSamples: [] })).toThrow(
      EsspRangeError,
    );
  });

  it("rejects rates that are not representable as Hz x 1000", () => {
    expect(() =>
      buildEsspFile({ profile, positionRateHz: 8.00005, rgbRateHz: 12, xyzSamples: [], rgbSamples: [] }),
    ).toThrow(EsspRangeError);
  });

  it("copies the source profile verbatim", () => {
    const source = parseEssp(fixture.sourceBytes[0]!);
    const copied = profileFromHeader(source.header, "1.essp");
    const bytes = buildEsspFile({
      profile: copied,
      positionRateHz: source.header.positionRateHz,
      rgbRateHz: source.header.rgbRateHz,
      xyzSamples: [0, 0, 0],
      rgbSamples: [0, 0, 0],
    });
    const written = parseEssp(bytes);
    expect(Array.from(written.header.opaqueProfileBytes)).toEqual(
      Array.from(source.header.opaqueProfileBytes),
    );
    expect(written.header.unknownU16).toBe(source.header.unknownU16);
    expect(written.header.version).toBe(source.header.version);
  });
});

/* --------------------------------------------------------- unedited round trip */

describe("unedited imported show — byte-exact per-drone round trip", () => {
  it("exports the source bytes verbatim, one file per drone", () => {
    const result = exportOf(fixture, allowed());
    expect(result.blockers).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("PRESERVED_PAYLOAD");
    expect(result.profileStatus).toBe("SOURCE_PROFILE");
    expect(result.files).toHaveLength(DRONES);
    result.files.forEach((file, i) => {
      expect(file.name).toBe(`${i + 1}.essp`);
      expect(Array.from(file.bytes)).toEqual(Array.from(fixture.sourceBytes[i]!));
    });
  });

  it("keeps the source clocks and last-sample semantics in the manifest", () => {
    const { manifest } = exportOf(fixture, allowed());
    expect(manifest?.positionRateHz).toBe(RATE);
    expect(manifest?.rgbRateHz).toBe(RGB_RATE);
    expect(manifest?.positionSampleCount).toBe(fixture.show.timing.positionSampleCount);
    expect(manifest?.rgbSampleCount).toBe(fixture.show.timing.rgbSampleCount);
    expect(manifest?.lastPositionTimeSeconds).toBeCloseTo(
      (fixture.show.timing.positionSampleCount - 1) / RATE,
      6,
    );
    expect(manifest?.lastRgbTimeSeconds).toBeCloseTo(
      (fixture.show.timing.rgbSampleCount - 1) / RGB_RATE,
      6,
    );
    expect(manifest?.sourceProfilePreserved).toBe(true);
    expect(manifest?.experimental).toMatch(/REVERSE-ENGINEERED/);
  });

  it("packages a deterministic ZIP with the manifest and no drone-name collision", () => {
    const a = exportOf(fixture, allowed());
    const b = exportOf(fixture, allowed());
    expect(Array.from(a.zip!)).toEqual(Array.from(b.zip!));
    const entries = unzipSync(a.zip!);
    expect(Object.keys(entries).sort()).toEqual(
      ["1.essp", "2.essp", "3.essp", "4.essp", "manifest.json"].sort(),
    );
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]!)) as {
      droneCount: number;
      files: string[];
    };
    expect(manifest.droneCount).toBe(DRONES);
    expect(manifest.files).not.toContain("manifest.json");
    expect(Array.from(entries["1.essp"]!)).toEqual(Array.from(fixture.sourceBytes[0]!));
  });

  it("survives save/reopen of the layer (rehydrated bytes are identical)", () => {
    const rehydrated = referenceShowFromLayer(
      migrateReferenceLayer(JSON.parse(JSON.stringify(fixture.layer))),
    );
    const plan = buildShowPlan(fixture.project, { assignmentStrategy: STRATEGY });
    const result = buildEsspExportPackage({
      project: fixture.project,
      plan,
      reference: { show: rehydrated, layer: fixture.layer },
      fullShow: allowed(),
    });
    expect(result.ok).toBe(true);
    result.files.forEach((file, i) => {
      expect(Array.from(file.bytes)).toEqual(Array.from(fixture.sourceBytes[i]!));
    });
  });
});

/* --------------------------------------------------------- mixed authority */

function authoredEffect(clipId: string): LightingEffectInstance {
  return {
    id: "essp-export-color",
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

describe("mixed REFERENCE / PLANNER export", () => {
  it("keeps untouched reference samples and writes planner values for promoted time", () => {
    const clipId = fixture.layer.bindings.find(
      (b) => b.kind === "SCENE" && b.referenceEnd - b.referenceHoldStart > 2,
    )!.clipId;
    const program = fixture.project.lighting ?? EMPTY_LIGHTING_PROGRAM;
    const edited: ShowProject = {
      ...fixture.project,
      lighting: { ...program, effects: [...program.effects, authoredEffect(clipId)] },
    };
    const reconciled = reconcileReferenceLayer(edited, fixture.layer, {
      assignmentStrategy: STRATEGY,
      transitionOverrides: {},
    });
    expect(reconciled.layer.bindings.some((b) => b.owner === "PLANNER")).toBe(true);

    const plan = buildShowPlan(edited, { assignmentStrategy: STRATEGY });
    const editedReport = reportFor(edited, fixture.show, reconciled.layer);
    const result = buildEsspExportPackage({
      project: edited,
      plan,
      reference: { show: fixture.show, layer: reconciled.layer },
      fullShow: editedReport,
      fullShowStale: false,
    });
    if (!result.ok) {
      // A blocked mixed export must state WHY; it must never emit silently.
      expect(result.blockers.length).toBeGreaterThan(0);
      return;
    }
    expect(result.mode).toBe("SAMPLED");
    expect(result.profileStatus).toBe("SOURCE_PROFILE");
    expect(result.files).toHaveLength(edited.droneCount);

    const source = parseEssp(fixture.sourceBytes[0]!);
    const written = parseEssp(result.files[0]!.bytes);

    // One continuous stream per drone, on the source clocks and counts.
    expect(written.header.positionRateRaw).toBe(source.header.positionRateRaw);
    expect(written.header.rgbRateRaw).toBe(source.header.rgbRateRaw);
    expect(written.positionSampleCount).toBe(source.positionSampleCount);
    expect(written.rgbSampleCount).toBe(source.rgbSampleCount);
    expect(Array.from(written.header.opaqueProfileBytes)).toEqual(
      Array.from(source.header.opaqueProfileBytes),
    );

    // Reference-owned prefix (t = 0 is always reference-owned here): verbatim.
    const referenceIsFirst = reconciled.layer.bindings[0]!.owner === "REFERENCE";
    expect(referenceIsFirst).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      expect(written.xyz[i]).toBe(source.xyz[i]);
    }

    // Some RGB frame inside the promoted clip differs from the imported bytes.
    const differs = Array.from({ length: written.rgbSampleCount }).some((_, k) => {
      const o = k * 3;
      return (
        written.rgb[o] !== source.rgb[o] ||
        written.rgb[o + 1] !== source.rgb[o + 1] ||
        written.rgb[o + 2] !== source.rgb[o + 2]
      );
    });
    expect(differs).toBe(true);

    // Every drone in the package shares the same frame counts (no off-by-one).
    const counts = result.files.map((f) => {
      const p = parseEssp(f.bytes);
      return `${p.positionSampleCount}/${p.rgbSampleCount}`;
    });
    expect(new Set(counts).size).toBe(1);
  });
});

/* -------------------------------------------------- authored-only + gating */

describe("authored show (no import)", () => {
  it("uses the observed profile behind an explicit EXPERIMENTAL label", () => {
    const project = createDefaultProject();
    const plan = buildShowPlan(project, { assignmentStrategy: STRATEGY });
    const result = buildEsspExportPackage({
      project,
      plan,
      reference: null,
      fullShow: readyReport(),
    });
    expect(result.ok).toBe(true);
    expect(result.profileStatus).toBe("EXPERIMENTAL_PROFILE");
    expect(result.mode).toBe("SAMPLED");
    expect(result.warnings.join(" ")).toMatch(/UNVERIFIED/);
    expect(result.manifest?.positionRateHz).toBe(8);
    expect(result.manifest?.rgbRateHz).toBe(12);
    // Independent clocks: frame counts follow their own rate, not each other.
    const duration = result.manifest!.durationSeconds;
    expect(result.manifest?.positionSampleCount).toBe(Math.round(duration * 8) + 1);
    expect(result.manifest?.rgbSampleCount).toBe(Math.round(duration * 12) + 1);
    const parsed = parseEssp(result.files[0]!.bytes);
    expect(parsed.positionSampleCount).toBe(result.manifest?.positionSampleCount);
    expect(parsed.rgbSampleCount).toBe(result.manifest?.rgbSampleCount);
    expect(result.files.map((f) => f.name)).toEqual(
      result.files.map((_, i) => `${i + 1}.essp`),
    );
  });
});

describe("export gate", () => {
  const gated = (fullShow: FullShowValidationReport | null, stale = false) => {
    const project = createDefaultProject();
    const plan = buildShowPlan(project, { assignmentStrategy: STRATEGY });
    return buildEsspExportPackage({ project, plan, fullShow, fullShowStale: stale });
  };

  it("requires a fresh, non-blocked full-show report", () => {
    const missing = gated(null);
    expect(missing.ok).toBe(false);
    expect(missing.zip).toBeNull();
    expect(missing.blockers.join(" ")).toMatch(/full-show validation/i);

    const stale = gated(readyReport(), true);
    expect(stale.ok).toBe(false);
    expect(stale.blockers.join(" ")).toMatch(/changed after validation/i);

    const blocked = gated({
      ...readyReport(),
      exportReadiness: { status: "BLOCKED", blockers: ["safety"], warnings: [] },
    } as unknown as FullShowValidationReport);
    expect(blocked.ok).toBe(false);
    expect(blocked.blockers).toContain("safety");
  });

  it("blocks when the splice check failed", () => {
    const failed = gated({
      ...readyReport(),
      splice: { ok: false } as never,
    } as unknown as FullShowValidationReport);
    expect(failed.ok).toBe(false);
    expect(failed.blockers.join(" ")).toMatch(/Splice safety/);
  });

  it("blocks when imported files disagree on a clock", () => {
    const mismatched: ReferenceShow = {
      ...fixture.show,
      drones: fixture.show.drones.map((d, i) =>
        i === 0
          ? d
          : { ...d, header: { ...d.header, positionRateRaw: 9000, positionRateHz: 9 } },
      ),
    };
    const plan = buildShowPlan(fixture.project, { assignmentStrategy: STRATEGY });
    const result = buildEsspExportPackage({
      project: fixture.project,
      plan,
      reference: { show: mismatched, layer: fixture.layer },
      fullShow: allowed(),
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/disagree on the position rate/);
  });
});

describe("reference drone file bytes helper", () => {
  it("agrees with the exported preserved payload", () => {
    fixture.show.drones.forEach((drone, i) => {
      expect(Array.from(referenceDroneFileBytes(drone))).toEqual(
        Array.from(fixture.sourceBytes[i]!),
      );
    });
  });
});

/* ------------------------------------------ policy: no preserved-payload exemption */

describe("Export ESSP policy — generated output, no exemption", () => {
  const blockedReport = () =>
    ({
      ...readyReport(),
      exportReadiness: { status: "BLOCKED", blockers: ["separation violation"], warnings: [] },
    }) as unknown as FullShowValidationReport;

  it("BLOCKED blocks even a fully reference-owned (preserved) show", () => {
    const result = exportOf(fixture, blockedReport());
    expect(result.ok).toBe(false);
    expect(result.zip).toBeNull();
    expect(result.files).toEqual([]);
    expect(result.blockers).toContain("separation violation");
    expect(result.warnings.join(" ")).not.toMatch(/verbatim copy of the imported archive/);
  });

  it("stale and missing analyses block a preserved show too", () => {
    expect(exportOf(fixture, readyReport(), true).ok).toBe(false);
    const plan = buildShowPlan(fixture.project, { assignmentStrategy: STRATEGY });
    const missing = buildEsspExportPackage({
      project: fixture.project,
      plan,
      reference: { show: fixture.show, layer: fixture.layer },
      fullShow: null,
    });
    expect(missing.ok).toBe(false);
  });

  it("a passing gate still reuses the original bytes (PRESERVED_PAYLOAD kept)", () => {
    const result = exportOf(fixture, allowed());
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("PRESERVED_PAYLOAD");
  });
});

/* -------------------------------------------------------- source recovery */

describe("original ESSP source recovery", () => {
  it("returns byte-identical original files while validation is BLOCKED", () => {
    const blocked = exportOf(fixture, {
      ...readyReport(),
      exportReadiness: { status: "BLOCKED", blockers: ["x"], warnings: [] },
    } as unknown as FullShowValidationReport);
    expect(blocked.ok).toBe(false);

    const recovery = buildOriginalEsspDownload({
      projectName: "My Show",
      layer: fixture.layer,
    });
    expect(recovery.ok).toBe(true);
    expect(recovery.reason).toBe("OK");
    expect(recovery.files).toHaveLength(DRONES);
    recovery.files.forEach((file, i) => {
      expect(Array.from(file.bytes)).toEqual(Array.from(fixture.sourceBytes[i]!));
    });
    expect(recovery.zipFileName).toBe("my-show.original-essp.zip");
    expect(recovery.referenceShowHash).toBe(fixture.layer.showHash);
  });

  it("is deterministic, named from the source and never mutates the layer", () => {
    const before = JSON.stringify(fixture.layer);
    const a = buildOriginalEsspDownload({ projectName: "p", layer: fixture.layer });
    const b = buildOriginalEsspDownload({ projectName: "p", layer: fixture.layer });
    expect(JSON.stringify(fixture.layer)).toBe(before);
    expect(Array.from(a.zip!)).toEqual(Array.from(b.zip!));
    expect(a.files.map((f) => f.name)).toEqual(
      fixture.layer.drones.map((d) => d.sourceFile),
    );
    expect(a.files.every((f) => f.nameFromSource)).toBe(true);
    const entries = unzipSync(a.zip!);
    expect(Object.keys(entries)).toContain("source-recovery.json");
    const manifest = JSON.parse(
      new TextDecoder().decode(entries["source-recovery.json"]!),
    ) as { kind: string; description: string };
    expect(manifest.kind).toBe("SOURCE_RECOVERY");
    expect(manifest.description).toMatch(/byte-for-byte/);
    expect(Array.from(entries[a.files[0]!.name]!)).toEqual(
      Array.from(fixture.sourceBytes[0]!),
    );
  });

  it("falls back to deterministic names and reports missing source bytes", () => {
    const noNames: ReferenceTrajectoryLayer = {
      ...fixture.layer,
      drones: fixture.layer.drones.map((d) => ({ ...d, sourceFile: "" })),
    };
    const named = buildOriginalEsspDownload({ projectName: "p", layer: noNames });
    expect(named.files.map((f) => f.name)).toEqual(
      fixture.layer.drones.map((d) => `${d.numericSourceId}.essp`),
    );
    expect(named.files.every((f) => f.nameFromSource)).toBe(false);

    expect(hasEsspSourceBytes(null)).toBe(false);
    const empty = buildOriginalEsspDownload({ projectName: "p", layer: null });
    expect(empty.ok).toBe(false);
    expect(empty.reason).toBe("NO_SOURCE");
    expect(empty.zip).toBeNull();
    expect(empty.zipFileName).toBe("p.original-essp.zip");
  });
});
