import { describe, expect, it } from "vitest";
import { importedFixture as makeImportedFixture } from "@/lib/acceptance/__tests__/support/productionFixtures";
import { reconcileReferenceLayer, reseedReferenceSignatures } from "../intervals";
import { clipOutputSignature, legacyClipOutputSignature } from "../signature";

const context = { assignmentStrategy: "hungarian", transitionOverrides: {} };

describe("owner-aware signature", () => {
  it("keeps every reference clip after global limit, altitude and assignment edits", async () => {
    const fixture = await makeImportedFixture();
    const project = fixture.project;
    const layer = reseedReferenceSignatures(project, fixture.layer, context);
    const next = { ...project, limits: { ...project.limits, maxVelocity: 20 },
      altitudes: { ...project.altitudes, show: 70 } };
    const result = reconcileReferenceLayer(next, layer, { ...context, assignmentStrategy: "greedy" });
    expect(result.promotions).toEqual([]);
    expect(result.layer.bindings.every((b) => b.owner === "REFERENCE")).toBe(true);
  });
  it("retains planner dependencies on global limits", async () => {
    const { project } = await makeImportedFixture();
    const clip = project.timeline[0];
    if (!clip) throw new Error("fixture needs clip");
    const ctx = { ...context, owner: "PLANNER" as const };
    expect(clipOutputSignature(project, clip.id, ctx)).not.toBe(clipOutputSignature(
      { ...project, limits: { ...project.limits, maxVelocity: 20 } }, clip.id, ctx));
  });
  it.each(["start", "color", "count"])("promotes real %s output edits", async (kind) => {
    const fixture = await makeImportedFixture();
    const { project } = fixture;
    const clip = project.timeline.find((c) => c.phase === "SHOW");
    if (!clip) throw new Error("fixture needs SHOW");
    const layer = reseedReferenceSignatures(project, fixture.layer, context);
    const next = kind === "count" ? { ...project, droneCount: project.droneCount + 1 } : {
      ...project, timeline: project.timeline.map((c) => c.id !== clip.id ? c : kind === "start"
        ? { ...c, start: c.start + 1 } : { ...c, color: [1, 2, 3] as [number, number, number] }),
    };
    const result = reconcileReferenceLayer(next, layer, context);
    expect(result.promotions.map((p) => p.clipId)).toEqual(kind === "count"
      ? layer.bindings.map((b) => b.clipId) : [clip.id]);
  });
  it("migrates unchanged legacy evidence without resetting ownership", async () => {
    const { project, layer } = await makeImportedFixture();
    const legacy = { ...layer, bindings: layer.bindings.map((b) => ({ ...b,
      signature: legacyClipOutputSignature(project, b.clipId, context) ?? "missing" })) };
    const result = reconcileReferenceLayer(project, legacy, context);
    expect(result.changed).toBe(true);
    expect(result.promotions).toEqual([]);
    expect(result.layer.bindings.every((b) => b.signature.startsWith("reference-v2:"))).toBe(true);
  });
});