import type { AgentOp } from "../../../agent/operations";
import type { ShowProject, Vector3Tuple } from "../../../show/types";
import type { ReferenceShow } from "../types";
import { promoteReferenceClips, reseedReferenceSignatures } from "./intervals";
import type { ClipSignatureContext } from "./signature";
import type { ReferenceTrajectoryLayer } from "./types";
import { taperedKinematics, taperedPosition, type TaperedMotionEdit } from "./taper";

export interface ImportedEditTransaction {
  readonly project: ShowProject;
  readonly layer: ReferenceTrajectoryLayer;
  readonly baselineProject: ShowProject;
  readonly baselineLayer: ReferenceTrajectoryLayer;
  readonly edit: TaperedMotionEdit;
  readonly maxVelocity: number;
  readonly maxAcceleration: number;
}

/** Largest feasible magnitude of the same op/direction (kinematic budget only). */
export interface FeasibleEditHint {
  readonly kind: TaperedMotionEdit["kind"];
  /** Metres of offset (MOVE), degrees (ROTATE) or factor (SCALE). */
  readonly magnitude: number;
  readonly rampSeconds: number;
}

export type ImportedEditResult =
  | { ok: true; transaction: ImportedEditTransaction }
  | { ok: false; reason: string; feasible?: FeasibleEditHint };

/**
 * Ramp policy (Stage 5, measured on the real archive): the shortest ramp of
 * RAMP_FRACTIONS x (usable span) whose kinematics fit the derived limits.
 * Short ramps keep the new pose held longest; longer ramps lower the added
 * velocity (~1/ramp) and acceleration (~1/ramp^2). 0.5 = no hold (pure bump).
 */
export const RAMP_FRACTIONS = [0.25, 1 / 3, 0.4, 0.5] as const;

