/**
 * DERIVED SCENE GROUPS — a pure authoring/presentation projection.
 *
 * Consecutive DYNAMIC displayed scenes that touch are shown and edited as ONE
 * group; a STATIC scene is always its own group and never joins a dynamic
 * one. Nothing is persisted: clips, reference bindings, signatures and the
 * saved report stay per forensic segment, so export, splices and ownership are
 * untouched by grouping.
 */
import type { ReferenceForensicsReport } from "../forensics/types";
import { displayedSceneSegments } from "./extract";
import type { ReferenceTrajectoryLayer } from "./types";

export interface DisplayedSceneGroup {
  readonly id: string;
  readonly kind: "STATIC" | "DYNAMIC";
  readonly start: number;
  readonly end: number;
  readonly segmentIds: readonly string[];
}

/** Largest gap (s) between dynamic scenes still treated as touching. */
export const GROUP_TOUCH_SECONDS = 0.3;

export function displayedSceneGroups(report: ReferenceForensicsReport): DisplayedSceneGroup[] {
  const groups: { id: string; kind: "STATIC" | "DYNAMIC"; start: number; end: number; segmentIds: string[] }[] = [];
  for (const s of displayedSceneSegments(report)) {
    const kind = s.classification === "STATIC_FORMATION" ? "STATIC" : "DYNAMIC";
    const last = groups.at(-1);
    if (last && kind === "DYNAMIC" && last.kind === "DYNAMIC" && s.startTime <= last.end + GROUP_TOUCH_SECONDS) {
      last.end = Math.max(last.end, s.endTime);
      last.segmentIds.push(s.id);
      continue;
    }
    groups.push({ id: `grp-${s.id}`, kind, start: s.startTime, end: s.endTime, segmentIds: [s.id] });
  }
  return groups;
}

export interface ClipSceneGroup extends DisplayedSceneGroup {
  /** Member clips, in extraction order (bindings' sourceSegmentId). */
  readonly clipIds: readonly string[];
}

/** Maps groups to clips through the layer bindings (derived, never saved). */
export function clipSceneGroups(
  report: ReferenceForensicsReport,
  layer: ReferenceTrajectoryLayer | null,
): ClipSceneGroup[] {
  if (!layer) return [];
  const bySegment = new Map<string, string[]>();
  for (const b of [...layer.bindings].sort((a, c) => a.order - c.order)) {
    if (!b.sourceSegmentId) continue;
    const list = bySegment.get(b.sourceSegmentId) ?? [];
    list.push(b.clipId);
    bySegment.set(b.sourceSegmentId, list);
  }
  return displayedSceneGroups(report).map((g) => ({
    ...g,
    clipIds: g.segmentIds.flatMap((id) => bySegment.get(id) ?? []),
  }));
}

/** The group containing a clip, when it has more than one member. */
export function groupOfClip(groups: readonly ClipSceneGroup[], clipId: string | null): ClipSceneGroup | null {
  if (!clipId) return null;
  const g = groups.find((x) => x.clipIds.includes(clipId));
  return g && g.clipIds.length > 1 ? g : null;
}
