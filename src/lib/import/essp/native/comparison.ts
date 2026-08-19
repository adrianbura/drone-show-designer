/**
 * REFERENCE-ASSISTED SCENE EDITING — pure comparison layer.
 *
 * PURPOSE
 *   Let the operator compare the NATIVE EDITABLE geometry of an extracted clip
 *   against the ORIGINAL imported ESSP geometry it was derived from, at one
 *   shared comparison instant.
 *
 * NON-GOALS (deliberate)
 *   - No second ESSP sampler: reference positions always come from the existing
 *     `sampleReferenceShow` playback evaluator.
 *   - No membership inference: object membership is READ from the stored
 *     `sourceDroneIds` provenance written by the extractor.
 *   - No safety semantics: everything here is a DESIGN comparison metric and is
 *     never fed into flight validation, conflicts, splices or export.
 *   - No ownership change: comparing never promotes and never reclaims a clip.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import { sampleReferenceShow } from "../playback";
import type { ReferenceShow } from "../types";
import { resolveSceneAt } from "../../../show/scene/resolve";
import type { FormationScene, SceneFormationInstance } from "../../../show/scene/types";
import type { ShowProject, TimelineClip, Vector3Tuple } from "../../../show/types";
import type { ReferenceClipBinding } from "./types";

/** Which instant the two datasets are compared at. */
export type SceneComparisonFrame = "CURRENT" | "EXTRACTED";

export interface ReferenceGhostGroup {
  /** Scene object this reference group belongs to (null = whole scene). */
  readonly objectId: string | null;
  readonly name: string;
  /** Source drone ids from the stored extraction provenance. */
  readonly sourceDroneIds: readonly string[];
  /** Index of each source drone inside the imported show. */
  readonly droneIndices: readonly number[];
  /** Original imported positions in studio metres at the comparison time. */
  readonly points: readonly Vector3Tuple[];
  /** True when membership came from provenance rather than the whole fleet. */
  readonly membershipKnown: boolean;
}

export interface ReferenceGhostFrame {
  readonly clipId: string;
  readonly frame: SceneComparisonFrame;
  /** Absolute time inside the imported show. */
  readonly referenceTime: number;
  /** Scene-local time the editable geometry is evaluated at. */
  readonly localTime: number;
  readonly groups: readonly ReferenceGhostGroup[];
}

export interface SceneObjectDeviation {
  readonly objectId: string;
  readonly name: string;
  readonly comparedCount: number;
  readonly rmsMeters: number;
  readonly maxMeters: number;
  readonly centroidShift: Vector3Tuple;
  readonly centroidShiftMeters: number;
  /** Editable extent / reference extent. 1 = unchanged. */
  readonly scaleChange: number;
  /** Best-fit rotation about +Y in degrees, or null when not meaningful. */
  readonly rotationDeg: number | null;
  readonly membershipKnown: boolean;
}

export interface SceneDeviationReport {
  readonly clipId: string;
  readonly frame: SceneComparisonFrame;
  readonly referenceTime: number;
  readonly localTime: number;
  readonly rmsMeters: number;
  readonly maxMeters: number;
  readonly comparedCount: number;
  readonly objects: readonly SceneObjectDeviation[];
}

export interface CorrespondenceLine {
  readonly objectId: string;
  readonly reference: Vector3Tuple;
  readonly editable: Vector3Tuple;
}

/* ------------------------------------------------------------------ timing */

/** Mid-hold instant of the extracted reference interval (the extraction frame). */
export function extractedComparisonTime(binding: ReferenceClipBinding): number {
  return (binding.referenceHoldStart + binding.referenceEnd) / 2;
}

/**
 * ONE clock for the whole scene: every object of a composed scene is compared at
 * the SAME absolute reference time. There is no per-object comparison clock.
 */
export function comparisonReferenceTime(
  binding: ReferenceClipBinding,
  clip: TimelineClip,
  frame: SceneComparisonFrame,
  currentTime: number,
): number {
  if (frame === "EXTRACTED") return extractedComparisonTime(binding);
  const local = Math.max(0, currentTime - clip.start);
  const t = binding.referenceStart + local;
  return Math.min(binding.referenceEnd, Math.max(binding.referenceStart, t));
}

/* -------------------------------------------------------------- membership */

