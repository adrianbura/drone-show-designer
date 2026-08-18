/**
 * FLEET RESIZE + IRREGULAR COUNT INTEGRATION (audit sections F, P, Q, U).
 *
 * Resizes the complex project through the documented 3…500 range and re-checks
 * launch, staging, group accounting, participation and landing every time.
 */
import { describe, expect, it } from "vitest";

import { buildComplexProject } from "./fixtures";
import { expectFinite, expectFleetAccounting, participationForClip } from "./invariants";
import { buildDroneDefinitions } from "../../drones";
import {
  buildLaunchGroups,
  buildLaunchLayout,
  buildStagingLayout,
  composePreShow,
  resolvePreShowConfig,
} from "../../preshow";
import { buildShowPlan } from "../../trajectory/schedule";
import type { ShowProject } from "../../types";

const IRREGULAR = [3, 17, 23, 137, 199, 200, 201, 347, 499, 500];
const RESIZE_SEQUENCE = [200, 137, 500, 23, 347, 200];

/** Resizes the fleet the way the store does: count only, assets stay exact-N. */
function resize(project: ShowProject, droneCount: number): ShowProject {
  return { ...project, droneCount };
}

describe("irregular fleet counts", () => {
  for (const n of IRREGULAR) {
    it(`plans launch, staging, groups and landing for exactly ${n} drones`, () => {
      const project = resize(buildComplexProject(200, Math.min(150, n)).project, n);
      const config = resolvePreShowConfig(project.preShow);

      const layout = buildLaunchLayout(n, config.launch);
      expect(layout.pads).toHaveLength(n);
      expect(new Set(layout.pads.map((p) => p.id)).size).toBe(n);
      expectFinite(layout.pads.map((p) => p.position), `pads@${n}`);

      const staging = buildStagingLayout(n, config.staging, layout);
      expect(staging.targets).toHaveLength(n);
      expectFinite(staging.targets, `staging@${n}`);

      const groups = buildLaunchGroups(layout, config.grouping);
      const members = groups.flatMap((g) => [...g.droneIndices]);
      expect(members).toHaveLength(n);
      expect(new Set(members).size).toBe(n);

      const drones = buildDroneDefinitions(project);
      expect(drones).toHaveLength(n);
      const composed = composePreShow({ droneCount: n, config, limits: project.limits }, drones);
      expect(composed.schedules).toHaveLength(n);

      const plan = buildShowPlan(project);
      expect(plan.drones).toHaveLength(n);
      const landing = plan.schedules.map((s) => s.segments.filter((seg) => seg.phase === "LANDING"));
      expect(landing.filter((l) => l.length === 0)).toHaveLength(0);
      // Exactly one landing target per drone, all pads distinct.
      const finals = plan.schedules.map((s) => {
        const last = s.segments[s.segments.length - 1]!;
        return last.planned.sample(last.end - last.start).position;
      });
      expectFinite(finals, `landing@${n}`);
      expect(new Set(finals.map((p) => `${p[0]!.toFixed(2)},${p[2]!.toFixed(2)}`)).size).toBe(n);
      for (const p of finals) expect(p[1]).toBeCloseTo(0, 3);
    });
  }
});

describe("fleet resize stress sequence", () => {
  it("keeps every subsystem consistent through 200 → 137 → 500 → 23 → 347 → 200", () => {
    let project = buildComplexProject(200, 150).project;
    for (const n of RESIZE_SEQUENCE) {
      project = resize(project, n);
      const config = resolvePreShowConfig(project.preShow);
      expect(buildLaunchLayout(n, config.launch).pads).toHaveLength(n);
      expect(buildStagingLayout(n, config.staging, buildLaunchLayout(n, config.launch)).targets).toHaveLength(n);
      expect(buildDroneDefinitions(project)).toHaveLength(n);
      expect(buildShowPlan(project).drones).toHaveLength(n);

      // Partial formation: the pigeon stays 150 points; the rest must be roled.
      const pigeon = project.formations.find((f) => f.id === "f-pigeon")!;
      expect(pigeon.points).toHaveLength(150);
      if (n >= 150) {
        const plan = participationForClip(project, project.timeline[0]!);
        expect(plan.counts.active).toBe(150);
        expectFleetAccounting(plan, n, `resize@${n}`);
        for (const d of plan.drones) {
          expect(d.droneId).toBeTruthy();
          expect(d.role).toBeTruthy();
          expectFinite([d.target], `target ${d.droneId}@${n}`);
        }
      }
    }
    expect(project.droneCount).toBe(200);
  });

  it("keeps a 150-point formation partial in both a 200 and a 500 drone fleet", () => {
    for (const n of [200, 500]) {
      const project = resize(buildComplexProject(200, 150).project, n);
      const plan = participationForClip(project, project.timeline[0]!);
      expect(plan.counts.active).toBe(150);
      expect(plan.drones.filter((d) => d.role !== "ACTIVE_FORMATION")).toHaveLength(n - 150);
      expectFleetAccounting(plan, n, `partial@${n}`);
    }
  });
});
