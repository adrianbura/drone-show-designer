/**
 * SIMULTANEOUS MULTI-FORMATION SCENES tests (Sprint 7.3.5).
 *
 * Verifies the invariants the sprint is built on: single-object migration is a
 * no-op, multi-object budgets are exact, physical subsets are disjoint, results
 * are deterministic, transforms never mutate assets, dynamic instances sample
 * independently, over-capacity scenes fail loudly and validation stays full fleet.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_AREA, DEFAULT_LIMITS, createDefaultProject, migrateProject } from "../defaultProject";
import { applyPreset, dynamicFromFormation } from "../dynamic/create";
import { makeFormation } from "../formations";
import { buildDroneDefinitions } from "../drones";
import { planFleetParticipation, resolveParticipationSettings } from "../participation";
import {
  addObject,
  alignObjects,
  applyInstanceTransform,
  createSceneEvaluator,
  duplicateObject,
  emptyScene,
  isCompositeScene,
  mirrorObjectX,
  objectProximityWarnings,
  patchObjectTransform,
  resolveSceneAt,
  sanitizeScenes,
  sceneBudget,
  sceneForClip,
  subsampleIndices,
  upsertScene,
  type FormationScene,
} from "../scene";
import { buildShowPlan } from "../trajectory/schedule";
import { serializeProject, parseProjectFile } from "@/lib/project";
import type { Formation, ShowProject, TimelineClip, Vector3Tuple } from "../types";

/** Project with a fleet of `fleet` drones and one SHOW clip per formation. */
function projectWith(fleet: number, formations: Formation[]): ShowProject {
  const base = createDefaultProject(fleet);
  const clip: TimelineClip = {
    id: "clip-scene",
    formationId: formations[0]!.id,
    start: 0,
    transition: 8,
    hold: 6,
    easing: "minJerk",
    color: [255, 255, 255],
    effect: "solid",
    phase: "SHOW",
  };
  return {
    ...base,
    formations: [...base.formations, ...formations],
    timeline: [clip],
  };
}

function grid(id: string, count: number, y: number): Formation {
  return makeFormation(id, `grid-${id}`, "grid", count, DEFAULT_AREA, { altitude: y });
}

/** Scene composed from N formations with explicit drone budgets. */
function composed(
  project: ShowProject,
  entries: readonly { formation: Formation; count?: number; position?: Vector3Tuple }[],
): { project: ShowProject; scene: FormationScene } {
  let scene = emptyScene("clip-scene", "Scene 01");
  for (const entry of entries) {
    const result = addObject(project, scene, {
      source: { kind: "STATIC", formationId: entry.formation.id },
      name: entry.formation.name,
      ...(entry.count ? { requestedDroneCount: entry.count } : {}),
      ...(entry.position ? { position: entry.position } : {}),
    });
    scene = result.scene;
  }
  return { project: upsertScene(project, scene), scene };
}

describe("scene migration (single object)", () => {
  it("synthesises one identity object for a legacy clip", () => {
    const f = grid("f-legacy", 40, 30);
    const project = projectWith(60, [f]);
    const scene = sceneForClip(project, project.timeline[0]!);
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0]!.transform.scale).toBe(1);
    expect(isCompositeScene(project, project.timeline[0]!)).toBe(false);
    const resolved = resolveSceneAt(project, scene, 0);
    expect(resolved.points).toEqual(f.points);
  });

  it("plans an identical show with and without the synthesised scene", () => {
    const f = grid("f-same", 30, 30);
    const project = projectWith(48, [f]);
    const a = buildShowPlan(project);
    const b = buildShowPlan(migrateProject(JSON.parse(JSON.stringify(project))));
    expect(b.schedules[0]!.segments.length).toBe(a.schedules[0]!.segments.length);
    expect(b.drones.length).toBe(a.drones.length);
  });
});