/** Atomic preparation only; callers must still run the full canonical gate. */
export function prepareImportedEdit(
  project: ShowProject,
  show: ReferenceShow,
  layer: ReferenceTrajectoryLayer,
  clipIds: readonly string[],
  op: AgentOp,
  context: ClipSignatureContext,
): ImportedEditResult {
  if (!clipIds.length || !["MOVE_SCENE", "ROTATE_SCENE", "SCALE_SCENE"].includes(op.kind))
    return { ok: false, reason: "UNSUPPORTED_IMPORTED_EDIT" };
  const bindings = clipIds.map((id) => layer.bindings.find((b) => b.clipId === id));
  if (
    bindings.some(
      (b) =>
        !b ||
        b.kind !== "SCENE" ||
        (b.owner === "PLANNER" && !layer.motionEdits?.some((e) => e.clipIds.includes(b.clipId))),
    )
  )
    return { ok: false, reason: "REFERENCE_BASELINE_REQUIRED" };
  const known = bindings.filter((b) => b !== undefined);
  if (
    show.drones.length !== project.droneCount ||
    show.timing.positionRateHz !== layer.positionRateHz
  )
    return { ok: false, reason: "REFERENCE_FLEET_CLOCK_MISMATCH" };
  if (
    known.some((b) => {
      const c = project.timeline.find((c) => c.id === b.clipId);
      return (
        !c ||
        Math.abs(c.start - b.referenceStart) > 1e-6 ||
        Math.abs(c.start + c.transition + c.hold - b.referenceEnd) > 1e-6
      );
    })
  )
    return { ok: false, reason: "REFERENCE_TIMING_REQUIRED" };
  const start = Math.min(...known.map((b) => b.referenceStart)),
    end = Math.max(...known.map((b) => b.referenceEnd));
  const guard = 2 / show.timing.positionRateHz;
  const span = end - start - 2 * guard;
  if (span <= 0.25) return { ok: false, reason: "INSUFFICIENT_EDIT_TIME" };
  // Pivot = centroid of the CURRENT effective pose (prior stacked edits
  // included), so "rotate after move" turns the moved shape in place.
  const mid = (start + end) / 2;
  const samples = show.drones.map((d) => taperedPosition(d, mid, show.timing, layer.motionEdits ?? []));
  const pivot: Vector3Tuple = [0, 1, 2].map(
    (axis) => samples.reduce((sum, p) => sum + (p[axis] ?? 0), 0) / samples.length,
  ) as [number, number, number];
  const edit: TaperedMotionEdit = {
    kind: op.kind as TaperedMotionEdit["kind"],
    clipIds: [...clipIds],
    start,
    end,
    guardSeconds: guard,
    rampSeconds: span / 4,
    pivot,
    ...(op.kind === "MOVE_SCENE"
      ? { offset: op.offset }
      : op.kind === "ROTATE_SCENE"
        ? { axis: op.axis, degrees: op.degrees }
        : op.kind === "SCALE_SCENE"
          ? { factor: op.factor }
          : {}),
  };
  if (
    op.kind === "MOVE_SCENE" &&
    (op.offset.length !== 3 ||
      !op.offset.every(Number.isFinite) ||
      op.offset.some((v) => Math.abs(v) > 200))
  )
    return { ok: false, reason: "INVALID_MOVE" };
  if (op.kind === "ROTATE_SCENE" && !Number.isFinite(op.degrees))
    return { ok: false, reason: "INVALID_ROTATION" };
  if (
    op.kind === "SCALE_SCENE" &&
    (!Number.isFinite(op.factor) || op.factor < 0.5 || op.factor > 2)
  )
    return { ok: false, reason: "INVALID_SCALE" };
  const ordered = [...known].sort((a, b) => a.order - b.order);
  if (ordered.some((b, i) => i > 0 && b.order !== (ordered[i - 1]?.order ?? 0) + 1))
    return { ok: false, reason: "NON_CONSECUTIVE_EDIT_TARGET" };
  const prior = layer.motionEdits ?? [];
  // Stacking: a later edit on an overlapping-but-different interval would
  // put one taper's ramp inside another's hold; refuse instead of guessing.
  if (
    prior.some(
      (e) =>
        e.start < end - 1e-9 &&
        e.end > start + 1e-9 &&
        (Math.abs(e.start - start) > 1e-9 || Math.abs(e.end - end) > 1e-9),
    )
  )
    return { ok: false, reason: "OVERLAPPING_EDIT_INTERVAL" };
  const budget = (candidate: TaperedMotionEdit) => {
    const edits = [...prior, candidate];
    let maxVelocity = 0,
      maxAcceleration = 0;
    for (
      let f = Math.floor(start * show.timing.positionRateHz);
      f <= Math.ceil(end * show.timing.positionRateHz);
      f++
    ) {
      for (const drone of show.drones) {
        const k = taperedKinematics(drone, f / show.timing.positionRateHz, show.timing, edits);
        maxVelocity = Math.max(maxVelocity, Math.hypot(...k.velocity));
        maxAcceleration = Math.max(maxAcceleration, Math.hypot(...k.acceleration));
      }
    }
    return {
      maxVelocity,
      maxAcceleration,
      fits:
        maxVelocity <= project.limits.maxVelocity &&
        maxAcceleration <= project.limits.maxAcceleration,
    };
  };
  let chosen: { edit: TaperedMotionEdit; maxVelocity: number; maxAcceleration: number } | null =
    null;
  let last = { maxVelocity: 0, maxAcceleration: 0 };
  for (const fraction of RAMP_FRACTIONS) {
    const candidate = { ...edit, rampSeconds: span * fraction };
    const b = budget(candidate);
    last = b;
    if (b.fits) {
      chosen = { edit: candidate, ...b };
      break;
    }
  }
  if (!chosen) {
    const longest = { ...edit, rampSeconds: span * RAMP_FRACTIONS[RAMP_FRACTIONS.length - 1]! };
    const at = (m: number): TaperedMotionEdit =>
      edit.kind === "MOVE_SCENE"
        ? { ...longest, offset: (edit.offset ?? [0, 0, 0]).map((v) => v * m) as Vector3Tuple }
        : edit.kind === "ROTATE_SCENE"
          ? { ...longest, degrees: (edit.degrees ?? 0) * m }
          : { ...longest, factor: 1 + ((edit.factor ?? 1) - 1) * m };
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (budget(at(mid)).fits) lo = mid;
      else hi = mid;
    }
    const best = at(lo);
    const magnitude =
      edit.kind === "MOVE_SCENE"
        ? Math.hypot(...(best.offset ?? [0, 0, 0]))
        : edit.kind === "ROTATE_SCENE"
          ? Math.abs(best.degrees ?? 0)
          : (best.factor ?? 1);
    return {
      ok: false,
      reason: `EDIT_TIME_BUDGET_EXCEEDED: v=${last.maxVelocity.toFixed(3)}/${project.limits.maxVelocity}, a=${last.maxAcceleration.toFixed(3)}/${project.limits.maxAcceleration}`,
      feasible: { kind: edit.kind, magnitude, rampSeconds: longest.rampSeconds },
    };
  }
  const { maxVelocity, maxAcceleration } = chosen;
  const edits = [...prior, chosen.edit];
  // Geometry lives in the layer; preserve project identity for unchanged
  // authoring topology instead of recomputing unrelated scene diagnostics.
  const next = project;
  const promoted = promoteReferenceClips(
    layer,
    clipIds.map((clipId) => ({ clipId, reason: "MANUAL" as const })),
  ).layer;
  const nextLayer = reseedReferenceSignatures(next, { ...promoted, motionEdits: edits }, context);
  return {
    ok: true,
    transaction: {
      project: next,
      layer: nextLayer,
      baselineProject: project,
      baselineLayer: layer,
      edit: chosen.edit,
      maxVelocity,
      maxAcceleration,
    },
  };
}
