/**
 * PRODUCTION WORKFLOW ACCEPTANCE.
 *
 * CREATE/IMPORT -> EDIT -> VALIDATE -> SAVE -> REOPEN -> REVALIDATE -> EXPORT,
 * for the three primary show types:
 *   A. authored project
 *   B. imported ESSP, untouched
 *   C. imported ESSP, edited (mixed authority)
 *
 * Everything is driven through canonical authorities: project serializer,
 * reference layer, full-show validator, export eligibility, ESSP exporter and
 * source recovery. No domain maths is duplicated here.
 */
import { describe, expect, it, beforeAll } from "vitest";

import { buildEsspExportPackage } from "@/lib/adapters/esspExport";
import { buildOriginalEsspDownload, hasEsspSourceBytes } from "@/lib/adapters/esspSourceRecovery";
import { evaluateExportEligibility } from "@/lib/adapters/exportEligibility";
import { reconcileReferenceLayer } from "@/lib/import/essp/native";
import { ProjectFileError, parseProjectFile } from "@/lib/project";
import { EMPTY_LIGHTING_PROGRAM, type LightingEffectInstance } from "@/lib/show/lighting";
import type { FullShowValidationReport } from "@/lib/show/fullshow/types";
import type { ShowProject } from "@/lib/show/types";

import {
  ACCEPTANCE_STRATEGY,
  AUTHORED_STRATEGY,
  FIXED_GENERATED_AT,
  authoredProductionProject,
  forcedReady,
  importedFixture,
  planAuthored,
  planFor,
  rebuildReference,
  saveAndReopen,
  validate,
  validateAuthored,
  type ImportedFixture,
} from "./support/productionFixtures";

const AUTHORED_FLEET = 60;

function contentFingerprint(project: ShowProject) {
  return {
    id: project.id,
    droneCount: project.droneCount,
    area: project.area,
    limits: project.limits,
    altitudes: project.altitudes,
    formations: project.formations.map((f) => [f.id, f.kind, f.points.length]),
    dynamicFormations: project.dynamicFormations ?? [],
    scenes: (project.scenes ?? []).map((s) => [s.id, s.objects.length]),
    timeline: project.timeline.map((c) => [c.id, c.formationId, c.start, c.transition, c.hold, c.phase ?? "SHOW"]),
    lighting: project.lighting ?? null,
    participation: project.participation ?? null,
    markers: project.markers ?? [],
    musicSections: project.musicSections ?? [],
    audio: { ...project.audio, attached: false },
    preShow: project.preShow ?? null,
  };
}

let imported: ImportedFixture;

beforeAll(async () => {
  imported = await importedFixture(4, 60);
}, 300_000);

/* ------------------------------------------------------------ A. authored */

describe("A. authored production path", () => {
  const project = authoredProductionProject(AUTHORED_FLEET);
  let report: FullShowValidationReport;

  beforeAll(() => {
    report = validateAuthored(project, 8);
  }, 300_000);

  it("has takeoff, SHOW clips with transitions, lighting and landing", () => {
    expect(project.timeline.some((c) => c.phase === "TAKEOFF")).toBe(true);
    expect(project.timeline.filter((c) => (c.phase ?? "SHOW") === "SHOW").length).toBeGreaterThan(1);
    expect(project.timeline.every((c) => c.transition > 0)).toBe(true);
    expect(project.timeline.some((c) => c.phase === "LANDING")).toBe(true);
    expect((project.lighting?.effects.length ?? 0)).toBeGreaterThan(0);
  });

  it("validates to READY or READY_WITH_WARNINGS", () => {
    expect(["READY", "READY_WITH_WARNINGS"]).toContain(report.exportReadiness.status);
  });

  it("save -> reopen preserves authored content and drops the validation report", () => {
    const editor = { selectedClipId: project.timeline[1]!.id, sampleRate: 8 };
    const saved = saveAndReopen({
      project,
      planning: {
        assignmentStrategy: AUTHORED_STRATEGY,
        transitionOverrides: {},
        transitionDesigns: {},
      },
      editor,
    });

    expect(contentFingerprint(saved.project)).toEqual(contentFingerprint(project));
    expect(saved.planning.assignmentStrategy).toBe(AUTHORED_STRATEGY);
    expect(saved.editor?.selectedClipId).toBe(editor.selectedClipId);
    expect(saved.editor?.sampleRate).toBe(8);
    expect(saved.referenceLayer).toBeNull();

    // Validation, decoded audio and every async/session artefact are NOT persisted.
    for (const key of ["report", "validation", "fullShow", "forensics", "aiProposal", "svgDraft"]) {
      expect(saved.envelope[key]).toBeUndefined();
    }
    expect(saved.project.audio.attached).toBe(false);

    // Revalidate after reopen: same readiness class, deterministic export.
    const revalidated = validateAuthored(saved.project, 8);
    expect(revalidated.exportReadiness.status).toBe(report.exportReadiness.status);
    const runs = [0, 1, 2].map(() =>
      buildEsspExportPackage({
        project: saved.project,
        plan: planAuthored(saved.project),
        fullShow: revalidated,
        generatedAt: FIXED_GENERATED_AT,
      }),
    );
    expect(runs[0]!.ok).toBe(true);
    expect(runs[0]!.mode).toBe("SAMPLED");
    expect(runs[0]!.profileStatus).toBe("EXPERIMENTAL_PROFILE");
    // Authored shows use the observed default clocks only.
    expect(runs[0]!.manifest?.positionRateHz).toBe(8);
    expect(runs[0]!.manifest?.rgbRateHz).toBe(12);
    for (const run of runs.slice(1)) {
      expect(run.manifest).toEqual(runs[0]!.manifest);
      expect(Array.from(run.zip!)).toEqual(Array.from(runs[0]!.zip!));
    }
  }, 300_000);
});

