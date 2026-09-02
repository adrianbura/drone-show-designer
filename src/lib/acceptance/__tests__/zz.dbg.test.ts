import { describe, expect, it } from "vitest";
import { planFor } from "./support/productionFixtures";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { makeSceneLocalFormation } from "@/lib/show/formations";
import { addObject, emptyScene, upsertScene } from "@/lib/show/scene";
import type { ShowProject, TimelineClip } from "@/lib/show/types";

describe("dbg", () => {
  it("groups", () => {
    const base = createDefaultProject(150);
    const a = makeSceneLocalFormation("f-a", "A", "line", 60, base.area, { length: 90, rows: 1 });
    const b = makeSceneLocalFormation("f-b", "B", "line", 40, base.area, { length: 70, rows: 1 });
    const clip: TimelineClip = { id: "c", formationId: a.id, start: 0, transition: 20, hold: 20, easing: "minJerk", color: [255,255,255], effect: "solid", phase: "SHOW" };
    let project: ShowProject = { ...base, formations: [a, b], timeline: [clip] };
    let scene = emptyScene("c", "S");
    const r1 = addObject(project, scene, { source: { kind: "STATIC", formationId: a.id }, name: "A", requestedDroneCount: 60, position: [0,0,0] });
    const r2 = addObject(project, r1.scene, { source: { kind: "STATIC", formationId: b.id }, name: "B", requestedDroneCount: 40, position: [0, 40, 0] });
    project = upsertScene(project, r2.scene);
    const plan = planFor(project);
    console.log("plans", plan.participation.length); const p = plan.participation.find((x) => x.clipId === "c")!;
    console.log("groups", p.activeGroups.map((g) => ({ id: g.groupId, inst: g.instanceId, n: g.pointCount, asg: g.assignments.length })));
    console.log("droneGroups", new Set(p.drones.map((d) => d.groupId)).size);
    expect(true).toBe(true);
  });
});
