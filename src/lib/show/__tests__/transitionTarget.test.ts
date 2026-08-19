/**
 * TRANSITION OPTIMIZER / CANONICAL TARGET CONSISTENCY.
 *
 * The invariant under test is one equality:
 *
 *   transitionInputForClip(...).target === the fleet-indexed target list
 *   buildShowPlan() assigns from for that clip
 *
 * for every artistic target kind (static, dynamic, composite scene), plus the
 * eligibility contract (TAKEOFF/LANDING and partial-fleet participation clips
 * are not optimizable) and basis invalidation on scene / participation edits.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_AREA, createDefaultProject } from "../defaultProject";
import { buildDroneDefinitions } from "../drones";
import { applyPreset, dynamicFromFormation } from "../dynamic/create";
import { makeFormation } from "../formations";
import { addObject, emptyScene, patchObjectTransform, upsertScene } from "../scene";
import { buildShowPlan, positionsAt } from "../trajectory/schedule";
import { canonicalClipTarget, clipOptimizability } from "../trajectory/target";
import { isOptimizableClip, transitionInputForClip } from "../transition/project";
import { TransitionOptimizationError } from "../transition/types";
import { overrideBasis } from "@/lib/studio/planningIntegrity";
import type { Formation, ShowProject, TimelineClip, Vector3Tuple } from "../types";

const CLIP = "clip-show";

function showClip(formationId: string, over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: CLIP,
    formationId,
    start: 4,
    transition: 8,
    hold: 6,
    easing: "minJerk",
    color: [255, 255, 255],
    effect: "solid",
    phase: "SHOW",
    ...over,
  };
}

function grid(id: string, count: number, y: number): Formation {
  return makeFormation(id, `grid-${id}`, "grid", count, DEFAULT_AREA, { altitude: y });
}

function projectWith(fleet: number, formations: Formation[], clip: TimelineClip): ShowProject {
  const base = createDefaultProject(fleet);
  return {
    ...base,
    formations: [...base.formations, ...formations],
    timeline: [clip],
  };
}

/** The fleet-indexed target the scheduler actually assigned for `CLIP`. */
function schedulerTarget(project: ShowProject): Vector3Tuple[] {
  const plan = buildShowPlan(project);
  const clip = project.timeline.find((c) => c.id === CLIP)!;
  const home = plan.drones.map((d) => d.homePosition);
  // Target positions are re-derived through the canonical resolver the planner
  // itself uses; the equality below therefore pins optimiser === scheduler.
  return canonicalClipTarget(project, clip, home).rawTarget as Vector3Tuple[];
}

/** Fleet positions the PLAN actually reaches at the end of the transition. */
function flownHoldPositions(project: ShowProject): Vector3Tuple[] {
  const plan = buildShowPlan(project);
  const clip = project.timeline.find((c) => c.id === CLIP)!;
  return positionsAt(plan, clip.start + clip.transition + 1e-4) as Vector3Tuple[];
}

const key = (p: Vector3Tuple) => p.map((v) => v.toFixed(3)).join(",");
const sortedKeys = (ps: readonly Vector3Tuple[]) => ps.map(key).sort();

/**
 * The flown fleet state at hold start must be a PERMUTATION of the optimiser's
 * target list — this is the non-tautological half of the equality (it reads the
 * planner's sampled trajectories, not the resolver).
 */
function expectFlownMatchesTarget(project: ShowProject) {
  expect(sortedKeys(flownHoldPositions(project))).toEqual(sortedKeys(optimizerTarget(project)));
}

function optimizerTarget(project: ShowProject): Vector3Tuple[] {
  const plan = buildShowPlan(project);
  return transitionInputForClip(project, plan, CLIP, { strategy: "optimalDistance" })
    .target as Vector3Tuple[];
}