describe("scene drone budget", () => {
  it("accounts two objects exactly against the fleet", () => {
    const pigeon = grid("f-pigeon", 150, 40);
    const heart = grid("f-heart", 80, 40);
    const base = projectWith(500, [pigeon, heart]);
    const { project, scene } = composed(base, [
      { formation: pigeon, count: 150 },
      { formation: heart, count: 80 },
    ]);
    const budget = sceneBudget(project, scene, 500);
    expect(budget.active).toBe(230);
    expect(budget.availableDrones).toBe(270);
    expect(budget.over).toBe(0);
    expect(budget.overCapacity).toBe(false);
  });

  it("accounts three objects exactly", () => {
    const pigeon = grid("f-p3", 150, 40);
    const heart = grid("f-h3", 80, 40);
    const stars = grid("f-s3", 70, 60);
    const base = projectWith(500, [pigeon, heart, stars]);
    const { project, scene } = composed(base, [
      { formation: pigeon, count: 150 },
      { formation: heart, count: 80 },
      { formation: stars, count: 70 },
    ]);
    const budget = sceneBudget(project, scene, 500);
    expect(budget.active).toBe(300);
    expect(budget.availableDrones).toBe(200);
  });

  it("reports over-capacity instead of truncating", () => {
    const a = grid("f-a", 300, 40);
    const b = grid("f-b", 250, 40);
    const base = projectWith(500, [a, b]);
    const { project, scene } = composed(base, [
      { formation: a, count: 300 },
      { formation: b, count: 250 },
    ]);
    const budget = sceneBudget(project, scene, 500);
    expect(budget.active).toBe(550);
    expect(budget.over).toBe(50);
    expect(budget.overCapacity).toBe(true);
    // The scheduler refuses the scene loudly; nothing is silently dropped.
    const plan = buildShowPlan(project);
    expect(plan.errors.some((e) => e.code === "INVALID_FORMATION")).toBe(true);
  });
});

describe("multi-target assignment", () => {
  const pigeon = grid("f-mp", 150, 40);
  const heart = grid("f-mh", 80, 40);
  const stars = grid("f-ms", 70, 70);
  const base = projectWith(500, [pigeon, heart, stars]);
  const { project, scene } = composed(base, [
    { formation: pigeon, count: 150, position: [0, 0, 0] },
    { formation: heart, count: 80, position: [-60, 0, 0] },
    { formation: stars, count: 70, position: [60, 0, 0] },
  ]);
  const evaluator = createSceneEvaluator(project, scene);
  const drones = buildDroneDefinitions(project);

  const planScene = () =>
    planFleetParticipation({
      drones,
      current: drones.map((d) => d.homePosition),
      scene: {
        clipId: scene.id,
        formationId: null,
        points: evaluator.positionsAt(0),
        pointIds: evaluator.pointIds,
        groups: evaluator.groups,
      },
      settings: resolveParticipationSettings(),
      limits: DEFAULT_LIMITS,
      area: project.area,
    });

  it("emits one active group per visual object with exact counts", () => {
    const plan = planScene();
    expect(plan.activeGroups).toHaveLength(3);
    expect(plan.activeGroups.map((g) => g.assignments.length)).toEqual([150, 80, 70]);
    expect(plan.counts.active).toBe(300);
    expect(plan.counts.active + plan.counts.preposition + plan.counts.hold + plan.counts.reserve + plan.counts.manual).toBe(500);
  });

  it("allocates disjoint physical subsets", () => {
    const plan = planScene();
    const seen = new Set<string>();
    for (const group of plan.activeGroups) {
      for (const a of group.assignments) {
        expect(seen.has(a.droneId)).toBe(false);
        seen.add(a.droneId);
      }
    }
    expect(seen.size).toBe(300);
  });

  it("is deterministic across repeated runs", () => {
    const a = planScene();
    const b = planScene();
    expect(b.drones.map((d) => `${d.droneId}:${d.role}:${d.groupId ?? ""}:${d.formationPointIndex ?? -1}`)).toEqual(
      a.drones.map((d) => `${d.droneId}:${d.role}:${d.groupId ?? ""}:${d.formationPointIndex ?? -1}`),
    );
    expect(b.provenance.revision).toBe(a.provenance.revision);
  });

  it("scales to a 1200-drone fleet with four objects", () => {
    const earth = grid("f-earth", 700, 60);
    const orbits = [grid("f-o1", 80, 80), grid("f-o2", 80, 90), grid("f-o3", 80, 100)];
    const big = projectWith(1200, [earth, ...orbits]);
    const { project: p, scene: s } = composed(big, [
      { formation: earth, count: 700, position: [0, 0, 0] },
      { formation: orbits[0]!, count: 80, position: [-90, 0, 0] },
      { formation: orbits[1]!, count: 80, position: [90, 0, 0] },
      { formation: orbits[2]!, count: 80, position: [0, 0, 90] },
    ]);
    const budget = sceneBudget(p, s, 1200);
    expect(budget.active).toBe(940);
    expect(budget.availableDrones).toBe(260);
    const ev = createSceneEvaluator(p, s);
    const fleetDrones = buildDroneDefinitions(p);
    const plan = planFleetParticipation({
      drones: fleetDrones,
      current: fleetDrones.map((d) => d.homePosition),
      scene: {
        clipId: s.id,
        formationId: null,
        points: ev.positionsAt(0),
        pointIds: ev.pointIds,
        groups: ev.groups,
      },
      settings: resolveParticipationSettings(),
      limits: DEFAULT_LIMITS,
      area: p.area,
    });
    expect(plan.counts.active).toBe(940);
    expect(plan.drones).toHaveLength(1200);
    expect(new Set(plan.drones.map((d) => d.droneId)).size).toBe(1200);
  });
});

