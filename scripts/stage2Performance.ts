/** Local-only reproducible analysis/memory benchmark; no browser/flight claims. */
import { performance } from "node:perf_hooks";
import { createDemoProject } from "../src/lib/show/defaultProject";
import { dynamicFromFormation, applyPreset } from "../src/lib/show/dynamic";
import { buildShowPlan } from "../src/lib/show/trajectory/schedule";
import { sampleTrajectorySet } from "../src/lib/show/trajectory/sampler";
import { validateShow } from "../src/lib/show/safety";

for (const count of [150, 300, 500]) {
  const base = createDemoProject(count);
  const formation = base.formations[0];
  const clip = base.timeline.find((c) => c.phase === "SHOW" || !c.phase);
  if (!formation || !clip) throw new Error("Benchmark requires formation and SHOW");
  const dynamic = applyPreset(
    dynamicFromFormation(formation, { id: "benchmark", duration: 6 }),
    "ORBIT",
    0.5,
  );
  const project = {
    ...base,
    dynamicFormations: [dynamic],
    timeline: base.timeline.map((c) =>
      c.id === clip.id ? { ...c, dynamicFormationId: dynamic.id } : c,
    ),
  };
  const started = performance.now();
  const plan = buildShowPlan(project);
  const composed = performance.now();
  const set = sampleTrajectorySet(plan, { sampleRate: 10 });
  const sampled = performance.now();
  const safety = validateShow(project, set, plan.drones);
  const ended = performance.now();
  console.log(
    JSON.stringify({
      count,
      seconds: plan.duration,
      rate: 10,
      planningMs: composed - started,
      samplingMs: sampled - composed,
      safetyMs: ended - sampled,
      analysisMs: ended - started,
      heapMiB: process.memoryUsage().heapUsed / 1024 / 1024,
      errors: safety.errors.length,
    }),
  );
}
