import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../../show/defaultProject";
import { sampleDynamicFormation } from "../../show/dynamic/sampler";
import { validateDynamicFormation } from "../../show/dynamic/validate";
import {
  allocateParts,
  buildProposalContent,
  mockChoreographyProvider,
  parsePrompt,
  validateProposal,
} from "../index";

const AREA = createDefaultProject(150).area;

describe("prompt understanding", () => {
  it("reads an English bird prompt", () => {
    const intent = parsePrompt(
      "Create a bird with 150 drones that flaps its wings 4 times and flies 30 meters forward",
    );
    expect(intent.language).toBe("en");
    expect(intent.concept).toBe("BIRD");
    expect(intent.fleetCount).toBe(150);
    expect(intent.cycles).toBe(4);
    expect(intent.forward).toBe(30);
  });

  it("reads the equivalent Romanian prompt", () => {
    const intent = parsePrompt(
      "Fă un porumbel din 150 de drone care bate din aripi de 4 ori și zboară 30 de metri înainte",
    );
    expect(intent.language).toBe("ro");
    expect(intent.concept).toBe("BIRD");
    expect(intent.fleetCount).toBe(150);
    expect(intent.cycles).toBe(4);
    expect(intent.forward).toBe(30);
  });

  it("recognises a female 3D profile in Romanian and English", () => {
    expect(parsePrompt("o siluetă 3D de fată văzută din profil").concept).toBe("WOMAN_PROFILE");
    expect(parsePrompt("an elegant 3D woman profile with long hair").concept).toBe("WOMAN_PROFILE");
  });

  it("understands refinement wording in both languages", () => {
    expect(parsePrompt("make the flapping slower").speedScale).toBeGreaterThan(1);
    expect(parsePrompt("mai lent, te rog").speedScale).toBeGreaterThan(1);
    expect(parsePrompt("rotate it 20 degrees").rotationDeg).toBe(20);
    expect(parsePrompt("rotește-l 20 grade").rotationDeg).toBe(20);
    expect(parsePrompt("keep the body still").bodyDeforms).toBe(false);
    expect(parsePrompt("ține corpul nemișcat").bodyDeforms).toBe(false);
  });
});

describe("mock provider", () => {
  it("is deterministic for the same request", async () => {
    const request = { prompt: "bird flapping 4 times", fleetCount: 150, area: AREA };
    const a = await mockChoreographyProvider.generateProposal(request);
    const b = await mockChoreographyProvider.generateProposal(request);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a schema-valid proposal with explicit assumptions", async () => {
    const proposal = await mockChoreographyProvider.generateProposal({
      prompt: "Un porumbel care bate din aripi de 4 ori și avansează 30 de metri",
      fleetCount: 150,
      area: AREA,
    });
    expect(validateProposal(proposal, 150)).toEqual({ valid: true, errors: [] });
    expect(proposal.concept).toBe("BIRD");
    expect(proposal.animationSpec.cycles).toBe(4);
    expect(proposal.globalMotion.translation[2]).toBe(30);
    expect(proposal.assumptions.length).toBeGreaterThan(0);
  });

  it("warns instead of silently changing the fleet size", async () => {
    const proposal = await mockChoreographyProvider.generateProposal({
      prompt: "a bird with 300 drones",
      fleetCount: 150,
      area: AREA,
    });
    expect(proposal.fleetCount).toBe(150);
    expect(proposal.warnings.join(" ")).toContain("150");
  });

  it("refines an existing proposal without discarding it", async () => {
    const base = await mockChoreographyProvider.generateProposal({
      prompt: "bird flapping 4 times",
      fleetCount: 100,
      area: AREA,
    });
    const refined = await mockChoreographyProvider.refineProposal({
      proposal: base,
      instruction: "make it slower and rotate it 20 degrees",
    });
    expect(refined.concept).toBe(base.concept);
    expect(refined.animationSpec.cycleDuration).toBeGreaterThan(base.animationSpec.cycleDuration);
    expect(refined.globalMotion.rotationDeg).toBe(20);
    expect(refined.fleetCount).toBe(100);
  });

  it("rejects an empty prompt", async () => {
    await expect(
      mockChoreographyProvider.generateProposal({ prompt: "  ", fleetCount: 50 }),
    ).rejects.toThrow();
  });
});

describe("proposal validation", () => {
  it("rejects malformed proposals", () => {
    expect(validateProposal(null).valid).toBe(false);
    expect(validateProposal({ schemaVersion: 1 }).valid).toBe(false);
  });
});

