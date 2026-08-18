/**
 * COMPLEX 200-DRONE INTEGRATION PROJECT (audit sections B–H, U).
 *
 * One project, three scenes, every subsystem together. Asserts fleet accounting,
 * exact-N, disjoint multi-object subsets, finite geometry, dynamic wing groups,
 * pre-show/landing coverage and asset immutability.
 */
import { describe, expect, it } from "vitest";

import { buildComplexProject, pigeonAssets } from "./fixtures";
import { expectFinite, expectFleetAccounting, expectProjectStructurallySound, participationForClip } from "./invariants";
import { composePreShow, launchHomePositions, resolvePreShowConfig } from "../../preshow";
import { buildDroneDefinitions } from "../../drones";
import { composeFullShow, computeAnalysisRevision } from "../../fullshow";
import { sampleDynamicFormation } from "../../dynamic/sampler";
import { createSceneEvaluator, patchObjectTransform, sceneForClip, upsertScene } from "../../scene";
import { buildShowPlan } from "../../trajectory/schedule";
import type { Vector3Tuple } from "../../types";

const { project, pigeonPointCount } = buildComplexProject(200, 150);
const revisionSettings = { sampleRate: 10, assignmentStrategy: "nearestNeighbor" as const };

describe("complex 200-drone project", () => {
  it("is structurally sound end to end", () => {
    expectProjectStructurallySound(project, "complex-200");
  });

  it("scene 1 flies 150 active drones and accounts for all 200", () => {
    const plan = participationForClip(project, project.timeline[0]!);
    expect(plan.counts.active).toBe(pigeonPointCount);
    expectFleetAccounting(plan, 200, "scene-1");
  });

  it("scene 2 flies 120 active drones across two disjoint objects", () => {
    const plan = participationForClip(project, project.timeline[1]!);
    expect(plan.activeGroups.map((g) => g.assignments.length)).toEqual([80, 40]);
    expect(plan.counts.active).toBe(120);
    expectFleetAccounting(plan, 200, "scene-2");
  });

  it("scene 3 flies the whole fleet", () => {
    const plan = participationForClip(project, project.timeline[2]!);
    expect(plan.counts.active).toBe(200);
    expect(plan.counts.reserve + plan.counts.hold + plan.counts.preposition + plan.counts.manual).toBe(0);
    expectFleetAccounting(plan, 200, "scene-3");
  });

  it("keeps exact-N assets exact inside a larger fleet", () => {
    const pigeon = project.formations.find((f) => f.id === "f-pigeon")!;
    expect(pigeon.points).toHaveLength(150);
    const big = buildComplexProject(500, 150);
    expect(big.project.formations.find((f) => f.id === "f-pigeon")!.points).toHaveLength(150);
    const plan = participationForClip(big.project, big.project.timeline[0]!);
    expect(plan.counts.active).toBe(150);
    expectFleetAccounting(plan, 500, "scene-1@500");
  });

  it("moving one scene object mutates neither the other object nor the source asset", () => {
    const clip = project.timeline[1]!;
    const scene = sceneForClip(project, clip);
    const before = createSceneEvaluator(project, scene).positionsAt(0);
    const heartPointsBefore = project.formations.find((f) => f.id === "f-heart")!.points.map((p) => [...p]);
    const moved = patchObjectTransform(scene, scene.objects[0]!.id, {
      position: [-80, 10, 5] as Vector3Tuple,
      rotationDeg: [0, 35, 0] as Vector3Tuple,
      scale: 1.4,
    });
    const after = createSceneEvaluator(upsertScene(project, moved), moved).positionsAt(0);
    expect(after.slice(80)).toEqual(before.slice(80)); // star untouched
    expect(after.slice(0, 80)).not.toEqual(before.slice(0, 80));
    expect(project.formations.find((f) => f.id === "f-heart")!.points).toEqual(heartPointsBefore);
    expectFinite(after, "moved scene");
  });

  it("invalidates full-show analysis when scene geometry or lighting changes", () => {
    const baseRevision = computeAnalysisRevision(project, revisionSettings);

    const scene = sceneForClip(project, project.timeline[1]!);
    const movedScene = patchObjectTransform(scene, scene.objects[0]!.id, {
      position: [-70, 4, 2] as Vector3Tuple,
    });
    expect(computeAnalysisRevision(upsertScene(project, movedScene), revisionSettings)).not.toBe(baseRevision);

    const lighting = project.lighting!;
    const firstEffect = lighting.effects[0]!;
    const lightingChanged = {
      ...project,
      lighting: {
        ...lighting,
        effects: lighting.effects.map((effect, i) =>
          i === 0 ? { ...effect, start: firstEffect.start + 0.25 } : effect,
        ),
      },
    };
    expect(computeAnalysisRevision(lightingChanged, revisionSettings)).not.toBe(baseRevision);
  });

  it("dynamic wing animation keeps stable ids, groups and exact point count", () => {
    const dynamic = project.dynamicFormations![0]!;
    expect(dynamic.points).toHaveLength(pigeonPointCount);
    expect(new Set(dynamic.points.map((p) => p.id)).size).toBe(pigeonPointCount);
    expect(dynamic.groups.length).toBeGreaterThan(0);
    const memberships = dynamic.groups.map((g) => g.pointIds.join("|"));
    for (const t of [0, 0.5, 1.7, 3.9, 4, 8.25]) {
      const positions = sampleDynamicFormation(dynamic, t);
      expect(positions).toHaveLength(pigeonPointCount);
      expectFinite(positions, `dynamic@${t}`);
    }
    expect(dynamic.groups.map((g) => g.pointIds.join("|"))).toEqual(memberships);
    // Loop behaviour: the cycle repeats exactly one duration later.
    const a = sampleDynamicFormation(dynamic, 1.25);
    const b = sampleDynamicFormation(dynamic, 1.25 + dynamic.duration);
    expect(b).toEqual(a);
  });

  it("dynamic asset stays 150 points inside a 500-drone fleet", () => {
    const { dynamic } = pigeonAssets(150);
    expect(dynamic.points).toHaveLength(150);
    const big = buildComplexProject(500, 150);
    const plan = participationForClip(big.project, big.project.timeline[0]!);
    expect(plan.counts.active).toBe(150);
    expect(plan.drones.filter((d) => d.role !== "ACTIVE_FORMATION")).toHaveLength(350);
  });

  it("plans a pre-show with one pad per drone and finite launch/staging geometry", () => {
    const config = resolvePreShowConfig(project.preShow);
    const drones = buildDroneDefinitions(project);
    const composed = composePreShow(
      { droneCount: project.droneCount, config, limits: project.limits },
      drones,
    );
    expect(composed.schedules).toHaveLength(200);
    expect(launchHomePositions({ droneCount: 200, config, limits: project.limits })).toHaveLength(200);
    expectFinite(composed.plan.layout.pads.map((p) => p.position), "pads");
    expectFinite(composed.plan.staging.targets, "staging");
    expect(new Set(composed.plan.groupIdByDrone).size).toBe(composed.plan.groups.length);
    expect(composed.plan.segments.filter((s) => s.phase === "STAGING_HOLD")).toHaveLength(200);
  });

  it("gives every drone exactly one landing assignment", () => {
    const plan = buildShowPlan(project);
    const landings = plan.schedules.map((s) => s.segments.filter((seg) => seg.phase === "LANDING"));
    expect(landings.filter((l) => l.length === 0)).toHaveLength(0);
    const composed = composeFullShow(project, { sampleRate: 10, assignmentStrategy: "nearestNeighbor" });
    const finals = composed.trajectorySet.drones.map((d) => d.samples[d.samples.length - 1]!.position);
    expectFinite(finals, "landing positions");
    for (const p of finals) expect(p[1]).toBeCloseTo(0, 3);
    const padKey = (p: readonly number[]) => `${p[0]!.toFixed(2)},${p[2]!.toFixed(2)}`;
    expect(new Set(finals.map(padKey)).size).toBe(project.droneCount);
  });
});
