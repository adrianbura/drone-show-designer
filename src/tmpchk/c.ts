import { createDefaultProject } from "../lib/show/defaultProject";
import { buildShowPlan } from "../lib/show/trajectory";
import { buildPreShowOverlay } from "../lib/show/preshow/overlay";
import { resolvePreShowConfig } from "../lib/show/preshow/config";
for (const n of [200,137,500]) {
  const base = createDefaultProject(n);
  const p = { ...base, preShow: { ...resolvePreShowConfig(base.preShow), enabled: true } };
  const plan = buildShowPlan(p as any);
  const ps = plan.preShow!;
  const ov = buildPreShowOverlay(ps);
  console.log(n, ps.layout.pads.length, ps.staging.targets.length, ov.launch.pads.length, ov.staging.targets.length, ps.layout.rows+"x"+ps.layout.columns);
}