describe("deterministic builder", () => {
  it("allocates parts to an exact total", () => {
    const counts = allocateParts(150, [
      ["BODY", 0.3],
      ["LEFT_WING", 0.29],
      ["RIGHT_WING", 0.29],
      ["HEAD", 0.05],
      ["TAIL", 0.07],
    ]);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(150);
  });

  it("builds exactly N points and mirrored wing groups", async () => {
    const proposal = await mockChoreographyProvider.generateProposal({
      prompt: "Un porumbel care bate din aripi de 4 ori",
      fleetCount: 150,
      area: AREA,
    });
    const built = buildProposalContent(proposal, { area: AREA, seed: 7 });

    expect(built.formation.points).toHaveLength(150);
    expect(built.dynamicFormation).not.toBeNull();
    const dynamic = built.dynamicFormation!;
    expect(dynamic.points).toHaveLength(150);

    const left = dynamic.groups.find((g) => g.name === "Left wing")!;
    const right = dynamic.groups.find((g) => g.name === "Right wing")!;
    expect(left.pointIds.length).toBe(right.pointIds.length);
    // Wings flap in opposition about Z, one closed cycle per group track.
    expect(left.keyframes[1]!.rotation[2]).toBeCloseTo(-right.keyframes[1]!.rotation[2], 6);
    expect(left.keyframes.at(-1)!.rotation).toEqual([0, 0, 0]);
    expect(left.loopDuration).toBeCloseTo(proposal.animationSpec.cycleDuration, 6);
    expect(dynamic.duration).toBeCloseTo(
      proposal.animationSpec.cycleDuration * proposal.animationSpec.cycles,
      6,
    );

    // Every group membership resolves to a real base point.
    const ids = new Set(dynamic.points.map((p) => p.id));
    for (const group of dynamic.groups) {
      for (const id of group.pointIds) expect(ids.has(id)).toBe(true);
    }
  });

  it("is deterministic and actually animates the wing tips", async () => {
    const proposal = await mockChoreographyProvider.generateProposal({
      prompt: "bird flapping 4 times",
      fleetCount: 80,
      area: AREA,
    });
    const a = buildProposalContent(proposal, { area: AREA, seed: 3 });
    const b = buildProposalContent(proposal, { area: AREA, seed: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const dynamic = a.dynamicFormation!;
    const left = dynamic.groups.find((g) => g.name === "Left wing")!;
    const tipId = left.pointIds.at(-1)!;
    const index = dynamic.points.findIndex((p) => p.id === tipId);
    const quarter = proposal.animationSpec.cycleDuration / 4;
    const at0 = sampleDynamicFormation(dynamic, 0)[index]!;
    const atQuarter = sampleDynamicFormation(dynamic, quarter)[index]!;
    expect(Math.abs(atQuarter[1] - at0[1])).toBeGreaterThan(0.5);
  });

  it("builds a readable layered woman profile and animates only the hair", async () => {
    const proposal = await mockChoreographyProvider.generateProposal({
      prompt: "Creează o siluetă 3D de fată din profil, cu păr lung și mișcare lentă",
      fleetCount: 80,
      area: AREA,
    });
    expect(proposal.concept).toBe("WOMAN_PROFILE");
    expect(validateProposal(proposal, 80).valid).toBe(true);
    const built = buildProposalContent(proposal, { area: AREA, seed: 11 });
    expect(built.formation.points).toHaveLength(80);
    expect(built.parts).toEqual(["HAIR"]);
    const xs = built.formation.points.map((point) => point[0]);
    const ys = built.formation.points.map((point) => point[1]);
    const zs = built.formation.points.map((point) => point[2]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(proposal.formationSpec.width * 0.6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(proposal.formationSpec.height * 0.8);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(proposal.formationSpec.depth * 0.25);

    const dynamic = built.dynamicFormation!;
    const hair = dynamic.groups.find((group) => group.name === "Hair")!;
    expect(hair.pointIds.length).toBeGreaterThan(30);
    expect(hair.keyframes.at(-1)!.rotation).toEqual([0, 0, 0]);
    const hairIndex = dynamic.points.findIndex((point) => point.id === hair.pointIds[10]);
    const faceIndex = dynamic.points.findIndex((point) => !hair.pointIds.includes(point.id));
    const at0 = sampleDynamicFormation(dynamic, 0);
    const atQuarter = sampleDynamicFormation(dynamic, proposal.animationSpec.cycleDuration / 4);
    expect(atQuarter[hairIndex]).not.toEqual(at0[hairIndex]);
    expect(atQuarter[faceIndex]).toEqual(at0[faceIndex]);
    expect(
      validateDynamicFormation(dynamic, { limits: createDefaultProject(80).limits, area: AREA })
        .issues,
    ).toEqual([]);
  });

  it("keeps a static concept static", async () => {
    const proposal = await mockChoreographyProvider.generateProposal({
      prompt: "a heart",
      fleetCount: 60,
      area: AREA,
    });
    const built = buildProposalContent(
      { ...proposal, animationSpec: { ...proposal.animationSpec, dynamic: false } },
      { area: AREA },
    );
    expect(built.dynamicFormation).toBeNull();
    expect(built.formation.points).toHaveLength(60);
  });
});