/* -------------------------------------------------- B/C. imported authority */

function editedImported(fixture: ImportedFixture) {
  const binding = fixture.layer.bindings.find(
    (b) => b.kind === "SCENE" && b.referenceEnd - b.referenceHoldStart > 2,
  )!;
  const program = fixture.project.lighting ?? EMPTY_LIGHTING_PROGRAM;
  const effect: LightingEffectInstance = {
    id: "workflow-mixed-color",
    type: "COLOR_TRANSITION",
    target: { kind: "SCENE", clipId: binding.clipId },
    anchor: "FORMATION_READY",
    start: 0,
    duration: 3,
    blendMode: "REPLACE",
    priority: 10,
    enabled: true,
    parameters: { fromColor: [5, 5, 5], toColor: [180, 90, 40], easing: "LINEAR" },
  };
  const project: ShowProject = {
    ...fixture.project,
    lighting: { ...program, effects: [...program.effects, effect] },
  };
  const reconciled = reconcileReferenceLayer(project, fixture.layer, {
    assignmentStrategy: ACCEPTANCE_STRATEGY,
    transitionOverrides: {},
  });
  return { project, layer: reconciled.layer, clipId: binding.clipId };
}

describe("B/C. imported authority survives save -> reopen", () => {
  it("keeps the whole reference layer, ownership, payloads, names, clocks and hash", () => {
    const saved = saveAndReopen({
      project: imported.project,
      planning: { assignmentStrategy: ACCEPTANCE_STRATEGY, transitionOverrides: {}, transitionDesigns: {} },
      referenceLayer: imported.layer,
    });
    expect(saved.referenceLayer).toEqual(imported.layer);
    const rebuilt = rebuildReference(saved.referenceLayer!);
    expect(rebuilt.show.timing.positionRateHz).toBe(imported.show.timing.positionRateHz);
    expect(rebuilt.show.timing.rgbRateHz).toBe(imported.show.timing.rgbRateHz);
    expect(rebuilt.layer.drones.map((d) => d.sourceFile)).toEqual([...imported.sourceNames]);
    expect(rebuilt.layer.showHash).toBe(imported.layer.showHash);
  });

  it("keeps MIXED ownership identical after reopen", () => {
    const mixed = editedImported(imported);
    const saved = saveAndReopen({
      project: mixed.project,
      planning: { assignmentStrategy: ACCEPTANCE_STRATEGY, transitionOverrides: {}, transitionDesigns: {} },
      referenceLayer: mixed.layer,
    });
    const rebuilt = rebuildReference(saved.referenceLayer!);
    expect(rebuilt.layer.bindings.map((b) => [b.clipId, b.owner, b.signature])).toEqual(
      mixed.layer.bindings.map((b) => [b.clipId, b.owner, b.signature]),
    );
    expect(rebuilt.layer.bindings.some((b) => b.owner === "PLANNER")).toBe(true);
    expect(rebuilt.layer.bindings.some((b) => b.owner === "REFERENCE")).toBe(true);
  });
});

/* --------------------------------------------------------- source recovery */

