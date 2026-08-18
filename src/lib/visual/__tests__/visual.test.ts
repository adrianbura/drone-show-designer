import { describe, expect, it } from "vitest";

import { dynamicFromFormation } from "@/lib/show/dynamic/create";
import { sampleDynamicFormation } from "@/lib/show/dynamic/sampler";
import {
  BUILT_IN_DESIGNS,
  BUTTERFLY_DESIGN,
  compileVisualFormation,
  DRONE_ART_COMPILER_VERSION,
  animatableParts,
  dynamicFromCompiled,
  formationFromCompiled,
  PIGEON_DESIGN,
  PORTRAIT_DESIGN,
  readVisualProvenance,
  sampleCurve,
  serializeDesign,
  parseDesign,
  validateDesign,
  VisualDesignError,
  visualProvenance,
  type VisualStyle,
} from "@/lib/visual";
import {
  assetFromFormation,
  formationFromAsset,
  parseAssetFile,
  serializeAssetFile,
} from "@/lib/library";
import { migrateProposalV1ToV2, validateFormationProposalV2 } from "@/lib/ai/visualIntent";
import { MockChoreographyProvider } from "@/lib/ai/mockProvider";

const COUNTS = [1, 10, 50, 80, 150, 200, 300, 500, 1200];

describe("visual formation designs", () => {
  it("ships valid built-in designs", () => {
    expect(BUILT_IN_DESIGNS.length).toBeGreaterThanOrEqual(3);
    for (const design of BUILT_IN_DESIGNS) {
      expect(validateDesign(design)).toEqual([]);
    }
  });

  it("round-trips a design through JSON", () => {
    const parsed = parseDesign(serializeDesign(PIGEON_DESIGN));
    expect(parsed).toEqual(PIGEON_DESIGN);
  });

  it("rejects an invalid design document", () => {
    expect(() => parseDesign("{\"schemaVersion\":1}")).toThrow(VisualDesignError);
  });
});

