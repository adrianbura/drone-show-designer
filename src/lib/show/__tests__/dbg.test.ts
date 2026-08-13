import { it } from "vitest";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { buildDroneDefinitions } from "@/lib/show/drones";
import { validateHomePads } from "@/lib/show/fullshow";
it("dbg", () => {
  const p = createDefaultProject();
  const defs = buildDroneDefinitions(p);
  const key = new Map<string, string[]>();
  defs.forEach((d) => {
    const k = `${d.homePosition[0].toFixed(2)},${d.homePosition[2].toFixed(2)}`;
    key.set(k, [...(key.get(k) ?? []), d.id]);
  });
  console.log("dupes", [...key.entries()].filter(([, v]) => v.length > 1).slice(0, 5));
  console.log("f0", p.formations[0]!.kind, p.formations[0]!.points.length, p.droneCount);
  console.log(validateHomePads(p).issues.slice(0, 3));
});
