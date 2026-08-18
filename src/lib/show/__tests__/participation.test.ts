/**
 * FLEET PARTICIPATION + SMART RESERVE PLANNER tests.
 *
 * Verifies the invariants the sprint is built on: partial formations, exact
 * active counts, full-fleet continuity, determinism, geometry-driven subset
 * selection, look-ahead staleness, manual mode, reserve geometry and scale.
 */
import { describe, expect, it } from "vitest";

import { assetFleetCompatibility, assetFromFormation } from "@/lib/library";
import {
  DEFAULT_PARTICIPATION_SETTINGS,
  ParticipationError,
  PARTICIPATION_EXACT_SOLVER_LIMIT,
  computeParticipationRevision,
  planFleetParticipation,
  reserveSlotPositions,
  resolveParticipationSettings,
  autoReserveZone,
  type FleetParticipationPlan,
  type ParticipationScene,
  type ParticipationSettings,
} from "../participation";
import { buildDroneDefinitions, droneIdForIndex, type DroneDefinition } from "../drones";
import { DEFAULT_AREA, DEFAULT_LIMITS, createDefaultProject } from "../defaultProject";
import { makeFormation } from "../formations";
import { dynamicFromFormation } from "../dynamic/create";
import { buildShowPlan } from "../trajectory/schedule";
import type { Formation, ShowProject, Vector3Tuple } from "../types";

const limits = DEFAULT_LIMITS;

function fleet(n: number): DroneDefinition[] {
  return Array.from({ length: n }, (_, i) => ({
    id: droneIdForIndex(i),
    index: i,
    homePosition: [(i % 25) * 3 - 36, 0, Math.floor(i / 25) * 3 - 24] as Vector3Tuple,
  }));
}

/** Ring of `count` points centred on `center`. */
function ring(count: number, radius: number, center: Vector3Tuple = [0, 40, 0]): Vector3Tuple[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius] as Vector3Tuple;
  });
}

function scene(clipId: string, points: Vector3Tuple[], formationId = `f-${clipId}`): ParticipationScene {
  return { clipId, formationId, points };
}

const settings = (over: Partial<ParticipationSettings> = {}): ParticipationSettings =>
  resolveParticipationSettings({ ...DEFAULT_PARTICIPATION_SETTINGS, ...over });

function plan(
  droneCount: number,
  points: Vector3Tuple[],
  options: {
    current?: Vector3Tuple[];
    lookAhead?: ParticipationScene[];
    settings?: ParticipationSettings;
    previous?: FleetParticipationPlan | null;
  } = {},
): FleetParticipationPlan {
  const drones = fleet(droneCount);
  return planFleetParticipation({
    drones,
    current: options.current ?? drones.map((d) => d.homePosition),
    scene: scene("clip-a", points),
    ...(options.lookAhead ? { lookAhead: options.lookAhead } : {}),
    settings: options.settings ?? settings(),
    limits,
    area: DEFAULT_AREA,
    previous: options.previous ?? null,
  });
}

const roleCount = (p: FleetParticipationPlan, role: string) =>
  p.drones.filter((d) => d.role === role).length;

describe("formation library compatibility", () => {
  it("allows every asset up to the fleet size and blocks larger ones", () => {
    const asset = (count: number) =>
      assetFromFormation(makeFormation(`f-${count}`, `A${count}`, "circle", count, DEFAULT_AREA, {}), {
        name: `A${count}`,
      });
    expect(assetFleetCompatibility(asset(50), 500)).toBe("PARTIAL");
    expect(assetFleetCompatibility(asset(150), 500)).toBe("PARTIAL");
    expect(assetFleetCompatibility(asset(300), 500)).toBe("PARTIAL");
    expect(assetFleetCompatibility(asset(500), 500)).toBe("EXACT");
    expect(assetFleetCompatibility(asset(501), 500)).toBe("TOO_LARGE");
  });

  it("blocks a formation with more points than the fleet instead of resampling", () => {
    expect(() => plan(100, ring(120, 30))).toThrowError(ParticipationError);
    try {
      plan(500, ring(600, 30));
    } catch (err) {
      expect((err as ParticipationError).code).toBe("FORMATION_TOO_LARGE");
      expect((err as ParticipationError).message).toContain("600");
      expect((err as ParticipationError).message).toContain("500");
    }
  });
});

