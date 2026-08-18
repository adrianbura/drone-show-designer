/**
 * CROSS-SUBSYSTEM INVARIANT ASSERTIONS (audit pass).
 *
 * These are the checks the audit applies after EVERY structural operation:
 * fleet accounting, unique physical identity and finite geometry.
 */
import { expect } from "vitest";

import { buildDroneDefinitions } from "../../drones";
import {
  planFleetParticipation,
  resolveParticipationSettings,
  type FleetParticipationPlan,
} from "../../participation";
import { createSceneEvaluator, sceneForClip } from "../../scene";
import { buildShowPlan } from "../../trajectory/schedule";
import type { ShowProject, TimelineClip, Vector3Tuple } from "../../types";

export function expectFinite(points: readonly Vector3Tuple[] | readonly (readonly number[])[], label: string): void {
  for (const p of points) {
    expect(p, `${label}: missing point`).toBeTruthy();
    for (let i = 0; i < 3; i++) {
      const v = p[i];
      expect(typeof v === "number" && Number.isFinite(v), `${label}: non-finite component ${i} (${String(v)})`).toBe(
        true,
      );
    }
  }
}

/** ACTIVE + PREPOSITION + HOLD + RESERVE + MANUAL === fleet, ids unique. */
export function expectFleetAccounting(plan: FleetParticipationPlan, fleet: number, label: string): void {
  const c = plan.counts;
  expect(c.active + c.preposition + c.hold + c.reserve + c.manual, `${label}: role totals`).toBe(fleet);
  expect(plan.drones, `${label}: drone rows`).toHaveLength(fleet);
  expect(new Set(plan.drones.map((d) => d.droneId)).size, `${label}: unique ids`).toBe(fleet);

  const active = new Set<string>();
  for (const group of plan.activeGroups) {
    for (const a of group.assignments) {
      expect(active.has(a.droneId), `${label}: ${a.droneId} assigned twice simultaneously`).toBe(false);
      active.add(a.droneId);
    }
  }
  expect(active.size, `${label}: active subset size`).toBe(c.active);
}

/** Plans participation for one clip using the project's own scene resolution. */
export function participationForClip(project: ShowProject, clip: TimelineClip): FleetParticipationPlan {
  const drones = buildDroneDefinitions(project);
  const scene = sceneForClip(project, clip);
  const evaluator = createSceneEvaluator(project, scene);
  return planFleetParticipation({
    drones,
    current: drones.map((d) => d.homePosition),
    scene: {
      clipId: clip.id,
      formationId: null,
      points: evaluator.positionsAt(0),
      pointIds: evaluator.pointIds,
      groups: evaluator.groups,
    },
    settings: resolveParticipationSettings(project.participation),
    limits: project.limits,
    area: project.area,
  });
}

/** Structural sanity of a whole project: plan builds, geometry finite, ids unique. */
export function expectProjectStructurallySound(project: ShowProject, label: string): void {
  const plan = buildShowPlan(project);
  expect(plan.drones, `${label}: planned drones`).toHaveLength(project.droneCount);
  expect(new Set(plan.drones.map((d) => d.id)).size, `${label}: unique planned ids`).toBe(project.droneCount);
  expectFinite(
    plan.drones.map((d) => d.homePosition),
    `${label}: home positions`,
  );
  for (const formation of project.formations) expectFinite(formation.points, `${label}: ${formation.id}`);
  for (const clip of project.timeline) {
    const scene = sceneForClip(project, clip);
    const evaluator = createSceneEvaluator(project, scene);
    expectFinite(evaluator.positionsAt(0), `${label}: scene ${clip.id}`);
  }
}