describe("drone art compiler — exact N", () => {
  for (const design of BUILT_IN_DESIGNS) {
    it(`produces exactly N points for ${design.id}`, () => {
      for (const count of COUNTS) {
        const compiled = compileVisualFormation(design, count, { width: 120, altitude: 60 });
        expect(compiled.points.length).toBe(count);
        expect(compiled.colors.length).toBe(count);
        expect(compiled.sources.length).toBe(count);
        expect(compiled.report.producedPoints).toBe(count);
        expect(compiled.report.requestedPoints).toBe(count);
      }
    });
  }

  it("honours every visual style exactly", () => {
    const styles: VisualStyle[] = ["OUTLINE", "STRUCTURAL", "BALANCED", "FILLED"];
    for (const style of styles) {
      const compiled = compileVisualFormation(BUTTERFLY_DESIGN, 200, { style });
      expect(compiled.points.length).toBe(200);
      expect(compiled.report.style).toBe(style);
    }
  });

  it("rejects invalid counts", () => {
    expect(() => compileVisualFormation(PIGEON_DESIGN, 0)).toThrow(VisualDesignError);
    expect(() => compileVisualFormation(PIGEON_DESIGN, -5)).toThrow(VisualDesignError);
  });

  it("is deterministic across repeated compilations", () => {
    const a = compileVisualFormation(PIGEON_DESIGN, 150, { seed: 7 });
    const b = compileVisualFormation(PIGEON_DESIGN, 150, { seed: 7 });
    expect(b.points).toEqual(a.points);
    expect(b.report).toEqual(a.report);
    expect(b.partIndices).toEqual(a.partIndices);
  });

  it("never mutates the design", () => {
    const before = JSON.stringify(PIGEON_DESIGN);
    compileVisualFormation(PIGEON_DESIGN, 300, { style: "FILLED" });
    expect(JSON.stringify(PIGEON_DESIGN)).toBe(before);
  });

  it("compiles 1200 points in interactive time", () => {
    const t0 = Date.now();
    const compiled = compileVisualFormation(BUTTERFLY_DESIGN, 1200);
    expect(compiled.points.length).toBe(1200);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

describe("drone art compiler — priority and degradation", () => {
  it("drops low-priority details before essential features", () => {
    const low = compileVisualFormation(PORTRAIT_DESIGN, 50, { style: "STRUCTURAL" });
    const dropped = new Set(low.report.droppedPrimitiveIds);
    expect(dropped.size).toBeGreaterThan(0);
    for (const essential of ["face-outline", "eye-left-outline", "eye-right-outline", "mouth", "nose"]) {
      expect(dropped.has(essential)).toBe(false);
    }
    expect(low.report.highPriorityPreserved).toBe(1);
    expect(low.report.issues.some((i) => i.code === "DETAILS_OMITTED")).toBe(true);
  });

  it("adds detail progressively as the count grows", () => {
    const small = compileVisualFormation(PIGEON_DESIGN, 80);
    const large = compileVisualFormation(PIGEON_DESIGN, 300);
    expect(large.report.primitivesUsed).toBeGreaterThanOrEqual(small.report.primitivesUsed);
    expect(large.report.droppedPrimitiveIds.length).toBeLessThanOrEqual(
      small.report.droppedPrimitiveIds.length,
    );
    expect(Object.keys(large.report.allocationByPart).length).toBeGreaterThanOrEqual(
      Object.keys(small.report.allocationByPart).length,
    );
  });

  it("keeps the artistic identity at every pigeon resolution", () => {
    for (const count of [80, 150, 300]) {
      const compiled = compileVisualFormation(PIGEON_DESIGN, count, { style: "STRUCTURAL" });
      const parts = compiled.report.allocationByPart;
      for (const part of ["BODY", "HEAD", "TAIL", "LEFT_WING", "RIGHT_WING"]) {
        expect(parts[part] ?? 0).toBeGreaterThan(0);
      }
      expect((parts["LEFT_WING"] ?? 0) + (parts["RIGHT_WING"] ?? 0)).toBeGreaterThan(
        (parts["BODY"] ?? 0),
      );
    }
  });

  it("keeps butterfly structure recognisable at 200 drones", () => {
    const compiled = compileVisualFormation(BUTTERFLY_DESIGN, 200, { style: "STRUCTURAL" });
    const parts = compiled.report.allocationByPart;
    expect(parts["BODY"]).toBeGreaterThan(0);
    expect(parts["LEFT_ANTENNA"]).toBeGreaterThan(0);
    expect(parts["RIGHT_ANTENNA"]).toBeGreaterThan(0);
    const veins = compiled.sources.filter((s) => s.primitiveId.includes("vein")).length;
    expect(veins).toBeGreaterThan(10);
  });

  it("reads a stylised face at 300 drones", () => {
    const compiled = compileVisualFormation(PORTRAIT_DESIGN, 300, { style: "STRUCTURAL" });
    const parts = compiled.report.allocationByPart;
    for (const part of ["FACE", "LEFT_EYE", "RIGHT_EYE", "NOSE", "MOUTH", "HAIR"]) {
      expect(parts[part] ?? 0).toBeGreaterThan(0);
    }
    expect(compiled.report.droppedPrimitiveIds).toEqual([]);
  });
});

describe("drone art compiler — symmetry and mapping", () => {
  it("balances mirrored structures deterministically", () => {
    for (const count of [80, 151, 200, 401]) {
      const compiled = compileVisualFormation(BUTTERFLY_DESIGN, count);
      const parts = compiled.report.allocationByPart;
      expect(parts["LEFT_WING"]).toBe(parts["RIGHT_WING"]);
      expect(parts["LEFT_ANTENNA"]).toBe(parts["RIGHT_ANTENNA"]);
    }
  });

  it("maps every point to a source primitive and semantic part", () => {
    const compiled = compileVisualFormation(PIGEON_DESIGN, 150);
    const ids = new Set(PIGEON_DESIGN.primitives.map((p) => p.id));
    for (const source of compiled.sources) {
      expect(ids.has(source.primitiveId)).toBe(true);
      expect(source.part).toBeTruthy();
    }
    const grouped = Object.values(compiled.partIndices).reduce((s, v) => s + v.length, 0);
    expect(grouped).toBe(150);
  });

  it("reports visual diagnostics without claiming flight safety", () => {
    const compiled = compileVisualFormation(PIGEON_DESIGN, 150);
    const report = compiled.report;
    expect(report.compilerVersion).toBe(DRONE_ART_COMPILER_VERSION);
    expect(report.minSpacing).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toMatch(/safe/i);
  });
});

describe("curve sampling", () => {
  it("distributes samples approximately uniformly by arc length", () => {
    const path = [
      [0, 0],
      [1, 0],
      [1.02, 0],
      [1.04, 0],
      [2, 0],
    ] as const;
    const samples = sampleCurve(path, 21, false);
    expect(samples.length).toBe(21);
    const gaps: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      gaps.push(Math.hypot(samples[i]![0] - samples[i - 1]![0], samples[i]![1] - samples[i - 1]![1]));
    }
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    for (const g of gaps) expect(Math.abs(g - mean)).toBeLessThan(mean * 0.35);
  });

  it("preserves corners", () => {
    const square = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const;
    const samples = sampleCurve(square, 12, true);
    for (const corner of square) {
      expect(samples.some((s) => s[0] === corner[0] && s[1] === corner[1])).toBe(true);
    }
  });
});

describe("formation library integration", () => {
  it("saves, reloads and recompiles a compiled asset", () => {
    const compiled = compileVisualFormation(PIGEON_DESIGN, 150, { width: 140, altitude: 70 });
    const formation = formationFromCompiled(compiled, { id: "f-pigeon", name: "Pigeon 150" });
    expect(formation.points.length).toBe(150);

    const asset = assetFromFormation(formation, { name: "Pigeon 150", source: "AI_GENERATED" });
    const reloaded = parseAssetFile(serializeAssetFile(asset));
    const restored = formationFromAsset(reloaded, "f-restored");
    expect(restored.points).toEqual(formation.points);

    const provenance = readVisualProvenance(restored);
    expect(provenance).toEqual(visualProvenance(compiled));

    // Recompile the SAME design at a different drone count.
    const recompiled = compileVisualFormation(PIGEON_DESIGN, 220, {
      width: 140,
      altitude: 70,
      style: provenance!.style,
      seed: provenance!.seed,
    });
    expect(recompiled.points.length).toBe(220);
  });

  it("does not pad the asset to the project fleet size", () => {
    const projectFleetCount = 500;
    const formationDroneCount = 150;
    const compiled = compileVisualFormation(PIGEON_DESIGN, formationDroneCount);
    expect(compiled.points.length).toBe(formationDroneCount);
    expect(compiled.points.length).toBeLessThan(projectFleetCount);
  });
});

describe("dynamic formation bridge", () => {
  it("turns semantic parts into motion groups of the existing engine", () => {
    const compiled = compileVisualFormation(PIGEON_DESIGN, 150);
    const formation = formationFromCompiled(compiled, { id: "f-p", name: "Pigeon" });
    const parts = animatableParts(PIGEON_DESIGN, compiled).map((p) => p.id);
    expect(parts).toContain("LEFT_WING");
    expect(parts).toContain("RIGHT_WING");

    const dynamic = dynamicFromCompiled(formation, PIGEON_DESIGN, compiled, {
      id: "dyn-p",
      parts: ["LEFT_WING", "RIGHT_WING"],
    });
    expect(dynamic.points.length).toBe(150);
    expect(dynamic.groups.map((g) => g.name)).toEqual(["LEFT_WING", "RIGHT_WING"]);
    const grouped = dynamic.groups.reduce((s, g) => s + g.pointIds.length, 0);
    expect(grouped).toBe(
      (compiled.partIndices["LEFT_WING"]?.length ?? 0) +
        (compiled.partIndices["RIGHT_WING"]?.length ?? 0),
    );
    // Sampling stays exact-N through the existing dynamic engine.
    expect(sampleDynamicFormation(dynamic, 0).length).toBe(150);
    expect(dynamicFromFormation(formation, { id: "x" }).points.length).toBe(150);
  });
});

describe("AI product role", () => {
  it("migrates a v1 choreography proposal to a v2 visual-asset proposal", async () => {
    const provider = new MockChoreographyProvider();
    const v1 = await provider.generateProposal({
      prompt: "a bird flapping its wings",
      fleetCount: 120,
    });
    const v2 = migrateProposalV1ToV2(v1, { formationDroneCount: 150, style: "STRUCTURAL" });
    expect(v2.schemaVersion).toBe(2);
    expect(v2.formationDroneCount).toBe(150);
    expect(validateFormationProposalV2(v2)).toEqual([]);
    // No timeline / music choreography intent survives into the asset model.
    const serialized = JSON.stringify(v2);
    for (const term of ["beat", "chorus", "timelinePlacement"]) {
      expect(Object.keys(v2)).not.toContain(term);
    }
    expect(serialized).not.toMatch(/timelinePlacement/);
  });

  it("keeps the v1 schema intact", async () => {
    const provider = new MockChoreographyProvider();
    const v1 = await provider.generateProposal({ prompt: "a heart", fleetCount: 80 });
    expect(v1.schemaVersion).toBe(1);
    expect(v1.fleetCount).toBe(80);
  });
});

describe("car design with rolling wheels", () => {
  it("compiles exactly N points and spins both wheels about their own centre", () => {
    const compiled = compileVisualFormation(CAR_DESIGN, 180, { width: 120, altitude: 60 });
    expect(compiled.points).toHaveLength(180);
    expect(compiled.partIndices["FRONT_WHEEL"]!.length).toBeGreaterThan(10);

    const formation = formationFromCompiled(compiled, { id: "f-car", name: "Car" });
    const dynamic = dynamicFromCompiled(formation, CAR_DESIGN, compiled, { id: "d-car" });
    expect(dynamic.loop).toBe("REPEAT");
    const wheels = dynamic.groups.filter((g) => g.name.endsWith("WHEEL"));
    expect(wheels).toHaveLength(2);

    const index = compiled.partIndices["FRONT_WHEEL"]![0]!;
    const at0 = sampleDynamicFormation(dynamic, 0)[index]!;
    const atHalf = sampleDynamicFormation(dynamic, dynamic.duration / 2)[index]!;
    const atFull = sampleDynamicFormation(dynamic, dynamic.duration)[index]!;
    // Half a cycle = 180 deg away, a full cycle returns to the start.
    expect(Math.hypot(atHalf[0] - at0[0], atHalf[1] - at0[1])).toBeGreaterThan(10);
    expect(Math.hypot(atFull[0] - at0[0], atFull[1] - at0[1])).toBeLessThan(1e-6);
  });
});