describe("fleet participation invariants", () => {
  it("keeps the active count exact and every drone assigned exactly once", () => {
    const p = plan(500, ring(150, 34));
    expect(p.counts.active).toBe(150);
    expect(p.counts.fleet).toBe(500);
    expect(p.drones).toHaveLength(500);
    expect(new Set(p.drones.map((d) => d.droneId)).size).toBe(500);
    const sum =
      p.counts.active + p.counts.preposition + p.counts.reserve + p.counts.hold + p.counts.manual;
    expect(sum).toBe(500);
    // Every drone has an explicit finite target — no labels without geometry.
    expect(p.drones.every((d) => d.target.every((v) => Number.isFinite(v)))).toBe(true);
    // Active drones map to DISTINCT formation points.
    const pts = p.drones.filter((d) => d.role === "ACTIVE_FORMATION").map((d) => d.formationPointIndex);
    expect(new Set(pts).size).toBe(150);
  });

  it("is deterministic for identical inputs", () => {
    const points = ring(150, 34);
    const a = plan(400, points, { lookAhead: [scene("clip-b", ring(300, 40))] });
    const b = plan(400, points, { lookAhead: [scene("clip-b", ring(300, 40))] });
    expect(a.drones.map((d) => `${d.droneId}:${d.role}:${d.formationPointIndex ?? "-"}:${d.target.join(",")}`)).toEqual(
      b.drones.map((d) => `${d.droneId}:${d.role}:${d.formationPointIndex ?? "-"}:${d.target.join(",")}`),
    );
    expect(a.provenance.revision).toBe(b.provenance.revision);
  });

  it("selects a geometrically appropriate subset, not the first N drones", () => {
    // The lowest-id drones are parked FAR from the formation; higher ids sit on it.
    const droneCount = 60;
    const points = ring(20, 12, [0, 40, 0]);
    const drones = fleet(droneCount);
    const current: Vector3Tuple[] = drones.map((d, i) =>
      i < 40 ? ([200, 40, 200] as Vector3Tuple) : (points[(i - 40) % points.length] as Vector3Tuple),
    );
    const p = planFleetParticipation({
      drones,
      current,
      scene: scene("clip-a", points),
      settings: settings(),
      limits,
      area: DEFAULT_AREA,
    });
    const active = p.drones.filter((d) => d.role === "ACTIVE_FORMATION").map((d) => d.droneIndex);
    expect(active).toHaveLength(20);
    expect(active.every((i) => i >= 40)).toBe(true);
  });
});

describe("participation policies", () => {
  it("HOLD_CURRENT keeps every non-participating drone at its current position", () => {
    const drones = fleet(500);
    const current = drones.map((d, i) => [d.homePosition[0], 30 + (i % 3), d.homePosition[2]] as Vector3Tuple);
    const p = planFleetParticipation({
      drones,
      current,
      scene: scene("clip-a", ring(150, 34)),
      settings: settings({ defaultPolicy: "HOLD_CURRENT" }),
      limits,
      area: DEFAULT_AREA,
    });
    expect(p.counts.active).toBe(150);
    expect(p.counts.hold).toBe(350);
    for (const d of p.drones) {
      if (d.role === "HOLD_CURRENT") expect(d.target).toEqual(current[d.droneIndex]);
    }
  });

  it("RESERVE_FORMATION places the exact reserve count on deterministic grid slots", () => {
    const p = plan(500, ring(150, 34), { settings: settings({ defaultPolicy: "RESERVE_FORMATION" }) });
    expect(p.counts.reserve).toBe(350);
    const slots = reserveSlotPositions(350, p.reserveZone, { area: DEFAULT_AREA, limits });
    const used = p.drones
      .filter((d) => d.role === "RESERVE_FORMATION")
      .map((d) => d.reserveSlotIndex ?? -1)
      .sort((a, b) => a - b);
    expect(used).toEqual(slots.map((_, i) => i));
    for (const d of p.drones) {
      if (d.role === "RESERVE_FORMATION") expect(d.target).toEqual(slots[d.reserveSlotIndex!]);
    }
  });

  it("MANUAL accepts an exact selection and rejects an incomplete one", () => {
    const points = ring(20, 12);
    const active = Array.from({ length: 20 }, (_, i) => droneIdForIndex(i + 10));
    const ok = plan(60, points, {
      settings: settings({
        defaultPolicy: "MANUAL",
        clips: { "clip-a": { policy: "MANUAL", manual: { activeDroneIds: active } } },
      }),
    });
    expect(ok.counts.active).toBe(20);
    expect(ok.drones.filter((d) => d.role === "ACTIVE_FORMATION").map((d) => d.droneId).sort()).toEqual(
      [...active].sort(),
    );

    expect(() =>
      plan(60, points, {
        settings: settings({
          defaultPolicy: "MANUAL",
          clips: { "clip-a": { policy: "MANUAL", manual: { activeDroneIds: active.slice(0, 19) } } },
        }),
      }),
    ).toThrowError(/19 drones but the formation has 20/);
  });
});