describe("object transforms", () => {
  const pigeon = grid("f-tp", 40, 40);
  const heart = grid("f-th", 20, 40);

  it("moves one object without touching the other or the asset", () => {
    const base = projectWith(120, [pigeon, heart]);
    const { project, scene } = composed(base, [
      { formation: pigeon, position: [0, 0, 0] },
      { formation: heart, position: [0, 0, 0] },
    ]);
    const before = resolveSceneAt(project, scene, 0);
    const moved = patchObjectTransform(scene, scene.objects[1]!.id, { position: [20, 0, 0] });
    const after = resolveSceneAt(project, moved, 0);
    const g = before.groups[1]!;
    for (let i = g.offset; i < g.offset + g.pointCount; i++) {
      expect(after.points[i]![0] - before.points[i]![0]).toBeCloseTo(20, 6);
    }
    // Pigeon points and the library assets are untouched.
    for (let i = 0; i < before.groups[0]!.pointCount; i++) {
      expect(after.points[i]).toEqual(before.points[i]);
    }
    expect(project.formations.find((f) => f.id === heart.id)!.points).toEqual(heart.points);
  });

  it("rotates around the instance pivot deterministically", () => {
    const pivot: Vector3Tuple = [0, 0, 0];
    const rotated = applyInstanceTransform(
      [10, 0, 0],
      { position: [0, 0, 0], rotationDeg: [0, 90, 0], scale: 1 },
      pivot,
    );
    expect(rotated[0]).toBeCloseTo(0, 6);
    expect(rotated[2]).toBeCloseTo(-10, 6);
  });

  it("scales the instance, never the asset", () => {
    const base = projectWith(120, [heart]);
    const { project, scene } = composed(base, [{ formation: heart, position: [0, 0, 0] }]);
    const scaled = patchObjectTransform(scene, scene.objects[0]!.id, { scale: 1.5 });
    const a = resolveSceneAt(project, scene, 0);
    const b = resolveSceneAt(project, scaled, 0);
    const centre = a.points.reduce((s, p) => s + p[0], 0) / a.points.length;
    const spanA = Math.max(...a.points.map((p) => Math.abs(p[0] - centre)));
    const spanB = Math.max(...b.points.map((p) => Math.abs(p[0] - centre)));
    expect(spanB / spanA).toBeCloseTo(1.5, 5);
    expect(project.formations.find((f) => f.id === heart.id)!.points).toEqual(heart.points);
  });

  it("mirrors an instance without mutating the asset", () => {
    const base = projectWith(120, [heart]);
    const { project, scene } = composed(base, [{ formation: heart, position: [0, 0, 0] }]);
    const mirrored = mirrorObjectX(scene, scene.objects[0]!.id);
    expect(mirrored.objects[0]!.transform.mirrorX).toBe(true);
    expect(project.formations.find((f) => f.id === heart.id)!.points).toEqual(heart.points);
  });

  it("duplicates an instance, sharing the asset with a new id", () => {
    const base = projectWith(120, [heart]);
    const { project: _p, scene } = composed(base, [{ formation: heart }]);
    const { scene: withCopy, objectId } = duplicateObject(scene, scene.objects[0]!.id, [30, 0, 0]);
    expect(withCopy.objects).toHaveLength(2);
    expect(objectId).not.toBe(scene.objects[0]!.id);
    expect(withCopy.objects[1]!.source).toEqual(scene.objects[0]!.source);
    expect(withCopy.objects[1]!.transform.position[0]).toBe(30);
  });

  it("aligns and distributes object centres", () => {
    const base = projectWith(200, [pigeon, heart]);
    const { project, scene } = composed(base, [
      { formation: pigeon, position: [0, 0, 0] },
      { formation: heart, position: [0, 40, 0] },
    ]);
    const aligned = alignObjects(project, scene, "CENTER_Y");
    const ys = aligned.objects.map((o) => o.transform.position[1]);
    expect(ys[0]).toBeCloseTo(20, 6);
    expect(ys[1]).toBeCloseTo(20, 6);
  });
});

