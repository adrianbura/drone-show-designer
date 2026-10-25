/**
 * AI AGENT — typed deterministic editor operations.
 *
 * The agent NEVER mutates the show directly. A natural-language request is
 * parsed (locally, or by the model) into one of these typed operations, the
 * operation produces a COMPLETE new project through pure functions here, the
 * result is validated (src/lib/agent/validate.ts) and only then installed as a
 * single undoable revision by `StudioContext.applyAgentProject`.
 *
 * Safety contract:
 *  - One operation touches exactly ONE timeline clip ("the selected scene").
 *  - A formation shared by other clips is cloned first, so other scenes and
 *    any library asset stay untouched.
 *  - Rotations are rigid transforms about the scene centroid; they preserve
 *    distances and therefore cannot change per-point velocities.
 *  - Multi-object scenes and TAKEOFF/LANDING clips are refused, never guessed.
 */
import type { DynamicFormation, TransformKeyframe } from "../show/dynamic/types";
import {
  centroid,
  quatFromEulerDeg,
  quatNormalize,
  quatSlerp,
  rotateByQuat,
  type Quat,
} from "../show/dynamic/math";
import { sampleDynamicFormation } from "../show/dynamic/sampler";
import type { RGB, ShowProject, TimelineClip, Vector3Tuple } from "../show/types";

export type AgentOpKind = "ROTATE_SCENE" | "RECOLOR_SCENE";

export interface RotateSceneOp {
  kind: "ROTATE_SCENE";
  /** Signed degrees about the show-frame axis (X lean, Y turn, Z tilt). */
  axis: "X" | "Y" | "Z";
  degrees: number;
}

export interface RecolorSceneOp {
  kind: "RECOLOR_SCENE";
  color: RGB;
}

export type AgentOp = RotateSceneOp | RecolorSceneOp;

export type AgentOpFailure =
  | "NO_CLIP_SELECTED"
  | "CLIP_NOT_FOUND"
  | "PHASE_NOT_EDITABLE"
  | "MULTI_OBJECT_SCENE"
  | "INVALID_OP";

export type AgentOpResult =
  | { ok: true; project: ShowProject; summary: AgentOpSummary }
  | { ok: false; reason: AgentOpFailure };

export interface AgentOpSummary {
  clipId: string;
  clipName: string;
  kind: AgentOpKind;
  /** Altitude range (m) of the affected formation before the operation. */
  altitudeBefore: readonly [number, number];
  /** Altitude range (m) after the operation. */
  altitudeAfter: readonly [number, number];
  /** True when the clip owns scene-scoped lighting effects that may override the new base color. */
  lightingMayOverride: boolean;
}

const AXIS_INDEX = { X: 0, Y: 1, Z: 2 } as const;

function quatMul(a: Quat, b: Quat): Quat {
  // Hamilton product a⊗b: applies b first, then a (column-vector convention,
  // matching rotateByQuat(v, q) = q v q*).
  return quatNormalize([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]);
}

/** Stable Euler (deg) readback of a quaternion; X then Y then Z, as quatFromEulerDeg. */
function eulerDegFromQuat(q: Quat): Vector3Tuple {
  const [x, y, z, w] = q;
  // R = Rz·Ry·Rx (intrinsic X→Y→Z, matching quatFromEulerDeg):
  //   m20 = −sin(ry), m21 = cos(ry)sin(rx), m10 = sin(rz)cos(ry).
  const m20 = 2 * (x * z - w * y);
  const m21 = 2 * (y * z + w * x);
  const m22 = w * w - x * x - y * y + z * z;
  const m10 = 2 * (x * y + w * z);
  const m00 = w * w + x * x - y * y - z * z;
  const rx = Math.atan2(m21, m22);
  const ry = Math.asin(Math.max(-1, Math.min(1, -m20)));
  const rz = Math.atan2(m10, m00);
  const DEG = 180 / Math.PI;
  return [rx * DEG, ry * DEG, rz * DEG];
}

function altitudeRange(points: readonly Vector3Tuple[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p[1] < lo) lo = p[1];
    if (p[1] > hi) hi = p[1];
  }
  return [lo, hi];
}

function dynamicAltitudeRange(f: DynamicFormation): [number, number] {
  // Sample the full animation, not just the base cloud: a rotation is rigid,
  // but the reported range should describe what the audience actually sees.
  let lo = Infinity;
  let hi = -Infinity;
  const steps = Math.max(8, Math.min(200, Math.ceil(f.duration * 4)));
  for (let i = 0; i <= steps; i++) {
    for (const p of sampleDynamicFormation(f, (f.duration * i) / steps)) {
      if (p[1] < lo) lo = p[1];
      if (p[1] > hi) hi = p[1];
    }
  }
  return [lo, hi];
}

function hasSceneLighting(project: ShowProject, clipId: string): boolean {
  return (project.lighting?.effects ?? []).some(
    (e) => e.target.kind === "SCENE" && e.target.clipId === clipId,
  );
}

interface ResolvedClip {
  clip: TimelineClip;
  clipIndex: number;
}