describe("source recovery is validation independent and byte exact", () => {
  const gateStates: { label: string; report: FullShowValidationReport | null; stale: boolean }[] = [
    { label: "NO_REPORT", report: null, stale: false },
    {
      label: "STALE",
      report: { exportReadiness: { status: "READY", blockers: [], warnings: [] } } as unknown as FullShowValidationReport,
      stale: true,
    },
    {
      label: "BLOCKED",
      report: {
        exportReadiness: { status: "BLOCKED", blockers: ["safety"], warnings: [] },
      } as unknown as FullShowValidationReport,
      stale: false,
    },
    {
      label: "READY",
      report: { exportReadiness: { status: "READY", blockers: [], warnings: [] } } as unknown as FullShowValidationReport,
      stale: false,
    },
  ];

  it("returns the same original files in every validation state", () => {
    expect(hasEsspSourceBytes(imported.layer)).toBe(true);
    for (const state of gateStates) {
      // Gate state is real: computed exports follow it, source recovery does not.
      const eligibility = evaluateExportEligibility(state.report, state.stale);
      expect(eligibility.canExportComputedShow).toBe(state.label === "READY");
      expect(eligibility.canExportProjectFile).toBe(true);

      const recovery = buildOriginalEsspDownload({
        projectName: imported.project.name,
        layer: imported.layer,
      });
      expect(recovery.ok).toBe(true);
      expect(recovery.reason).toBe("OK");
      expect(recovery.files).toHaveLength(imported.sourceBytes.length);
      recovery.files.forEach((file, i) => {
        expect(file.name).toBe(imported.sourceNames[i]);
        expect(file.bytes.byteLength).toBe(imported.sourceBytes[i]!.byteLength);
        expect(Array.from(file.bytes)).toEqual(Array.from(imported.sourceBytes[i]!));
      });
      expect(recovery.manifest?.kind).toBe("SOURCE_RECOVERY");
      expect(recovery.manifest?.description).toMatch(/NOT generated flight output/i);
      expect(recovery.referenceShowHash).toBe(imported.layer.showHash);
    }
  });

  it("survives save -> reopen of the layer", () => {
    const saved = saveAndReopen({
      project: imported.project,
      planning: { assignmentStrategy: ACCEPTANCE_STRATEGY, transitionOverrides: {} },
      referenceLayer: imported.layer,
    });
    const recovery = buildOriginalEsspDownload({
      projectName: imported.project.name,
      layer: saved.referenceLayer,
    });
    recovery.files.forEach((f, i) => {
      expect(Array.from(f.bytes)).toEqual(Array.from(imported.sourceBytes[i]!));
    });
  });
});

/* -------------------------------------------------------------- gate matrix */

describe("generated export gate matrix", () => {
  const project = authoredProductionProject(12);

  const run = (report: FullShowValidationReport | null, stale = false) =>
    buildEsspExportPackage({ project, plan: planAuthored(project), fullShow: report, fullShowStale: stale });

  const ready = (status: "READY" | "READY_WITH_WARNINGS" | "BLOCKED", warnings: string[] = []) =>
    ({
      analysisRevision: "rev",
      splice: null,
      exportReadiness: { status, blockers: status === "BLOCKED" ? ["safety"] : [], warnings },
    }) as unknown as FullShowValidationReport;

  it("blocks NO_REPORT / STALE / BLOCKED and allows READY / READY_WITH_WARNINGS", () => {
    expect(run(null).ok).toBe(false);
    expect(run(ready("READY"), true).ok).toBe(false);
    expect(run(ready("BLOCKED")).ok).toBe(false);
    expect(run(ready("READY")).ok).toBe(true);
    const warned = run(ready("READY_WITH_WARNINGS", ["separation margin thin"]));
    expect(warned.ok).toBe(true);
    expect(warned.warnings).toContain("separation margin thin");
  });

  it("does not inherit an old READY after an edit (stale gate)", () => {
    const stale = run(ready("READY"), true);
    expect(stale.ok).toBe(false);
    expect(stale.zip).toBeNull();
    expect(stale.blockers.join(" ")).toMatch(/changed after validation/i);
  });

  it("blocks a fleet-count mismatch instead of truncating drones", () => {
    const plan = planAuthored(project);
    const mismatched = { ...project, droneCount: project.droneCount + 3 };
    const result = buildEsspExportPackage({
      project: mismatched,
      plan,
      fullShow: ready("READY"),
    });
    expect(result.ok).toBe(false);
    expect(result.files).toEqual([]);
    expect(result.blockers.join(" ")).toMatch(/incoherent drone count/i);
  });
});

/* ------------------------------------------------------- import atomicity */