describe("smart prepare look-ahead", () => {
  it("pre-positions reserve drones for a LARGER next scene", () => {
    const p = plan(500, ring(150, 30), { lookAhead: [scene("clip-b", ring(300, 46))] });
    expect(p.counts.active).toBe(150);
    expect(p.counts.preposition).toBe(150);
    expect(p.counts.reserve).toBe(200);
    expect(p.lookAhead.usedClipId).toBe("clip-b");
    for (const d of p.drones) {
      if (d.role === "PREPOSITION_NEXT") expect(d.prepositionClipId).toBe("clip-b");
    }
  });

  it("prepares the whole fleet for a full-fleet next scene", () => {
    const p = plan(500, ring(150, 30), { lookAhead: [scene("clip-b", ring(500, 50))] });
    expect(p.counts.active).toBe(150);
    expect(p.counts.preposition).toBe(350);
    expect(p.counts.reserve).toBe(0);
  });

  it("falls back to the reserve zone when no future scene needs more drones", () => {
    const smaller = plan(500, ring(150, 30), { lookAhead: [scene("clip-b", ring(50, 20))] });
    expect(smaller.counts.preposition).toBe(0);
    expect(smaller.counts.reserve).toBe(350);
    expect(smaller.warnings.map((w) => w.code)).toContain("NO_PREPOSITION_BENEFIT");

    const none = plan(500, ring(150, 30));
    expect(none.warnings.map((w) => w.code)).toContain("NO_FUTURE_TARGET");
    expect(none.counts.reserve).toBe(350);
  });

  it("makes the current plan depend on the NEXT scene (look-ahead staleness)", () => {
    const points = ring(150, 30);
    const a = plan(300, points, { lookAhead: [scene("clip-b", ring(240, 44))] });
    const b = plan(300, points, { lookAhead: [scene("clip-b", ring(240, 52))] });
    expect(a.provenance.revision).not.toBe(b.provenance.revision);
    expect(a.drones.map((d) => d.target.join(","))).not.toEqual(b.drones.map((d) => d.target.join(",")));
  });

  it("keeps pre-position targets out of the current artistic footprint", () => {
    const points = ring(40, 20, [0, 40, 0]);
    const p = plan(120, points, { lookAhead: [scene("clip-b", ring(90, 6, [0, 40, 0]))] });
    const footprintRadius = 20;
    for (const d of p.drones) {
      if (d.role !== "PREPOSITION_NEXT") continue;
      const planar = Math.hypot(d.target[0], d.target[2]);
      expect(planar).toBeGreaterThanOrEqual(footprintRadius);
    }
  });

  it("prefers stable participation across consecutive scenes", () => {
    const points = ring(60, 24);
    const first = plan(150, points);
    const drones = fleet(150);
    const second = planFleetParticipation({
      drones,
      current: first.drones.map((d) => d.target),
      scene: scene("clip-a", points),
      settings: settings(),
      limits,
      area: DEFAULT_AREA,
      previous: first,
    });
    const before = new Set(first.drones.filter((d) => d.role === "ACTIVE_FORMATION").map((d) => d.droneId));
    const after = second.drones.filter((d) => d.role === "ACTIVE_FORMATION").map((d) => d.droneId);
    expect(after.filter((id) => before.has(id))).toHaveLength(60);
  });
});

