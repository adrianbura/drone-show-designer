import type { AgentOp } from "../../../agent/operations";
import type { ShowProject, Vector3Tuple } from "../../../show/types";
import { sampleReferenceShow } from "../playback";
import type { ReferenceShow } from "../types";
import { promoteReferenceClips, reseedReferenceSignatures } from "./intervals";
import type { ClipSignatureContext } from "./signature";
import type { ReferenceTrajectoryLayer } from "./types";
import { taperedKinematics, type TaperedMotionEdit } from "./taper";

export interface ImportedEditTransaction {
  readonly project: ShowProject;
  readonly layer: ReferenceTrajectoryLayer;
  readonly baselineProject: ShowProject;
  readonly baselineLayer: ReferenceTrajectoryLayer;
  readonly edit: TaperedMotionEdit;
  readonly maxVelocity: number;
  readonly maxAcceleration: number;
}

/** Atomic preparation only; callers must still run the full canonical gate. */
export function prepareImportedEdit(
  project: ShowProject,
  show: ReferenceShow,
  layer: ReferenceTrajectoryLayer,
  clipIds: readonly string[],
  op: AgentOp,
  context: ClipSignatureContext,
): { ok: true; transaction: ImportedEditTransaction } | { ok: false; reason: string } {
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
  const samples = sampleReferenceShow(show, (start + end) / 2);
  const pivot: Vector3Tuple = [0, 1, 2].map(
    (axis) => samples.reduce((sum, s) => sum + (s.position[axis] ?? 0), 0) / samples.length,
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
  const edits = [...(layer.motionEdits ?? []), edit];
  const ordered = [...known].sort((a, b) => a.order - b.order);
  if (ordered.some((b, i) => i > 0 && b.order !== (ordered[i - 1]?.order ?? 0) + 1))
    return { ok: false, reason: "NON_CONSECUTIVE_EDIT_TARGET" };
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
  if (maxVelocity > project.limits.maxVelocity || maxAcceleration > project.limits.maxAcceleration)
    return {
      ok: false,
      reason: `EDIT_TIME_BUDGET_EXCEEDED: v=${maxVelocity.toFixed(3)}/${project.limits.maxVelocity}, a=${maxAcceleration.toFixed(3)}/${project.limits.maxAcceleration}`,
    };
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
      edit,
      maxVelocity,
      maxAcceleration,
    },
  };
}
