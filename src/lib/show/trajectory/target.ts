/**
 * CANONICAL SHOW-TARGET RESOLVER — single authority for "what geometry does a
 * clip morph to".
 *
 * Before this module the scheduler resolved SHOW target geometry through
 * composite scene -> dynamic evaluator -> base formation (+ partial-fleet
 * participation), while the Transition Optimizer looked only at
 * `project.formations[...].points`. The two could disagree, so the optimiser
 * could analyse a transition that is never flown.
 *
 * Both `buildShowPlan()` and `transitionInputForClip()` now call
 * `resolveClipGeometry()` / `canonicalClipTarget()` from here, so:
 *
 *   OPTIMIZER TARGET === SCHEDULER TARGET
 *
 * Nothing here samples fixed rates, plans trajectories, or mutates a project.
 *
 * TARGET INDEX CONTRACT
 * ---------------------
 * The canonical target list is FLEET-INDEXED and has exactly `droneCount`
 * entries (`padPoints`). A `ClipTransitionOverride.targetPointIndex[i]` is an
 * index INTO THAT LIST — unambiguous for static, dynamic and composite scenes
 * alike. Partial-fleet participation is deliberately NOT representable: the
 * participation planner owns drone roles and hold point indices, so those clips
 * are reported as non-optimizable instead of being optimised against base
 * formation points (see `clipOptimizability`).
 */
import { createDynamicEvaluator, type DynamicEvaluator } from "../dynamic/sampler";
import { createSceneEvaluator, isCompositeScene, sceneForClip, type SceneEvaluator } from "../scene";
import type { Formation, ShowProject, TimelineClip, Vector3Tuple } from "../types";
import { clipPhase, resolveDynamicFormation } from "../types";

export type ClipTargetKind = "static" | "dynamic" | "scene" | "landing";

/** Structured reason a clip cannot be resolved / optimised. */
export type ClipGeometryProblem =
  | { readonly code: "MISSING_FORMATION"; readonly message: string }
  | { readonly code: "SCENE_UNRESOLVABLE"; readonly message: string }
  | {
      readonly code: "SCENE_OVER_CAPACITY";
      readonly message: string;
      readonly required: number;
      readonly fleetSize: number;
    };

export interface ClipGeometry {
  readonly clipId: string;
  readonly kind: ClipTargetKind;
  readonly formation: Formation | undefined;
  readonly dynamicFormationId: string | undefined;
  /** Scene/dynamic evaluator driving the HOLD (null for plain static clips). */
  readonly sceneEvaluator: SceneEvaluator | null;
  readonly dynamicEvaluator: DynamicEvaluator | null;
  /**
   * Target geometry AT THE MOMENT THE HOLD STARTS (local t = 0) — exactly the
   * state the transition must morph into.
   */
  readonly points: readonly Vector3Tuple[];
  readonly pointIds: readonly string[] | undefined;
  readonly problems: readonly ClipGeometryProblem[];
}

/** Fleet-indexed padding, identical to the scheduler's historical behaviour. */
export function padPoints(
  points: readonly Vector3Tuple[],
  count: number,
  fallback: readonly Vector3Tuple[],
): Vector3Tuple[] {
  if (points.length === 0) return fallback.slice(0, count);
  const out: Vector3Tuple[] = [];
  for (let i = 0; i < count; i++) out.push(points[i % points.length]!);
  return out;
}

/**
 * Resolves a clip's target geometry through the canonical chain:
 * composite scene -> dynamic formation -> base formation.
 */