describe("reserve zone", () => {
  it("produces exactly the requested slot count inside the show volume", () => {
    const zone = autoReserveZone({ area: DEFAULT_AREA, limits, droneCount: 350 });
    const slots = reserveSlotPositions(350, zone, { area: DEFAULT_AREA, limits });
    expect(slots).toHaveLength(350);
    for (const s of slots) {
      expect(Math.abs(s[0])).toBeLessThanOrEqual(DEFAULT_AREA.width / 2 + 1e-6);
      expect(Math.abs(s[2])).toBeLessThanOrEqual(DEFAULT_AREA.depth / 2 + 1e-6);
      expect(s[1]).toBeGreaterThanOrEqual(limits.minAltitude);
      expect(s[1]).toBeLessThanOrEqual(limits.maxAltitude);
    }
    // Deterministic: same config, same slots.
    expect(reserveSlotPositions(350, zone, { area: DEFAULT_AREA, limits })).toEqual(slots);
  });

  it("proposes a zone outside the artistic footprint", () => {
    const points = ring(150, 30, [0, 45, 0]);
    const zone = autoReserveZone({ area: DEFAULT_AREA, limits, droneCount: 350, footprintPoints: points });
    expect(zone.center[1]).toBeLessThan(45);
    expect(zone.spacing).toBeGreaterThanOrEqual(limits.minSeparation * 2);
  });
});

describe("full-fleet continuity through the scheduler", () => {
  const partialProject = (droneCount: number, counts: number[]): ShowProject => {
    const project = createDefaultProject(droneCount);
    const formations: Formation[] = counts.map((count, i) =>
      makeFormation(`f-part-${i}`, `Part ${i}`, i % 2 === 0 ? "circle" : "sphere", count, DEFAULT_AREA, {
        size: 50,
        altitude: 40,
      }),
    );
    let start = 0;
    const timeline = [
      {
        id: "c-takeoff",
        formationId: formations[0]!.id,
        start: 0,
        transition: 8,
        hold: 2,
        easing: "smooth" as const,
        color: [255, 255, 255] as const,
        effect: "solid" as const,
        phase: "TAKEOFF" as const,
      },
    ];
    start = 10;
    counts.forEach((_, i) => {
      timeline.push({
        id: `c-show-${i}`,
        formationId: formations[i]!.id,
        start,
        transition: 10,
        hold: 6,
        easing: "smooth" as const,
        color: [255, 255, 255] as const,
        effect: "solid" as const,
        phase: "SHOW" as unknown as "TAKEOFF",
      });
      start += 16;
    });
    timeline.push({
      id: "c-landing",
      formationId: formations[0]!.id,
      start,
      transition: 12,
      hold: 1,
      easing: "smooth" as const,
      color: [255, 255, 255] as const,
      effect: "solid" as const,
      phase: "LANDING" as unknown as "TAKEOFF",
    });
    return { ...project, droneCount, formations: [...project.formations, ...formations], timeline };
  };

  it("plans the ENTIRE fleet through partial -> partial -> larger -> full scenes", () => {
    const project = partialProject(120, [40, 12, 80, 120]);
    const showPlan = buildShowPlan(project);
    expect(showPlan.schedules).toHaveLength(120);
    // Continuous: every drone has a segment for every clip.
    for (const schedule of showPlan.schedules) {
      const clipIds = new Set(schedule.segments.map((s) => s.clipId));
      for (const clip of project.timeline) expect(clipIds.has(clip.id)).toBe(true);
    }
    // A participation plan exists for every PARTIAL scene, none for the full one.
    expect(showPlan.participation.map((p) => p.clipId)).toEqual([
      "c-show-0",
      "c-show-1",
      "c-show-2",
    ]);
    for (const p of showPlan.participation) {
      expect(p.counts.fleet).toBe(120);
      expect(new Set(p.drones.map((d) => d.droneId)).size).toBe(120);
    }
    expect(showPlan.participation[0]!.counts.active).toBe(40);
    expect(showPlan.participation[1]!.counts.active).toBe(12);
    expect(showPlan.participation[2]!.counts.active).toBe(80);
    expect(showPlan.errors).toHaveLength(0);
  });

  it("keeps stable formation point ids for a partial DYNAMIC formation", () => {
    const project = createDefaultProject(120);
    const base = makeFormation("f-bird", "Bird", "circle", 40, DEFAULT_AREA, { size: 40, altitude: 40 });
    const dynamic = dynamicFromFormation(base, { id: "dyn-bird", name: "Bird", duration: 4 });
    const withClip: ShowProject = {
      ...project,
      formations: [...project.formations, base],
      dynamicFormations: [dynamic],
      timeline: [
        {
          id: "c-takeoff",
          formationId: base.id,
          start: 0,
          transition: 8,
          hold: 1,
          easing: "smooth",
          color: [255, 255, 255],
          effect: "solid",
          phase: "TAKEOFF",
        },
        {
          id: "c-bird",
          formationId: base.id,
          start: 9,
          transition: 8,
          hold: 8,
          easing: "smooth",
          color: [255, 255, 255],
          effect: "solid",
          phase: "SHOW",
          dynamicFormationId: "dyn-bird",
        },
        {
          id: "c-landing",
          formationId: base.id,
          start: 25,
          transition: 10,
          hold: 1,
          easing: "smooth",
          color: [255, 255, 255],
          effect: "solid",
          phase: "LANDING",
        },
      ],
    };
    const showPlan = buildShowPlan(withClip);
    const participation = showPlan.participation.find((p) => p.clipId === "c-bird")!;
    expect(participation.counts.active).toBe(40);
    const ids = participation.drones
      .filter((d) => d.role === "ACTIVE_FORMATION")
      .map((d) => d.formationPointId);
    expect(new Set(ids).size).toBe(40);
    expect(ids.every((id) => typeof id === "string" && id!.length > 0)).toBe(true);
    expect(new Set(dynamic.points.map((p) => p.id)).size).toBe(40);
    // Non-participating drones do not animate the living formation.
    expect(participation.counts.active + participation.counts.reserve + participation.counts.preposition).toBe(120);
  });
});