function resolveClip(project: ShowProject, clipId: string | null): ResolvedClip | AgentOpResult {
  if (!clipId) return { ok: false, reason: "NO_CLIP_SELECTED" };
  const clipIndex = project.timeline.findIndex((c) => c.id === clipId);
  const clip = project.timeline[clipIndex];
  if (!clip) return { ok: false, reason: "CLIP_NOT_FOUND" };
  if (clip.phase === "TAKEOFF" || clip.phase === "LANDING") {
    return { ok: false, reason: "PHASE_NOT_EDITABLE" };
  }
  if (project.scenes?.some((s) => s.id === clip.id)) {
    return { ok: false, reason: "MULTI_OBJECT_SCENE" };
  }
  return { clip, clipIndex };
}

/**
 * Returns a formation id that is private to this clip: clones the formation
 * when other clips reference it, so one scene can be edited without touching
 * the rest of the show (or the library asset it came from).
 */
function ensurePrivateFormation(
  project: ShowProject,
  clip: TimelineClip,
  clipIndex: number,
): {
  formations: ShowProject["formations"];
  timeline: ShowProject["timeline"];
  formationId: string;
} {
  const shared = project.timeline.some(
    (c) => c.formationId === clip.formationId && c.id !== clip.id,
  );
  if (!shared) {
    return {
      formations: project.formations,
      timeline: project.timeline,
      formationId: clip.formationId,
    };
  }
  const source = project.formations.find((f) => f.id === clip.formationId);
  if (!source)
    return {
      formations: project.formations,
      timeline: project.timeline,
      formationId: clip.formationId,
    };
  const cloneId = `${clip.formationId}-agent-${clipIndex}`;
  const clone = { ...source, id: cloneId, name: `${source.name} (scene copy)` };
  const formations = [...project.formations.filter((f) => f.id !== cloneId), clone];
  const timeline = project.timeline.map((c) =>
    c.id === clip.id ? { ...c, formationId: cloneId } : c,
  );
  return { formations, timeline, formationId: cloneId };
}

function ensurePrivateDynamic(
  project: ShowProject,
  clip: TimelineClip,
): { dynamicFormations: DynamicFormation[]; dynamicFormationId: string } {
  const all = project.dynamicFormations ?? [];
  const shared = project.timeline.some(
    (c) => c.dynamicFormationId === clip.dynamicFormationId && c.id !== clip.id,
  );
  if (!shared && clip.dynamicFormationId) {
    return { dynamicFormations: all, dynamicFormationId: clip.dynamicFormationId };
  }
  const source = all.find((d) => d.id === clip.dynamicFormationId);
  if (!source) return { dynamicFormations: all, dynamicFormationId: clip.dynamicFormationId ?? "" };
  const cloneId = `${source.id}-agent-${clip.id}`;
  const clone: DynamicFormation = { ...source, id: cloneId, name: `${source.name} (scene copy)` };
  return {
    dynamicFormations: [...all.filter((d) => d.id !== cloneId), clone],
    dynamicFormationId: cloneId,
  };
}

function applyRotate(
  project: ShowProject,
  resolved: ResolvedClip,
  op: RotateSceneOp,
): AgentOpResult {
  const { clip, clipIndex } = resolved;
  const euler: Vector3Tuple = [0, 0, 0];
  euler[AXIS_INDEX[op.axis]] = op.degrees as never;
  const q = quatFromEulerDeg(euler);
  const lightingMayOverride = hasSceneLighting(project, clip.id);

  // ---- Dynamic clip: rotate the whole animated trajectory about the scene
  // centroid by left-composing the rotation into the global transform track.
  if (clip.dynamicFormationId) {
    const priv = ensurePrivateDynamic(project, clip);
    const source = priv.dynamicFormations.find((d) => d.id === priv.dynamicFormationId);
    if (!source) return { ok: false, reason: "CLIP_NOT_FOUND" };
    const c = centroid(source.points.map((p) => p.base));
    const pivot = source.pivot;
    const offset = rotateByQuat([pivot[0] - c[0], pivot[1] - c[1], pivot[2] - c[2]], q);
    const bias: Vector3Tuple = [
      c[0] - pivot[0] + offset[0],
      c[1] - pivot[1] + offset[1],
      c[2] - pivot[2] + offset[2],
    ];
    const transform: TransformKeyframe[] =
      source.transform.length === 0
        ? [{ t: 0, translation: bias, rotation: euler, scale: [1, 1, 1] }]
        : source.transform.map((k) => {
            const t = rotateByQuat(k.translation, q);
            const kq = quatFromEulerDeg(k.rotation);
            return {
              ...k,
              translation: [t[0] + bias[0], t[1] + bias[1], t[2] + bias[2]],
              rotation: eulerDegFromQuat(quatMul(q, kq)),
            };
          });
    const rotated: DynamicFormation = { ...source, transform };
    const before = dynamicAltitudeRange(source);
    const after = dynamicAltitudeRange(rotated);
    const dynamicFormations = priv.dynamicFormations.map((d) =>
      d.id === rotated.id ? rotated : d,
    );
    const timeline = project.timeline.map((c2) =>
      c2.id === clip.id ? { ...c2, dynamicFormationId: rotated.id } : c2,
    );
    return {
      ok: true,
      project: { ...project, dynamicFormations, timeline },
      summary: {
        clipId: clip.id,
        clipName: source.name,
        kind: op.kind,
        altitudeBefore: before,
        altitudeAfter: after,
        lightingMayOverride,
      },
    };
  }

  // ---- Static clip: rotate the point cloud about its centroid.
  const priv = ensurePrivateFormation(project, clip, clipIndex);
  const source = priv.formations.find((f) => f.id === priv.formationId);
  if (!source) return { ok: false, reason: "CLIP_NOT_FOUND" };
  const c = centroid(source.points);
  const points = source.points.map((p) => {
    const r = rotateByQuat([p[0] - c[0], p[1] - c[1], p[2] - c[2]], q);
    return [c[0] + r[0], c[1] + r[1], c[2] + r[2]] as Vector3Tuple;
  });
  const rotated = { ...source, points };
  const formations = priv.formations.map((f) => (f.id === rotated.id ? rotated : f));
  return {
    ok: true,
    project: { ...project, formations, timeline: priv.timeline },
    summary: {
      clipId: clip.id,
      clipName: source.name,
      kind: op.kind,
      altitudeBefore: altitudeRange(source.points),
      altitudeAfter: altitudeRange(points),
      lightingMayOverride,
    },
  };
}