describe("dynamic objects in a scene", () => {
  it("samples a dynamic and a static object simultaneously", () => {
    const wing = grid("f-wing", 40, 40);
    const heart = grid("f-static-heart", 20, 40);
    const base = projectWith(120, [wing, heart]);
    const dynamic = applyPreset(dynamicFromFormation(wing, { id: "dyn-wing", name: "Pigeon", seed: 7 }), "PULSE");
    let project: ShowProject = { ...base, dynamicFormations: [dynamic] };
    let scene = emptyScene("clip-scene", "Mixed");
    scene = addObject(project, scene, {
      source: { kind: "DYNAMIC", dynamicFormationId: dynamic.id },
      name: "Pigeon",
      position: [0, 0, 0],
    }).scene;
    scene = addObject(project, scene, {
      source: { kind: "STATIC", formationId: heart.id },
      name: "Heart",
      position: [40, 0, 0],
    }).scene;
    project = upsertScene(project, scene);
    const evaluator = createSceneEvaluator(project, scene);
    expect(evaluator.animated).toBe(true);
    expect(evaluator.pointCount).toBe(60);
    const t0 = evaluator.positionsAt(0);
    const t1 = evaluator.positionsAt(dynamic.duration / 4);
    // The dynamic object moves; the static one does not.
    expect(t1.slice(0, 40)).not.toEqual(t0.slice(0, 40));
    expect(t1.slice(40)).toEqual(t0.slice(40));
  });

  it("gives two instances of one dynamic asset independent phases", () => {
    const wing = grid("f-wing2", 30, 40);
    const base = projectWith(120, [wing]);
    const dynamic = applyPreset(dynamicFromFormation(wing, { id: "dyn-wing2", name: "Butterfly", seed: 3 }), "WAVE");
    let project: ShowProject = { ...base, dynamicFormations: [dynamic] };
    let scene = emptyScene("clip-scene", "Butterflies");
    scene = addObject(project, scene, {
      source: { kind: "DYNAMIC", dynamicFormationId: dynamic.id },
      name: "Butterfly A",
      position: [0, 0, 0],
    }).scene;
    scene = addObject(project, scene, {
      source: { kind: "DYNAMIC", dynamicFormationId: dynamic.id },
      name: "Butterfly B",
      position: [0, 0, 0],
    }).scene;
    scene = {
      ...scene,
      objects: scene.objects.map((o, i) =>
        i === 1 ? { ...o, animation: { phaseCycles: 0.5 } } : o,
      ),
    };
    project = upsertScene(project, scene);
    const evaluator = createSceneEvaluator(project, scene);
    const points = evaluator.positionsAt(0.7);
    const a = points.slice(0, 30);
    const b = points.slice(30);
    expect(a).not.toEqual(b);
    // Deterministic: sampling again yields identical geometry.
    expect(createSceneEvaluator(project, scene).positionsAt(0.7)).toEqual(points);
  });
});