describe("scale and provenance", () => {
  it("plans 1000 drones with the bounded solver in a bounded time", () => {
    const drones = fleet(1000);
    const t0 = Date.now();
    const p = planFleetParticipation({
      drones,
      current: drones.map((d) => d.homePosition),
      scene: scene("clip-a", ring(300, 45)),
      lookAhead: [scene("clip-b", ring(700, 55))],
      settings: settings(),
      limits,
      area: DEFAULT_AREA,
    });
    const ms = Date.now() - t0;
    expect(p.counts.active).toBe(300);
    expect(p.counts.fleet).toBe(1000);
    expect(new Set(p.drones.map((d) => d.droneId)).size).toBe(1000);
    expect(p.provenance.solver).toBe("bounded");
    expect(ms).toBeLessThan(8000);
  });

  it("uses the exact solver at or below the exact-solver limit", () => {
    const p = plan(Math.min(200, PARTICIPATION_EXACT_SOLVER_LIMIT), ring(60, 24));
    expect(p.provenance.solver).toBe("exact");
    expect(p.provenance.algorithmVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("changes the revision when any dependency changes", () => {
    const base = {
      clipId: "clip-a",
      fleetSize: 500,
      policy: "SMART_PREPARE" as const,
      current: ring(4, 1),
      scenePoints: ring(4, 2),
      lookAhead: [{ clipId: "clip-b", points: ring(4, 3) }],
      reserveZone: DEFAULT_PARTICIPATION_SETTINGS.reserveZone,
      reserveLighting: "OFF" as const,
      weights: { active: 1, future: 0.6, reserveBase: 1.2, stabilityDiscount: 0.85, footprint: 2, movement: 0.1 },
      algorithmVersion: "0.1.0",
      costModelVersion: "0.1.0",
    };
    const a = computeParticipationRevision(base);
    expect(computeParticipationRevision(base)).toBe(a);
    expect(computeParticipationRevision({ ...base, lookAhead: [{ clipId: "clip-b", points: ring(6, 3) }] })).not.toBe(a);
    expect(computeParticipationRevision({ ...base, policy: "HOLD_CURRENT" })).not.toBe(a);
    expect(computeParticipationRevision({ ...base, reserveLighting: "DIM" })).not.toBe(a);
  });

  it("resolves and clamps user settings", () => {
    const resolvedSettings = resolveParticipationSettings({ lookAheadScenes: 99 });
    expect(resolvedSettings.lookAheadScenes).toBeLessThanOrEqual(4);
    expect(resolvedSettings.defaultPolicy).toBe("SMART_PREPARE");
    expect(resolvedSettings.reserveLighting).toBe("OFF");
    expect(resolveParticipationSettings(null).reserveZone.layout).toBe("GRID");
  });

  it("keeps the fleet definition and the plan aligned by drone id", () => {
    const project = createDefaultProject(60);
    const drones = buildDroneDefinitions(project);
    const p = planFleetParticipation({
      drones,
      current: drones.map((d) => d.homePosition),
      scene: scene("clip-a", ring(20, 15)),
      settings: settings(),
      limits,
      area: project.area,
    });
    expect(p.drones.map((d) => d.droneId)).toEqual(drones.map((d) => d.id));
    expect(roleCount(p, "ACTIVE_FORMATION")).toBe(20);
  });
});
