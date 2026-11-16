import { describe, expect, it } from "vitest";
import { importedFixture as acceptanceFixture, importArchiveFixture } from "@/lib/acceptance/__tests__/support/productionFixtures";
import { buildSyntheticEssp } from "../../codec";
import { prepareImportedEdit } from "../editTransaction";
import { taperedKinematics, taperWeight } from "../taper";
import { migrateReferenceLayer } from "../layer";
import { resolveReferenceIntervals } from "../intervals";
import { analyzeFullShow } from "@/lib/show/fullshow";
import { buildShowPlan } from "@/lib/show/trajectory";
import { buildEsspExportPackage } from "@/lib/adapters/esspExport";
import { buildReferenceShow } from "../../reference";
import { sampleEffectiveTrajectorySet } from "@/lib/show/fullshow/effective";
import { splicedTrajectorySamples } from "../splice";
import { sampleReferenceShow } from "../../playback";

const ctx = { assignmentStrategy: "nearestNeighbor" as const, transitionOverrides: {} };
async function importedFixture() {
  return importArchiveFixture(Array.from({length:4},(_,i)=>{
    const xyz=Array.from({length:481},(_,f)=>{
      const t=f/8,u=t<15?Math.min(1,t/15):t>45?Math.max(0,(60-t)/15):1;
      const s=u*u*u*(10+u*(-15+6*u));
      return [(i%2)*600-300,Math.floor(i/2)*600-300,Math.round(2500*s)];
    });
    const bytes=buildSyntheticEssp({xyz,rgb:Array.from({length:721},()=>[100,50,200])});
    return {name:`${i+1}.essp`,bytes};
  }));
}
describe("tapered imported edit transaction", () => {
  it.each(["MOVE_SCENE", "ROTATE_SCENE", "SCALE_SCENE"] as const)(
    "preserves edges, neighbours, RGB and round trip for %s",
    async (kind) => {
      const { project, show, layer } = await importedFixture();
      const binding = layer.bindings.find((b) => b.kind === "SCENE" && b.sourceClassification === "STATIC_FORMATION");
      if (!binding) throw new Error("fixture needs scene");
      const before = JSON.stringify({ project, layer });
      const op =
        kind === "MOVE_SCENE"
          ? { kind, offset: [0, 0.03, 0] as const }
          : kind === "ROTATE_SCENE"
            ? { kind, axis: "Y" as const, degrees: 0.1 }
            : { kind, factor: 1.001 };
      const prepared = prepareImportedEdit(project, show, layer, [binding.clipId], op, ctx);
      if (!prepared.ok) throw new Error(prepared.reason);
      const tx = prepared.transaction;
      expect(JSON.stringify({ project, layer })).toBe(before);
      expect(tx.layer.bindings.filter((b) => b.owner === "PLANNER").map((b) => b.clipId)).toEqual([
        binding.clipId,
      ]);
      const next = tx.layer.bindings.find((b) => b.order === binding.order + 1);
      expect(
        resolveReferenceIntervals(tx.layer)
          .filter((i) => i.clipId === next?.clipId)
          .every((i) => i.owner === "REFERENCE"),
      ).toBe(true);
      for (const time of [tx.edit.start, tx.edit.end])
        for (const drone of show.drones) {
          expect(taperedKinematics(drone, time, show.timing, tx.layer.motionEdits ?? [])).toEqual(
            taperedKinematics(drone, time, show.timing, []),
          );
        }
      expect(taperWeight((tx.edit.start + tx.edit.end) / 2, tx.edit)).toBe(1);
      const restored = migrateReferenceLayer(JSON.parse(JSON.stringify(tx.layer)));
      expect(restored.motionEdits).toEqual(tx.layer.motionEdits);
      const analyzed = analyzeFullShow(tx.project, {
        ...ctx,
        sampleRate: 8,
        reference: { show, layer: tx.layer },
      });
      expect(analyzed.report.splice?.ok).toBe(true);
      const plan = buildShowPlan(tx.project, ctx);
      const exported = buildEsspExportPackage({
        project: tx.project,
        plan,
        reference: { show, layer: tx.layer },
        fullShow: analyzed.report,
        fullShowStale: false,
      });
      expect(exported.blockers).toEqual([]);
      expect(exported.ok).toBe(true);
      const back = await buildReferenceShow(
        exported.files.map((f) => ({ name: f.name, bytes: f.bytes })),
      );
      expect(back.timing).toEqual(show.timing);
      const set = sampleEffectiveTrajectorySet(plan, {
        sampleRate: 8,
        startTime: 0,
        endTime: plan.duration,
        reference: { show, layer: tx.layer },
      }).set;
      for (let f = 0; f < show.timing.positionSampleCount; f++) {
        const t = f / 8,
          actual = sampleReferenceShow(back, t);
        const live = splicedTrajectorySamples(
          show,
          tx.layer,
          t,
          set.drones.map((d) => d.samples[f]).filter((s) => s !== undefined),
        ).samples;
        actual.forEach((s, i) => {
          const expected = live[i]?.position;
          if (!expected) throw new Error("missing sample");
          expect(Math.hypot(...s.position.map((v, a) => v - (expected[a] ?? 0)))).toBeLessThan(
            0.009,
          );
          if (t < tx.edit.start || t >= tx.edit.end)
            expect([...(back.drones[i]?.positionSamples.slice(f * 3, f * 3 + 3) ?? [])]).toEqual([
              ...(show.drones[i]?.positionSamples.slice(f * 3, f * 3 + 3) ?? []),
            ]);
        });
      }
      back.drones.forEach((d, i) => expect(d.rgbSamples).toEqual(show.drones[i]?.rgbSamples));
      expect(tx.baselineLayer).toBe(layer);
      expect(tx.baselineProject).toBe(project);
    },
  );
  it("refuses an infeasible offset without modifying source/history", async () => {
    const { project, show, layer } = await acceptanceFixture();
    const b = layer.bindings.find((b) => b.kind === "SCENE");
    if (!b) throw new Error("scene");
    const result = prepareImportedEdit(
      project,
      show,
      layer,
      [b.clipId],
      { kind: "MOVE_SCENE", offset: [0, 200, 0] },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("EDIT_TIME_BUDGET_EXCEEDED");
    expect(layer.motionEdits).toBeUndefined();
  });
  it("fails closed on malformed saved motion instead of dropping it", async () => {
    const { layer } = await importedFixture();
    expect(() =>
      migrateReferenceLayer({ ...layer, motionEdits: [{ kind: "MOVE_SCENE" }] }),
    ).toThrow();
  });
});