export function resolveClipGeometry(
  project: ShowProject,
  clip: TimelineClip,
  options: { readonly home?: readonly Vector3Tuple[] } = {},
): ClipGeometry {
  const phase = clipPhase(clip);
  const problems: ClipGeometryProblem[] = [];
  const formation = project.formations.find((f) => f.id === clip.formationId);

  if (phase === "LANDING") {
    return {
      clipId: clip.id,
      kind: "landing",
      formation,
      dynamicFormationId: undefined,
      sceneEvaluator: null,
      dynamicEvaluator: null,
      points: options.home ?? [],
      pointIds: undefined,
      problems,
    };
  }

  if (!formation) {
    problems.push({
      code: "MISSING_FORMATION",
      message: `Clip ${clip.id} references a missing formation`,
    });
  }

  let sceneEvaluator: SceneEvaluator | null = null;
  if (phase === "SHOW" && isCompositeScene(project, clip)) {
    try {
      sceneEvaluator = createSceneEvaluator(project, sceneForClip(project, clip));
    } catch (err) {
      problems.push({
        code: "SCENE_UNRESOLVABLE",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (sceneEvaluator && sceneEvaluator.pointCount > project.droneCount) {
      problems.push({
        code: "SCENE_OVER_CAPACITY",
        message: `Scene ${clip.id} needs ${sceneEvaluator.pointCount} drones but the fleet has ${project.droneCount}.`,
        required: sceneEvaluator.pointCount,
        fleetSize: project.droneCount,
      });
      sceneEvaluator = null;
    }
  }

  const dynamicFormation = resolveDynamicFormation(project, clip);
  const dynamicEvaluator = dynamicFormation
    ? createDynamicEvaluator(dynamicFormation, {
        playbackRate: clip.playbackRate ?? 1,
        startOffset: clip.dynamicStartOffset ?? 0,
      })
    : null;

  const points: readonly Vector3Tuple[] = sceneEvaluator
    ? sceneEvaluator.positionsAt(0)
    : dynamicEvaluator
      ? dynamicEvaluator.positionsAt(0)
      : (formation?.points ?? []);

  return {
    clipId: clip.id,
    kind: sceneEvaluator ? "scene" : dynamicEvaluator ? "dynamic" : "static",
    formation,
    dynamicFormationId: dynamicFormation && !sceneEvaluator ? dynamicFormation.id : undefined,
    sceneEvaluator,
    dynamicEvaluator,
    points,
    pointIds: sceneEvaluator
      ? sceneEvaluator.pointIds
      : dynamicFormation
        ? dynamicFormation.points.map((p) => p.id)
        : undefined,
    problems,
  };
}

export interface CanonicalClipTarget extends ClipGeometry {
  /** Fleet-indexed target list of length `project.droneCount`. */
  readonly rawTarget: readonly Vector3Tuple[];
  /** True when the geometry uses fewer points than the fleet has drones. */
  readonly partialFleet: boolean;
}

/**
 * The fleet-indexed target list the scheduler assigns from. Identical maths to
 * the scheduler's own `padPoints(scenePoints, droneCount, home)`.
 */
export function canonicalClipTarget(
  project: ShowProject,
  clip: TimelineClip,
  home: readonly Vector3Tuple[],
): CanonicalClipTarget {
  const geometry = resolveClipGeometry(project, clip, { home });
  const points = clipPhase(clip) === "LANDING" ? home : geometry.points;
  return {
    ...geometry,
    rawTarget: padPoints(points, project.droneCount, home),
    partialFleet:
      clipPhase(clip) === "SHOW" && points.length > 0 && points.length < project.droneCount,
  };
}

export type ClipOptimizabilityCode =
  | "OK"
  | "MISSING_CLIP"
  | "PHASE_NOT_OPTIMIZABLE"
  | "NO_TARGET_GEOMETRY"
  | "SCENE_UNSUPPORTED"
  | "PARTIAL_FLEET_UNSUPPORTED";

export interface ClipOptimizability {
  readonly optimizable: boolean;
  readonly code: ClipOptimizabilityCode;
  readonly message: string;
}

/**
 * SOURCE-STATE CONTRACT of the optimiser: it takes the fleet positions sampled
 * from the canonical plan at `clip.start` and one fleet-indexed target list, and
 * returns a per-drone permutation of that list. So the predecessor phase is
 * irrelevant (TAKEOFF -> SHOW and SHOW -> SHOW are both fine — the source is
 * always read from the plan), while the TARGET clip must be a SHOW clip whose
 * target is representable as a plain fleet-indexed permutation.
 *
 * TAKEOFF and LANDING stay non-optimizable: their vertical semantics and pad
 * identity are owned by dedicated planners.
 */
export function clipOptimizability(
  project: ShowProject,
  clipId: string,
  home: readonly Vector3Tuple[],
): ClipOptimizability {
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip) return { optimizable: false, code: "MISSING_CLIP", message: `Clip ${clipId} not found` };
  if (clipPhase(clip) !== "SHOW") {
    return {
      optimizable: false,
      code: "PHASE_NOT_OPTIMIZABLE",
      message: `${clipPhase(clip)} clips are planned by dedicated planners and are not optimizable.`,
    };
  }
  const resolved = canonicalClipTarget(project, clip, home);
  const sceneProblem = resolved.problems.find(
    (p) => p.code === "SCENE_UNRESOLVABLE" || p.code === "SCENE_OVER_CAPACITY",
  );
  if (sceneProblem) {
    return { optimizable: false, code: "SCENE_UNSUPPORTED", message: sceneProblem.message };
  }
  if (resolved.points.length === 0) {
    return {
      optimizable: false,
      code: "NO_TARGET_GEOMETRY",
      message: `Clip ${clipId} has no usable target geometry`,
    };
  }
  if (resolved.partialFleet) {
    return {
      optimizable: false,
      code: "PARTIAL_FLEET_UNSUPPORTED",
      message:
        "Partial-fleet participation owns drone roles and hold indices for this clip, so a transition override cannot represent its target. Optimization is unavailable until the fleet fully participates.",
    };
  }
  return { optimizable: true, code: "OK", message: "" };
}