describe("full-fleet planning and validation", () => {
  it("plans every drone of a composed scene exactly once", () => {
    const pigeon = grid("f-fp", 150, 40);
    const heart = grid("f-fh", 80, 40);
    const base = projectWith(300, [pigeon, heart]);
    const { project } = composed(base, [
      { formation: pigeon, count: 150, position: [0, 0, 0] },
      { formation: heart, count: 80, position: [-70, 0, 0] },
    ]);
    const plan = buildShowPlan(project);
    expect(plan.schedules).toHaveLength(300);
    expect(plan.schedules.every((s) => s.segments.length > 0)).toBe(true);
    const participation = plan.participation.find((p) => p.clipId === "clip-scene");
    expect(participation).toBeDefined();
    expect(participation!.counts.active).toBe(230);
    expect(participation!.counts.fleet).toBe(300);
    expect(participation!.activeGroups).toHaveLength(2);
  });

  it("warns when two object footprints overlap (advisory only)", () => {
    const a = grid("f-ova", 40, 40);
    const b = grid("f-ovb", 40, 40);
    const base = projectWith(120, [a, b]);
    const { project, scene } = composed(base, [
      { formation: a, position: [0, 0, 0] },
      { formation: b, position: [0, 0, 0] },
    ]);
    const warnings = objectProximityWarnings(resolveSceneAt(project, scene, 0), DEFAULT_LIMITS);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.overlapping).toBe(true);
  });
});

describe("scene persistence", () => {
  it("round-trips the full object hierarchy through save / open", () => {
    const pigeon = grid("f-sp", 60, 40);
    const heart = grid("f-sh", 30, 40);
    const base = projectWith(200, [pigeon, heart]);
    let { project, scene } = composed(base, [
      { formation: pigeon, count: 60, position: [0, 0, 0] },
      { formation: heart, count: 30, position: [-30, 0, 0] },
    ]);
    const { scene: withCopy } = duplicateObject(scene, scene.objects[1]!.id, [60, 0, 0]);
    scene = patchObjectTransform(withCopy, withCopy.objects[2]!.id, {
      rotationDeg: [0, 0, 15],
      scale: 1.2,
    });
    project = upsertScene(project, scene);

    const reopened = parseProjectFile(JSON.stringify(serializeProject(project))).project;
    const restored = reopened.scenes!.find((s) => s.id === "clip-scene")!;
    expect(restored.objects).toHaveLength(3);
    expect(restored.objects.map((o) => o.name)).toEqual(scene.objects.map((o) => o.name));
    expect(restored.objects[2]!.transform.rotationDeg).toEqual([0, 0, 15]);
    expect(restored.objects[2]!.transform.scale).toBe(1.2);
    expect(resolveSceneAt(reopened, restored, 0).points).toEqual(
      resolveSceneAt(project, scene, 0).points,
    );
  });

  it("drops scenes from an unknown future schema instead of guessing", () => {
    const sanitized = sanitizeScenes([
      { id: "c1", name: "x", schemaVersion: 99, objects: [{ id: "o", source: { kind: "STATIC", formationId: "f" }, transform: {} }] },
    ]);
    expect(sanitized).toHaveLength(0);
  });
});

describe("deterministic sub-sampling", () => {
  it("keeps requested budgets exact and unique", () => {
    const indices = subsampleIndices(150, 40);
    expect(indices).toHaveLength(40);
    expect(new Set(indices).size).toBe(40);
    expect(subsampleIndices(150, 40)).toEqual(indices);
    expect(subsampleIndices(40, 80)).toHaveLength(40);
  });
});
