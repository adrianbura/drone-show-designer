import { it } from "vitest";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { composeFullShow } from "@/lib/show/fullshow";
it("dbg", () => {
  const p = createDefaultProject();
  const plan = composeFullShow(p, { sampleRate: 10 });
  const idx = (id: string) => plan.trajectorySet.drones.findIndex((d) => d.droneId === id);
  for (const id of ["DRN-005", "DRN-006", "DRN-021"]) {
    const i = idx(id);
    const s = plan.trajectorySet.drones[i]!.samples;
    const k = Math.round(144 * 10);
    console.log(id, "home", plan.drones[i]!.homePosition, "t144", s[k]!.position, "last", s[s.length-1]!.position);
  }
});
