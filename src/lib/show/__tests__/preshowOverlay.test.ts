import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../defaultProject";
import { buildShowPlan } from "../trajectory";
import {
  analyzePreShow,
  buildPreShowOverlay,
  DEFAULT_PRE_SHOW,
  launchGroupColor,
  patchPreShowConfig,
  preShowStatesAt,
  rotateXZ,
  type PreShowConfig,
} from "../preshow";
import { toPreShowExportSection } from "../../adapters/preshowExport";
import { toGenericShowJson } from "../../adapters/export";
import type { ShowProject } from "../types";

function enabled(patch: Parameters<typeof patchPreShowConfig>[1] = {}): PreShowConfig {
  return patchPreShowConfig(DEFAULT_PRE_SHOW, { enabled: true, ...patch });
}

function projectWithPreShow(patch: Parameters<typeof patchPreShowConfig>[1] = {}): ShowProject {
  const project = createDefaultProject(24);
  return { ...project, preShow: enabled(patch) };
}

function planFor(project: ShowProject) {
  const plan = buildShowPlan(project, {});
  if (!plan.preShow) throw new Error("expected a pre-show plan");
  return plan;
}

describe("pre-show overlay model", () => {
  it("exposes exactly the actual pads, never unused grid cells", () => {
    // 24 drones in a 6x6 grid => 12 unused cells that must not become pads.
    const plan = planFor(projectWithPreShow({ launch: { rows: 6, columns: 6 } }));
    const overlay = buildPreShowOverlay(plan.preShow!);

    expect(overlay.launch.pads).toHaveLength(24);
    expect(overlay.launch.pads.map((p) => p.position)).toEqual(
      plan.preShow!.layout.pads.map((p) => p.position),
    );
    expect(overlay.launch.pads.map((p) => p.padId)).toEqual(
      plan.preShow!.layout.pads.map((p) => p.id),
    );
    // Rows 0..3 are full, row 4 is not populated at all beyond the 24th pad.
    expect(Math.max(...overlay.launch.pads.map((p) => p.row))).toBe(3);
  });

  it("reflects launch rotation in pad positions and orientation", () => {
    const base = buildPreShowOverlay(planFor(projectWithPreShow()).preShow!);
    const rotated = buildPreShowOverlay(
      planFor(projectWithPreShow({ launch: { rotationDeg: 90 } })).preShow!,
    );

    expect(rotated.launch.orientation.rotationDeg).toBe(90);
    expect(rotated.launch.orientation.forward[0]).toBeCloseTo(-1, 6);
    expect(rotated.launch.orientation.forward[2]).toBeCloseTo(0, 6);

    const c = base.launch.center;
    for (let i = 0; i < base.launch.pads.length; i++) {
      const p = base.launch.pads[i]!.position;
      const [rx, rz] = rotateXZ(p[0] - c[0], p[2] - c[2], 90);
      const actual = rotated.launch.pads[i]!.position;
      expect(actual[0]).toBeCloseTo(c[0] + rx, 6);
      expect(actual[2]).toBeCloseTo(c[2] + rz, 6);
    }
  });

  it("exposes the exact resolved staging targets and reflects offsets", () => {
    const project = projectWithPreShow({
      staging: { altitude: 42, leftRight: 11, forwardBack: -7 },
    });
    const plan = planFor(project);
    const overlay = buildPreShowOverlay(plan.preShow!);

    expect(overlay.staging.targets).toHaveLength(24);
    expect(overlay.staging.targets.map((t) => t.position)).toEqual(plan.preShow!.targetByDrone);
    expect(overlay.staging.center[1]).toBe(42);
    expect(overlay.staging.center[0]).toBeCloseTo(plan.preShow!.layout.center[0] + 11, 6);
    expect(overlay.staging.center[2]).toBeCloseTo(plan.preShow!.layout.center[2] - 7, 6);
    for (const target of overlay.staging.targets) expect(target.position[1]).toBeCloseTo(42, 6);
  });

  it("produces deterministic group membership metadata", () => {
    const project = projectWithPreShow({ launch: { rows: 6, columns: 6 } });
    const a = buildPreShowOverlay(planFor(project).preShow!);
    const b = buildPreShowOverlay(planFor(project).preShow!);

    expect(a.groups).toEqual(b.groups);
    expect(a.groups.length).toBeGreaterThan(1);
    expect(launchGroupColor(0)).toEqual(launchGroupColor(0));
    expect(launchGroupColor(0)).not.toEqual(launchGroupColor(1));

    const seen = new Set<number>();
    for (const group of a.groups) {
      expect(group.padPositions).toHaveLength(group.droneIndices.length);
      expect(group.stagingTargets).toHaveLength(group.droneIndices.length);
      group.droneIndices.forEach((i) => {
        expect(seen.has(i)).toBe(false);
        seen.add(i);
        expect(a.groupIdByDrone[i]).toBe(group.groupId);
      });
    }
    expect(seen.size).toBe(24);
  });

  it("derives pre-show drone state from the canonical plan segments", () => {
    const plan = planFor(projectWithPreShow());
    const preShow = plan.preShow!;

    const atStart = preShowStatesAt(preShow, -preShow.duration + 0.001);
    expect(atStart).toHaveLength(24);
    expect(new Set(atStart).has("STAGED")).toBe(false);

    const atZero = preShowStatesAt(preShow, -0.001);
    expect(atZero.every((s) => s === "STAGED")).toBe(true);
    expect(preShowStatesAt(preShow, 1).every((s) => s === "SHOW")).toBe(true);

    // Some drone must actually be moving mid pre-show.
    const mid = preShowStatesAt(preShow, -preShow.duration / 2);
    expect(mid.some((s) => s === "ASCENT" || s === "TRANSIT" || s === "STAGED")).toBe(true);
  });
});

