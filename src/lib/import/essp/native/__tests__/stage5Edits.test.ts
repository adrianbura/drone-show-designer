import { describe, expect, it } from "vitest";
import { importArchiveFixture } from "@/lib/acceptance/__tests__/support/productionFixtures";
import { buildSyntheticEssp } from "../../codec";
import { prepareImportedEdit, RAMP_FRACTIONS } from "../editTransaction";
import { importedEditRefusal, taperedEditExplanation } from "../editCopy";
import { taperedKinematics, taperedPosition } from "../taper";
import { migrateReferenceLayer } from "../layer";
import { analyzeFullShow } from "@/lib/show/fullshow";
import { buildShowPlan } from "@/lib/show/trajectory";
import { buildEsspExportPackage } from "@/lib/adapters/esspExport";
import type { AgentOp } from "@/lib/agent/operations";

const ctx = { assignmentStrategy: "nearestNeighbor" as const, transitionOverrides: {} };
async function fixture() {
  return importArchiveFixture(
    Array.from({ length: 6 }, (_, i) => {
      const xyz = Array.from({ length: 481 }, (_, f) => {
        const t = f / 8,
          u = t < 15 ? Math.min(1, t / 15) : t > 45 ? Math.max(0, (60 - t) / 15) : 1;
        const s = u * u * u * (10 + u * (-15 + 6 * u));
        const drift = t < 20 ? 0 : t < 30 ? (t - 20) * 50 : 500;
        return [(i % 3) * 400 - 400 + drift, Math.floor(i / 3) * 400, Math.round(3000 * s)];
      });
      return {
        name: `${i + 1}.essp`,
        bytes: buildSyntheticEssp({ xyz, rgb: Array.from({ length: 721 }, () => [100, 50, 200]) }),
      };
    }),
  );
}
function scenes(layer: Awaited<ReturnType<typeof fixture>>["layer"]) {
  return layer.bindings.filter((b) => b.kind === "SCENE").sort((a, b) => a.order - b.order);
}
function exportOf(f: Awaited<ReturnType<typeof fixture>>, layer: typeof f.layer) {
  const analyzed = analyzeFullShow(f.project, { ...ctx, sampleRate: 8, reference: { show: f.show, layer } });
  return {
    analyzed,
    pkg: buildEsspExportPackage({
      project: f.project,
      plan: buildShowPlan(f.project, ctx),
      reference: { show: f.show, layer },
      fullShow: analyzed.report,
      fullShowStale: false,
    }),
  };
}
const move = (y: number): AgentOp => ({ kind: "MOVE_SCENE", offset: [0, y, 0] });