/**
 * Recolors one scene. For exact-sampled dynamic scenes the recorded luminance
 * animation is preserved: every recorded frame is rescaled so its brightest
 * channel matches the target color, keeping pulses and fades intact.
 */
function applyRecolor(
  project: ShowProject,
  resolved: ResolvedClip,
  op: RecolorSceneOp,
): AgentOpResult {
  const { clip } = resolved;
  const [tr, tg, tb] = op.color;
  const targetMax = Math.max(tr, tg, tb);
  if (targetMax <= 0) return { ok: false, reason: "INVALID_OP" };
  const lightingMayOverride = hasSceneLighting(project, clip.id);

  let dynamicFormations = project.dynamicFormations;
  let name = "";
  if (clip.dynamicFormationId) {
    const priv = ensurePrivateDynamic(project, clip);
    const source = priv.dynamicFormations.find((d) => d.id === priv.dynamicFormationId);
    if (!source) return { ok: false, reason: "CLIP_NOT_FOUND" };
    name = source.name;
    let next: DynamicFormation = source;
    if (source.sampledColors) {
      const byPoint: Record<string, readonly number[]> = {};
      for (const [id, arr] of Object.entries(source.sampledColors.byPoint)) {
        const out = new Array<number>(arr.length);
        for (let f = 0; f < arr.length / 3; f++) {
          const r = arr[f * 3]!;
          const g = arr[f * 3 + 1]!;
          const b = arr[f * 3 + 2]!;
          const m = Math.max(r, g, b);
          if (m <= 0) {
            out[f * 3] = 0;
            out[f * 3 + 1] = 0;
            out[f * 3 + 2] = 0;
          } else {
            const k = m / 255;
            out[f * 3] = Math.round(tr * k);
            out[f * 3 + 1] = Math.round(tg * k);
            out[f * 3 + 2] = Math.round(tb * k);
          }
        }
        byPoint[id] = out;
      }
      next = { ...source, sampledColors: { ...source.sampledColors, byPoint } };
    }
    dynamicFormations = priv.dynamicFormations.map((d) => (d.id === next.id ? next : d));
  } else {
    const f = project.formations.find((x) => x.id === clip.formationId);
    name = f?.name ?? clip.id;
  }

  const timeline = project.timeline.map((c) =>
    c.id === clip.id ? { ...c, color: op.color, effect: "solid" as const } : c,
  );
  return {
    ok: true,
    project: { ...project, dynamicFormations, timeline },
    summary: {
      clipId: clip.id,
      clipName: name,
      kind: op.kind,
      altitudeBefore: [0, 0],
      altitudeAfter: [0, 0],
      lightingMayOverride,
    },
  };
}

/** Applies one typed operation to a copy of the project. Never mutates `project`. */
export function applyAgentOp(
  project: ShowProject,
  clipId: string | null,
  op: AgentOp,
): AgentOpResult {
  if (!Number.isFinite((op as RotateSceneOp).degrees ?? 0) && op.kind === "ROTATE_SCENE") {
    return { ok: false, reason: "INVALID_OP" };
  }
  const resolved = resolveClip(project, clipId);
  if ("ok" in resolved) return resolved;
  switch (op.kind) {
    case "ROTATE_SCENE":
      return applyRotate(project, resolved, op);
    case "RECOLOR_SCENE":
      return applyRecolor(project, resolved, op);
  }
}

/** Kept for tests: quaternion composition used by the rotation operation. */
export const __agentMath = { quatMul, eulerDegFromQuat, quatSlerp };
