import { describe, expect, it } from "vitest";
import { importedFixture as makeImportedFixture } from "@/lib/acceptance/__tests__/support/productionFixtures";
import { reconcileReferenceLayer, reseedReferenceSignatures } from "../intervals";
import { clipOutputSignature, legacyClipOutputSignature } from "../signature";
import { applyAgentOp } from "@/lib/agent/operations";

const context = { assignmentStrategy: "hungarian", transitionOverrides: {} };

describe("owner-aware signature", () => {
  it("keeps every reference clip after global limit, altitude and assignment edits", async () => {
    const fixture = await makeImportedFixture();
    const project = fixture.project;
    const layer = reseedReferenceSignatures(project, fixture.layer, context);
    const next = {
      ...project,
      limits: { ...project.limits, maxVelocity: 20 },
      altitudes: { ...project.altitudes, show: 70 },
    };
    const result = reconcileReferenceLayer(next, layer, {
      ...context,
      assignmentStrategy: "greedy",
    });
    expect(result.promotions).toEqual([]);
    expect(result.layer.bindings.every((b) => b.owner === "REFERENCE")).toBe(true);
  });
  it("retains planner dependencies on global limits", async () => {
    const { project } = await makeImportedFixture();
    const clip = project.timeline[0];
    if (!clip) throw new Error("fixture needs clip");
    const ctx = { ...context, owner: "PLANNER" as const };
    expect(clipOutputSignature(project, clip.id, ctx)).not.toBe(
      clipOutputSignature(
        { ...project, limits: { ...project.limits, maxVelocity: 20 } },
        clip.id,
        ctx,
      ),
    );
  });
  it("moving one clip promotes only that clip, and Undo restores the original evidence", async () => {
    const { project, layer: original } = await makeImportedFixture();
    const layer = reseedReferenceSignatures(project, original, context);
    const clip = project.timeline.find((c) => c.phase === "SHOW");
    if (!clip) throw new Error("fixture needs SHOW");
    const moved = applyAgentOp(project, clip.id, { kind: "MOVE_SCENE", offset: [0, 0.03, 0] });
    if (!moved.ok || !moved.project) throw new Error("move refused");
    expect(
      reconcileReferenceLayer(moved.project, layer, context).promotions.map((p) => p.clipId),
    ).toEqual([clip.id]);
    const promoted = reconcileReferenceLayer(moved.project, layer, context).layer;
    expect(reconcileReferenceLayer(moved.project, promoted, context).changed).toBe(false);
    const changedLimits = {
      ...moved.project,
      limits: { ...moved.project.limits, maxVelocity: 20 },
    };
    const refreshed = reconcileReferenceLayer(changedLimits, promoted, context);
    expect(refreshed.changed).toBe(true);
    expect(refreshed.promotions).toEqual([]);
    expect(reconcileReferenceLayer(changedLimits, refreshed.layer, context).changed).toBe(false);
    expect(reconcileReferenceLayer(project, layer, context).promotions).toEqual([]);
  });
  it("legacy migration does not hide a first timing edit", async () => {
    const { project, layer } = await makeImportedFixture();
    const legacy = {
      ...layer,
      bindings: layer.bindings.map((b) => ({
        ...b,
        signature: legacyClipOutputSignature(project, b.clipId, context) ?? "missing",
      })),
    };
    const clip = project.timeline[0];
    if (!clip) throw new Error("fixture needs clip");
    const next = {
      ...project,
      timeline: project.timeline.map((c) => (c.id === clip.id ? { ...c, hold: c.hold + 1 } : c)),
    };
    expect(reconcileReferenceLayer(next, legacy, context).promotions.map((p) => p.clipId)).toEqual([
      clip.id,
    ]);
  });
  it.each(["start", "color", "count"])("promotes real %s output edits", async (kind) => {
    const fixture = await makeImportedFixture();
    const { project } = fixture;
    const clip = project.timeline.find((c) => c.phase === "SHOW");
    if (!clip) throw new Error("fixture needs SHOW");
    const layer = reseedReferenceSignatures(project, fixture.layer, context);
    const next =
      kind === "count"
        ? { ...project, droneCount: project.droneCount + 1 }
        : {
            ...project,
            timeline: project.timeline.map((c) =>
              c.id !== clip.id
                ? c
                : kind === "start"
                  ? { ...c, start: c.start + 1 }
                  : { ...c, color: [1, 2, 3] as [number, number, number] },
            ),
          };
    const result = reconcileReferenceLayer(next, layer, context);
    expect(result.promotions.map((p) => p.clipId)).toEqual(
      kind === "count" ? layer.bindings.map((b) => b.clipId) : [clip.id],
    );
  });
  it("migrates unchanged legacy evidence without resetting ownership", async () => {
    const { project, layer } = await makeImportedFixture();
    const legacy = {
      ...layer,
      bindings: layer.bindings.map((b) => ({
        ...b,
        signature: legacyClipOutputSignature(project, b.clipId, context) ?? "missing",
      })),
    };
    const result = reconcileReferenceLayer(project, legacy, context);
    expect(result.changed).toBe(true);
    expect(result.promotions).toEqual([]);
    expect(result.layer.bindings.every((b) => b.signature.startsWith("reference-v2:"))).toBe(true);
  });
});