describe("Stage 5 — realistic tapered edits", () => {
  it("lengthens the ramp only when the quarter ramp exceeds the limits, staying within them", async () => {
    const f = await fixture();
    const target = scenes(f.layer).find((b) => b.referenceEnd - b.referenceStart > 4)!;
    let lengthened = null;
    for (const m of [0.5, 1, 2, 4, 8, 16, 32]) {
      const r = prepareImportedEdit(f.project, f.show, f.layer, [target.clipId], move(m), ctx);
      if (!r.ok) break;
      const span = r.transaction.edit.end - r.transaction.edit.start - 2 * r.transaction.edit.guardSeconds;
      if (r.transaction.edit.rampSeconds > span * RAMP_FRACTIONS[0] + 1e-9) {
        lengthened = r.transaction;
        break;
      }
      expect(r.transaction.edit.rampSeconds).toBeCloseTo(span * RAMP_FRACTIONS[0], 9);
    }
    expect(lengthened).not.toBeNull();
    expect(lengthened!.maxVelocity).toBeLessThanOrEqual(f.project.limits.maxVelocity);
    expect(lengthened!.maxAcceleration).toBeLessThanOrEqual(f.project.limits.maxAcceleration);
  });

  it("refuses an over-budget edit with a feasible maximum that is itself feasible", async () => {
    const f = await fixture();
    const target = scenes(f.layer)[0]!;
    const r = prepareImportedEdit(f.project, f.show, f.layer, [target.clipId], move(200), ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("EDIT_TIME_BUDGET_EXCEEDED");
    expect(r.feasible?.kind).toBe("MOVE_SCENE");
    expect(r.feasible!.magnitude).toBeGreaterThan(0);
    expect(r.feasible!.magnitude).toBeLessThan(200);
    expect(prepareImportedEdit(f.project, f.show, f.layer, [target.clipId], move(r.feasible!.magnitude * 0.98), ctx).ok).toBe(true);
    expect(importedEditRefusal(r, "ro")).toContain("mutarea maximă fezabilă ≈");
    expect(importedEditRefusal(r, "en")).toContain("max feasible move ≈");
  });

  it("explains the taper with ramp and hold seconds in RO and EN", async () => {
    const f = await fixture();
    const r = prepareImportedEdit(f.project, f.show, f.layer, [scenes(f.layer)[0]!.clipId], move(0.1), ctx);
    if (!r.ok) throw new Error(r.reason);
    const ramp = r.transaction.edit.rampSeconds.toFixed(2);
    expect(taperedEditExplanation(r.transaction, "ro")).toContain(`lin în ${ramp} s`);
    expect(taperedEditExplanation(r.transaction, "en")).toContain(`smoothly over ${ramp} s`);
  });

  it("stacks a different op on the same scene around the moved pose, with full validation", async () => {
    const f = await fixture();
    const id = scenes(f.layer)[0]!.clipId;
    const a = prepareImportedEdit(f.project, f.show, f.layer, [id], move(0.2), ctx);
    if (!a.ok) throw new Error(a.reason);
    const b = prepareImportedEdit(f.project, f.show, a.transaction.layer, [id], { kind: "ROTATE_SCENE", axis: "Y", degrees: 2 }, ctx);
    if (!b.ok) throw new Error(b.reason);
    expect(b.transaction.layer.motionEdits).toHaveLength(2);
    const mid = (b.transaction.edit.start + b.transaction.edit.end) / 2;
    const moved = f.show.drones.map((d) => taperedPosition(d, mid, f.show.timing, a.transaction.layer.motionEdits!));
    const centroidY = moved.reduce((s, p) => s + p[1], 0) / moved.length;
    expect(b.transaction.edit.pivot[1]).toBeCloseTo(centroidY, 9);
    // Same op twice also stacks (offsets add).
    const c = prepareImportedEdit(f.project, f.show, a.transaction.layer, [id], move(0.2), ctx);
    if (!c.ok) throw new Error(c.reason);
    const p = taperedPosition(f.show.drones[0]!, mid, f.show.timing, c.transaction.layer.motionEdits!);
    const p0 = taperedPosition(f.show.drones[0]!, mid, f.show.timing, []);
    expect(p[1] - p0[1]).toBeCloseTo(0.4, 9);
    const { analyzed, pkg } = exportOf(f, b.transaction.layer);
    expect(analyzed.report.splice?.ok).toBe(true);
    expect(pkg.ok).toBe(true);
  });

  it("refuses a partial-overlap edit instead of mixing ramps", async () => {
    const f = await fixture();
    const [s1, s2] = scenes(f.layer);
    const a = prepareImportedEdit(f.project, f.show, f.layer, [s1!.clipId, s2!.clipId], move(0.1), ctx);
    if (!a.ok) throw new Error(a.reason);
    const b = prepareImportedEdit(f.project, f.show, a.transaction.layer, [s1!.clipId], move(0.1), ctx);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("OVERLAPPING_EDIT_INTERVAL");
  });

  it("edits two adjacent scenes in sequence with exact shared edge", async () => {
    const f = await fixture();
    const [s1, s2] = scenes(f.layer);
    const a = prepareImportedEdit(f.project, f.show, f.layer, [s1!.clipId], move(0.1), ctx);
    if (!a.ok) throw new Error(a.reason);
    const b = prepareImportedEdit(f.project, f.show, a.transaction.layer, [s2!.clipId], move(-0.1), ctx);
    if (!b.ok) throw new Error(b.reason);
    const edge = s1!.referenceEnd;
    for (const d of f.show.drones)
      expect(taperedKinematics(d, edge, f.show.timing, b.transaction.layer.motionEdits!)).toEqual(
        taperedKinematics(d, edge, f.show.timing, []),
      );
    const { analyzed, pkg } = exportOf(f, b.transaction.layer);
    expect(analyzed.report.splice?.ok).toBe(true);
    expect(pkg.ok).toBe(true);
  });

  it("save → open → export of an edited show is byte-identical to the live export", async () => {
    const f = await fixture();
    const a = prepareImportedEdit(f.project, f.show, f.layer, [scenes(f.layer)[0]!.clipId], move(0.3), ctx);
    if (!a.ok) throw new Error(a.reason);
    const live = exportOf(f, a.transaction.layer).pkg;
    const reopened = migrateReferenceLayer(JSON.parse(JSON.stringify(a.transaction.layer)));
    const again = exportOf(f, reopened).pkg;
    expect(live.ok && again.ok).toBe(true);
    expect(again.files.map((x) => [x.name, Array.from(x.bytes)])).toEqual(
      live.files.map((x) => [x.name, Array.from(x.bytes)]),
    );
  });
});