/** Stored source drone ids of one scene object (empty when not recorded). */
export function objectSourceDroneIds(
  project: ShowProject,
  object: SceneFormationInstance,
): readonly string[] {
  const src = object.source;
  const formationId =
    src.kind === "STATIC"
      ? src.formationId
      : (project.dynamicFormations ?? []).find((d) => d.id === src.dynamicFormationId)
          ?.sourceFormationId;

  if (!formationId) return [];
  const raw = project.formations.find((f) => f.id === formationId)?.params?.["sourceDroneIds"];
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  return raw.trim().split(/\s+/);
}

function droneIndexMap(show: ReferenceShow): Map<string, number> {
  const map = new Map<string, number>();
  show.drones.forEach((d, i) => map.set(d.sourceId, i));
  return map;
}

/* --------------------------------------------------------------- ghost data */

/**
 * ORIGINAL imported positions of a clip at the comparison instant, grouped by
 * scene object when the extraction recorded membership.
 */
export function referenceGhostFrame(args: {
  readonly show: ReferenceShow;
  readonly project: ShowProject;
  readonly scene: FormationScene;
  readonly clip: TimelineClip;
  readonly binding: ReferenceClipBinding;
  readonly frame: SceneComparisonFrame;
  readonly currentTime: number;
}): ReferenceGhostFrame {
  const { show, project, scene, clip, binding, frame } = args;
  const referenceTime = comparisonReferenceTime(binding, clip, frame, args.currentTime);
  const samples = sampleReferenceShow(show, referenceTime);
  const byId = droneIndexMap(show);
  const groups: ReferenceGhostGroup[] = [];

  for (const object of scene.objects) {
    const ids = objectSourceDroneIds(project, object);
    if (ids.length > 0) {
      const droneIndices = ids
        .map((id) => byId.get(id))
        .filter((i): i is number => i !== undefined);
      groups.push({
        objectId: object.id,
        name: object.name,
        sourceDroneIds: ids,
        droneIndices,
        points: droneIndices.map((i) => samples[i]!.position),
        membershipKnown: true,
      });
      continue;
    }
    // No recorded membership: the object stands for the whole imported fleet
    // (the single-object extraction case). Membership is never re-inferred.
    const droneIndices = samples.map((_, i) => i);
    groups.push({
      objectId: object.id,
      name: object.name,
      sourceDroneIds: show.drones.map((d) => d.sourceId),
      droneIndices,
      points: samples.map((s) => s.position),
      membershipKnown: false,
    });
  }

  return {
    clipId: clip.id,
    frame,
    referenceTime,
    localTime: referenceTime - binding.referenceStart,
    groups,
  };
}

/* ----------------------------------------------------------------- metrics */