describe("corrupt import / reopen atomicity", () => {
  it("rejects malformed project files without touching the open project", () => {
    const openProject = imported.project;
    const before = contentFingerprint(openProject);
    const saved = saveAndReopen({
      project: openProject,
      planning: { assignmentStrategy: ACCEPTANCE_STRATEGY, transitionOverrides: {} },
      referenceLayer: imported.layer,
    });

    // Corrupt source payload: the envelope parser accepts it (it does not decode
    // ESSP bytes), and the failure surfaces later, when the reference authority
    // rehydrates the layer. The studio rehydrates BEFORE adopting a project, so
    // the corrupt file still never replaces the open one.
    const broken = JSON.parse(saved.json) as Record<string, unknown>;
    const layer = broken['referenceLayer'] as { drones: { fileBase64: string }[] };
    layer.drones[0]!.fileBase64 = "!!! not base64 !!!";
    const brokenParsed = parseProjectFile(JSON.stringify(broken));
    expect(brokenParsed.referenceLayer).not.toBeNull();
    expect(() => rebuildReference(brokenParsed.referenceLayer!)).toThrow();

    const truncated = JSON.parse(saved.json) as Record<string, unknown>;
    delete truncated['project'];
    expect(() => parseProjectFile(JSON.stringify(truncated))).toThrow(ProjectFileError);

    expect(() => parseProjectFile("{ not json")).toThrow(ProjectFileError);

    // The in-memory project is untouched by every failed parse.
    expect(contentFingerprint(openProject)).toEqual(before);
    expect(hasEsspSourceBytes(imported.layer)).toBe(true);
  });

  it("keeps a corrupt archive out of the reference show without partial adoption", async () => {
    const { buildReferenceShow } = await import("@/lib/import/essp/reference");
    const good = new Uint8Array(imported.sourceBytes[0]!);
    const truncated = good.slice(0, 10);
    const badHeader = new Uint8Array(good);
    badHeader[0] = 0x41;
    const lengthMismatch = new Uint8Array(good);
    new DataView(lengthMismatch.buffer).setUint32(19, 0xffff, true);

    const show = await buildReferenceShow([
      { name: "1.essp", bytes: good },
      { name: "2.essp", bytes: truncated },
      { name: "3.essp", bytes: badHeader },
      { name: "4.essp", bytes: lengthMismatch },
    ]);
    expect(show.report.validFiles).toBe(1);
    expect(show.report.invalidFiles).toBe(3);
    expect(show.drones).toHaveLength(1);
    for (const name of ["2.essp", "3.essp", "4.essp"]) {
      const diagnostic = show.report.diagnostics.find((d) => d.fileName === name);
      expect(diagnostic?.ok).toBe(false);
      expect(diagnostic?.message ?? "").not.toBe("");
    }
  });
});

/* --------------------------------------------- 10 cycles save/open/validate */

describe("10 logical save -> reopen -> validate -> export cycles", () => {
  it("authored project shows no drift", () => {
    let project = authoredProductionProject(12);
    const baseline = contentFingerprint(project);
    let zip: Uint8Array | null = null;
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const saved = saveAndReopen({
        project,
        planning: { assignmentStrategy: ACCEPTANCE_STRATEGY, transitionOverrides: {}, transitionDesigns: {} },
      });
      project = saved.project;
      expect(contentFingerprint(project)).toEqual(baseline);
      const report = validateAuthored(project, 8);
      const result = buildEsspExportPackage({
        project,
        plan: planAuthored(project),
        fullShow: forcedReady(report),
        generatedAt: FIXED_GENERATED_AT,
      });
      expect(result.ok).toBe(true);
      if (zip) expect(Array.from(result.zip!)).toEqual(Array.from(zip));
      zip = result.zip;
    }
  }, 300_000);

  it("imported/mixed project keeps reference bindings and source files stable", () => {
    const mixed = editedImported(imported);
    let project = mixed.project;
    let layer = mixed.layer;
    const bindings = layer.bindings.map((b) => [b.clipId, b.owner]);
    const sourceCount = layer.drones.length;
    let zip: Uint8Array | null = null;
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const saved = saveAndReopen({
        project,
        planning: { assignmentStrategy: ACCEPTANCE_STRATEGY, transitionOverrides: {}, transitionDesigns: {} },
        referenceLayer: layer,
      });
      project = saved.project;
      const rebuilt = rebuildReference(saved.referenceLayer!);
      layer = rebuilt.layer;
      expect(layer.bindings.map((b) => [b.clipId, b.owner])).toEqual(bindings);
      expect(layer.drones).toHaveLength(sourceCount);
      expect(project.formations).toHaveLength(mixed.project.formations.length);
      expect(project.timeline).toHaveLength(mixed.project.timeline.length);
      expect(project.lighting?.effects.length).toBe(mixed.project.lighting?.effects.length);

      const report = validate(project, rebuilt);
      const result = buildEsspExportPackage({
        project,
        plan: planAuthored(project),
        reference: rebuilt,
        fullShow: forcedReady(report),
        generatedAt: FIXED_GENERATED_AT,
      });
      expect(result.ok).toBe(true);
      if (zip) expect(Array.from(result.zip!)).toEqual(Array.from(zip));
      zip = result.zip;

      const recovery = buildOriginalEsspDownload({ projectName: project.name, layer });
      recovery.files.forEach((f, i) => {
        expect(Array.from(f.bytes)).toEqual(Array.from(imported.sourceBytes[i]!));
      });
    }
  }, 300_000);
});