describe("pre-show export provenance", () => {
  const project = projectWithPreShow({ launch: { rows: 6, columns: 6, rotationDeg: 15 } });

  it("contains every pad id, drone-to-pad mapping and launch group", () => {
    const plan = planFor(project);
    const section = toPreShowExportSection({ plan: plan.preShow! });

    expect(section.launchPads).toHaveLength(24);
    expect(section.launchPads.map((p) => p.padId)).toEqual(
      plan.preShow!.layout.pads.map((p) => p.id),
    );
    expect(section.dronePadMapping).toHaveLength(24);
    for (const { droneId, padId } of section.dronePadMapping) {
      expect(plan.preShow!.layout.droneToPad[droneId]).toBe(padId);
    }
    expect(section.launchGroups.length).toBe(plan.preShow!.groups.length);
    expect(section.launchGroups.flatMap((g) => g.droneIds)).toHaveLength(24);
    expect(section.launchGroups[0]!.startTime).toBe(0);
  });

  it("preserves the reproducible launch layout, staging transform and versions", () => {
    const plan = planFor(project);
    const section = toPreShowExportSection({ plan: plan.preShow! });

    expect(section.launchLayout.rows).toBe(plan.preShow!.layout.rows);
    expect(section.launchLayout.columns).toBe(plan.preShow!.layout.columns);
    expect(section.launchLayout.rotationDeg).toBe(15);
    expect(section.launchLayout.spacingX).toBe(DEFAULT_PRE_SHOW.launch.spacingX);
    expect(section.launchLayout.spacingZ).toBe(DEFAULT_PRE_SHOW.launch.spacingZ);
    expect(section.launchLayout.padCount).toBe(24);

    expect(section.staging.formationKind).toBe(plan.preShow!.staging.formationKind);
    expect(section.staging.altitude).toBe(DEFAULT_PRE_SHOW.staging.altitude);
    expect(section.staging.rotationDeg).toBe(DEFAULT_PRE_SHOW.staging.rotationDeg);
    expect(section.staging.targets).toHaveLength(24);

    expect(section.launchAlgorithmVersion).toBe(plan.preShow!.algorithmVersions.launch);
    expect(section.stagingAlgorithmVersion).toBe(plan.preShow!.algorithmVersions.staging);
    expect(section.preShowEngineVersion).toBe(plan.preShow!.algorithmVersions.preShowEngine);
    expect(section.assignmentAlgorithmVersion).toBe(plan.preShow!.algorithmVersions.assignment);
    expect(section.grouping.strategy).toBe(DEFAULT_PRE_SHOW.grouping.strategy);
    expect(section.grouping.groupIntervalSeconds).toBe(
      DEFAULT_PRE_SHOW.grouping.groupIntervalSeconds,
    );
  });

  it("maps show time zero and the operational timeline honestly", () => {
    const plan = planFor(project);
    const section = toPreShowExportSection({ plan: plan.preShow! });

    expect(section.timing.showTimeZero).toBe(0);
    expect(section.timing.preShowDuration).toBeCloseTo(plan.preShow!.duration, 3);
    expect(section.timing.showStartOperationalTime).toBeCloseTo(plan.preShow!.duration, 3);
    expect(section.timing.preShowStartShowTime).toBeCloseTo(-plan.preShow!.duration, 3);
    expect(section.timing.firstLiftoffTime).toBeCloseTo(plan.preShow!.firstLiftoffTime, 3);
    expect(section.timing.lastLiftoffTime).toBeCloseTo(plan.preShow!.lastLiftoffTime, 3);
    expect(section.timing.stagingHoldDuration).toBe(DEFAULT_PRE_SHOW.stagingHold);
  });

  it("marks missing or stale validation provenance instead of implying a pass", () => {
    const plan = planFor(project);

    const none = toPreShowExportSection({ plan: plan.preShow! });
    expect(none.preShowValidation.status).toBeNull();
    expect(none.preShowValidation.stale).toBe(true);
    expect(none.preShowValidation.metrics).toBeNull();

    const { report } = analyzePreShow(project, { sampleRate: 10 });
    const stale = toPreShowExportSection({
      plan: plan.preShow!,
      report,
      stale: true,
      analysisRevision: "rev-old",
    });
    expect(stale.preShowValidation.status).toBe(report.status);
    expect(stale.preShowValidation.stale).toBe(true);
    expect(stale.preShowValidation.analysisRevision).toBe("rev-old");
    expect(stale.preShowValidation.errorCount).toBe(report.errors.length);

    const fresh = toPreShowExportSection({
      plan: plan.preShow!,
      report,
      stale: false,
      analysisRevision: "rev-current",
    });
    expect(fresh.preShowValidation.stale).toBe(false);
    expect(fresh.preShowValidation.metrics).not.toBeNull();
  });

  it("embeds the section in the generic show JSON for the exported plan", () => {
    const plan = planFor(project);
    const set = { droneCount: 24, duration: 1, sampleRate: 5, algorithmVersion: "t", drones: [] };
    const json = JSON.parse(
      toGenericShowJson({ project, plan, set: set as never }),
    ) as Record<string, any>;

    expect(json["preShow"].launchPads).toHaveLength(24);
    expect(json["preShow"].timing.showTimeZero).toBe(0);
    expect(json["operationalTiming"].firstPlayableShowTime).toBeCloseTo(plan.startTime, 3);

    // Without a launch plan the section is explicitly null, not omitted.
    const noPreShow = buildShowPlan(project, { preShow: null });
    const bare = JSON.parse(
      toGenericShowJson({ project, plan: noPreShow, set: set as never }),
    ) as Record<string, any>;
    expect(bare["preShow"]).toBeNull();
  });
});