function centroid(points: readonly Vector3Tuple[]): Vector3Tuple {
  if (points.length === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length;
  return [x / n, y / n, z / n];
}

/**
 * DESIGN deviation of one object: how far the editable geometry drifted from the
 * imported geometry it was extracted from. Correspondence is index aligned,
 * exactly as the extractor wrote it.
 */
export function objectDeviation(args: {
  readonly objectId: string;
  readonly name: string;
  readonly reference: readonly Vector3Tuple[];
  readonly editable: readonly Vector3Tuple[];
  readonly membershipKnown: boolean;
}): SceneObjectDeviation {
  const n = Math.min(args.reference.length, args.editable.length);
  const ref = args.reference.slice(0, n);
  const edit = args.editable.slice(0, n);
  const rc = centroid(ref);
  const ec = centroid(edit);
  let sq = 0;
  let max = 0;
  let refExtent = 0;
  let editExtent = 0;
  let cross = 0;
  let dot = 0;
  for (let i = 0; i < n; i++) {
    const r = ref[i]!;
    const e = edit[i]!;
    const d = Math.hypot(e[0] - r[0], e[1] - r[1], e[2] - r[2]);
    sq += d * d;
    if (d > max) max = d;
    const rx = r[0] - rc[0];
    const ry = r[1] - rc[1];
    const rz = r[2] - rc[2];
    const ex = e[0] - ec[0];
    const ey = e[1] - ec[1];
    const ez = e[2] - ec[2];
    refExtent += rx * rx + ry * ry + rz * rz;
    editExtent += ex * ex + ey * ey + ez * ez;
    // Planar (XZ) best-fit rotation about +Y — the axis real shows rotate about.
    cross += rx * ez - rz * ex;
    dot += rx * ex + rz * ez;
  }
  const centroidShift: Vector3Tuple = [ec[0] - rc[0], ec[1] - rc[1], ec[2] - rc[2]];
  const meaningfulRotation = refExtent > 1e-6 && Math.hypot(cross, dot) > 1e-6;
  return {
    objectId: args.objectId,
    name: args.name,
    comparedCount: n,
    rmsMeters: n > 0 ? Math.sqrt(sq / n) : 0,
    maxMeters: max,
    centroidShift,
    centroidShiftMeters: Math.hypot(centroidShift[0], centroidShift[1], centroidShift[2]),
    scaleChange: refExtent > 1e-9 ? Math.sqrt(editExtent / refExtent) : 1,
    rotationDeg: meaningfulRotation ? (Math.atan2(cross, dot) * 180) / Math.PI : null,
    membershipKnown: args.membershipKnown,
  };
}

/**
 * Whole-scene and per-object deviation at the shared comparison instant.
 * Returns null when the scene cannot be resolved (missing geometry) — a
 * comparison never throws into the editor.
 */
export function sceneDeviationReport(args: {
  readonly show: ReferenceShow;
  readonly project: ShowProject;
  readonly scene: FormationScene;
  readonly clip: TimelineClip;
  readonly binding: ReferenceClipBinding;
  readonly frame: SceneComparisonFrame;
  readonly currentTime: number;
}): SceneDeviationReport | null {
  const ghost = referenceGhostFrame(args);
  let resolved;
  try {
    resolved = resolveSceneAt(args.project, args.scene, ghost.localTime);
  } catch {
    return null;
  }
  const objects: SceneObjectDeviation[] = [];
  let sq = 0;
  let count = 0;
  let max = 0;
  for (const group of ghost.groups) {
    const resolvedGroup = resolved.groups.find((g) => g.instanceId === group.objectId);
    if (!resolvedGroup) continue;
    const editable = resolved.points.slice(
      resolvedGroup.offset,
      resolvedGroup.offset + resolvedGroup.pointCount,
    );
    const deviation = objectDeviation({
      objectId: group.objectId ?? resolvedGroup.instanceId,
      name: group.name,
      reference: group.points,
      editable,
      membershipKnown: group.membershipKnown,
    });
    objects.push(deviation);
    sq += deviation.rmsMeters * deviation.rmsMeters * deviation.comparedCount;
    count += deviation.comparedCount;
    if (deviation.maxMeters > max) max = deviation.maxMeters;
  }
  return {
    clipId: args.clip.id,
    frame: args.frame,
    referenceTime: ghost.referenceTime,
    localTime: ghost.localTime,
    rmsMeters: count > 0 ? Math.sqrt(sq / count) : 0,
    maxMeters: max,
    comparedCount: count,
    objects,
  };
}

/**
 * Thin correspondence lines. Restricted to one object by the caller so a
 * 150-drone scene never draws 150 lines unless it is asked to.
 */
export function correspondenceLines(args: {
  readonly show: ReferenceShow;
  readonly project: ShowProject;
  readonly scene: FormationScene;
  readonly clip: TimelineClip;
  readonly binding: ReferenceClipBinding;
  readonly frame: SceneComparisonFrame;
  readonly currentTime: number;
  readonly objectId: string | null;
}): CorrespondenceLine[] {
  const ghost = referenceGhostFrame(args);
  let resolved;
  try {
    resolved = resolveSceneAt(args.project, args.scene, ghost.localTime);
  } catch {
    return [];
  }
  const out: CorrespondenceLine[] = [];
  for (const group of ghost.groups) {
    if (args.objectId && group.objectId !== args.objectId) continue;
    if (!group.membershipKnown && args.objectId === null) continue;
    const resolvedGroup = resolved.groups.find((g) => g.instanceId === group.objectId);
    if (!resolvedGroup) continue;
    const n = Math.min(group.points.length, resolvedGroup.pointCount);
    for (let i = 0; i < n; i++) {
      out.push({
        objectId: resolvedGroup.instanceId,
        reference: group.points[i]!,
        editable: resolved.points[resolvedGroup.offset + i]!,
      });
    }
  }
  return out;
}