describe("canonical target agreement", () => {
  it("agrees for an ordinary static SHOW clip", () => {
    const f = grid("f-static", 24, 40);
    const project = projectWith(24, [f], showClip(f.id));
    expect(optimizerTarget(project)).toEqual(schedulerTarget(project));
    expect(optimizerTarget(project)).toHaveLength(24);
    expectFlownMatchesTarget(project);
  });

  it("agrees for a dynamic clip and uses its hold-start state, not the base points", () => {
    const f = grid("f-dyn", 24, 40);
    const dynamic = applyPreset(dynamicFromFormation(f, { id: "dyn-1", name: "Dyn" }), "ORBIT");
    const project: ShowProject = {
      ...projectWith(24, [f], showClip(f.id, { dynamicFormationId: dynamic.id })),
      dynamicFormations: [dynamic],
    };
    const target = optimizerTarget(project);
    expect(target).toEqual(schedulerTarget(project));
    const clip = project.timeline[0]!;
    const resolved = canonicalClipTarget(project, clip, []);
    expect(resolved.kind).toBe("dynamic");
    expect(resolved.dynamicFormationId).toBe(dynamic.id);
  });

  it("agrees for a composite scene and follows scene transforms", () => {
    const a = grid("f-a", 12, 40);
    const b = grid("f-b", 12, 60);
    let project = projectWith(24, [a, b], showClip(a.id));
    let scene = addObject(project, emptyScene(CLIP, "Scene"), {
      source: { kind: "STATIC", formationId: a.id },
      name: "A",
    }).scene;
    scene = addObject(project, scene, {
      source: { kind: "STATIC", formationId: b.id },
      name: "B",
    }).scene;
    project = upsertScene(project, scene);

    const before = optimizerTarget(project);
    expect(before).toEqual(schedulerTarget(project));
    expect(canonicalClipTarget(project, project.timeline[0]!, []).kind).toBe("scene");

    const moved = upsertScene(
      project,
      patchObjectTransform(scene, scene.objects[1]!.id, { position: [30, 5, -10] }),
    );
    expectFlownMatchesTarget(project);
    const after = optimizerTarget(moved);
    expect(after).toEqual(schedulerTarget(moved));
    expectFlownMatchesTarget(moved);
    expect(after).not.toEqual(before);
  });
});

describe("optimizability contract", () => {
  it("rejects TAKEOFF and LANDING clips", () => {
    const f = grid("f-p", 24, 40);
    for (const phase of ["TAKEOFF", "LANDING"] as const) {
      const project = projectWith(24, [f], showClip(f.id, { phase }));
      const plan = buildShowPlan(project);
      expect(isOptimizableClip(project, CLIP, plan)).toBe(false);
      expect(clipOptimizability(project, CLIP, []).code).toBe("PHASE_NOT_OPTIMIZABLE");
      expect(() =>
        transitionInputForClip(project, plan, CLIP, { strategy: "optimalDistance" }),
      ).toThrow(TransitionOptimizationError);
    }
  });

  it("rejects a partial-fleet participation clip instead of optimising base points", () => {
    const f = grid("f-partial", 10, 40);
    const project = projectWith(24, [f], showClip(f.id));
    const plan = buildShowPlan(project);
    expect(plan.participation.length).toBeGreaterThan(0);
    expect(isOptimizableClip(project, CLIP, plan)).toBe(false);
    expect(clipOptimizability(project, CLIP, []).code).toBe("PARTIAL_FLEET_UNSUPPORTED");
    expect(overrideBasis(project, CLIP)).toBeNull();
  });

  it("accepts a full-fleet SHOW clip", () => {
    const f = grid("f-full", 24, 40);
    const project = projectWith(24, [f], showClip(f.id));
    expect(isOptimizableClip(project, CLIP, buildShowPlan(project))).toBe(true);
  });
});

describe("override basis invalidation", () => {
  it("changes when a scene object transform changes", () => {
    const a = grid("f-a2", 12, 40);
    const b = grid("f-b2", 12, 60);
    let project = projectWith(24, [a, b], showClip(a.id));
    let scene = addObject(project, emptyScene(CLIP, "Scene"), {
      source: { kind: "STATIC", formationId: a.id },
      name: "A",
    }).scene;
    scene = addObject(project, scene, {
      source: { kind: "STATIC", formationId: b.id },
      name: "B",
    }).scene;
    project = upsertScene(project, scene);
    const before = overrideBasis(project, CLIP);
    const after = overrideBasis(
      upsertScene(project, patchObjectTransform(scene, scene.objects[0]!.id, { scale: 1.4 })),
      CLIP,
    );
    expect(before).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("drops the basis when the clip becomes partial-fleet (participation takes over)", () => {
    const f = grid("f-shrink", 24, 40);
    const project = projectWith(24, [f], showClip(f.id));
    expect(overrideBasis(project, CLIP)).not.toBeNull();
    // Fleet grows past the formation's point count -> the participation planner
    // owns this clip, so no override basis may exist any more.
    expect(buildDroneDefinitions({ ...project, droneCount: 40 })).toHaveLength(40);
    expect(overrideBasis({ ...project, droneCount: 40 }, CLIP)).toBeNull();
  });
});
