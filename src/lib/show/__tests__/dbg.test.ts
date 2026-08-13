import { it } from "vitest";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { composeFullShow } from "@/lib/show/fullshow";
it("dbg", () => {
  const p = createDefaultProject();
  p.formations.forEach((f) => {
    const uniq = new Set(f.points.map((q) => q.map((v) => v.toFixed(2)).join(",")));
    console.log(f.id, f.kind, f.points.length, "unique", uniq.size);
  });
  console.log(p.timeline.map((c) => [c.id, c.formationId, c.start, c.transition, c.hold, c.phase]));
  const plan = composeFullShow(p, { sampleRate: 10 });
  for (const t of [138, 140, 144, 148, 150]) {
    const pos = plan.trajectorySet.drones.slice(0, 4).map((d) => d.samples[Math.round(t * 10)]?.position);
    console.log(t, pos);
  }
  console.log(plan.showPlan.schedules[0]!.segments.map((s) => [s.clipId, s.phase, s.kind, s.start, s.end]));
});
