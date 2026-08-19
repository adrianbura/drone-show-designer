/**
 * INTERVAL / BOUNDARY OWNERSHIP — the splice contract.
 *
 * Show time is tiled by the extracted clips, each contributing a TRANSITION
 * interval followed by a HOLD interval, using the REFERENCE times the clip was
 * extracted from (any timing edit promotes the clip, so a reference-owned
 * interval always still sits at its reference time).
 *
 *   HOLD(k)       owner = binding(k).owner
 *   TRANSITION(k) owner = binding(k).owner AND binding(k-1).owner
 *
 * The transition rule is the whole point: a reference transition is only valid
 * while BOTH of its endpoints are still reference endpoints. If the previous
 * clip was promoted, its hold ends wherever the planner puts it, so the
 * following transition must be planned too. This is exactly the "mathematically
 * necessary transition boundary" — one interval, never a whole-show rebuild.
 */
import type { ShowProject } from "../../../show/types";
import { clipOutputSignature, type ClipSignatureContext } from "./signature";
import {
  type ReferenceClipBinding,
  type ReferenceIntervalOwner,
  type ReferenceLayerReconciliation,
  type ReferenceOwnershipSummary,
  type ReferencePromotion,
  type ReferenceTrajectoryLayer,
  type ResolvedReferenceInterval,
} from "./types";

function sortedBindings(layer: ReferenceTrajectoryLayer): ReferenceClipBinding[] {
  return [...layer.bindings].sort((a, b) => a.order - b.order || a.referenceStart - b.referenceStart);
}

const both = (a: ReferenceIntervalOwner, b: ReferenceIntervalOwner): ReferenceIntervalOwner =>
  a === "REFERENCE" && b === "REFERENCE" ? "REFERENCE" : "PLANNER";

/** Derives every playback interval of the spliced show, in time order. */
export function resolveReferenceIntervals(
  layer: ReferenceTrajectoryLayer,
): ResolvedReferenceInterval[] {
  const bindings = sortedBindings(layer);
  const intervals: ResolvedReferenceInterval[] = [];
  bindings.forEach((binding, index) => {
    const previous = index > 0 ? bindings[index - 1] : undefined;
    if (binding.referenceHoldStart > binding.referenceStart) {
      intervals.push({
        clipId: binding.clipId,
        kind: "TRANSITION",
        start: binding.referenceStart,
        end: binding.referenceHoldStart,
        owner: previous ? both(binding.owner, previous.owner) : binding.owner,
        clipKind: binding.kind,
      });
    }
    if (binding.referenceEnd > binding.referenceHoldStart) {
      intervals.push({
        clipId: binding.clipId,
        kind: "HOLD",
        start: binding.referenceHoldStart,
        end: binding.referenceEnd,
        owner: binding.owner,
        clipKind: binding.kind,
      });
    }
  });
  return intervals;
}

export function referenceOwnershipSummary(
  layer: ReferenceTrajectoryLayer,
): ReferenceOwnershipSummary {
  const intervals = resolveReferenceIntervals(layer);
  let referenceSeconds = 0;
  let plannerSeconds = 0;
  let referenceIntervalCount = 0;
  let plannerIntervalCount = 0;
  for (const interval of intervals) {
    const span = Math.max(0, interval.end - interval.start);
    if (interval.owner === "REFERENCE") {
      referenceSeconds += span;
      referenceIntervalCount += 1;
    } else {
      plannerSeconds += span;
      plannerIntervalCount += 1;
    }
  }
  return {
    intervals,
    referenceIntervalCount,
    plannerIntervalCount,
    referenceSeconds,
    plannerSeconds,
    promotedClipIds: layer.bindings.filter((b) => b.owner === "PLANNER").map((b) => b.clipId),
  };
}

/** The interval that owns playback at `time`, or null outside the tiled range. */
export function intervalAtTime(
  layer: ReferenceTrajectoryLayer,
  time: number,
): ResolvedReferenceInterval | null {
  const intervals = resolveReferenceIntervals(layer);
  for (const interval of intervals) {
    if (time >= interval.start && time < interval.end) return interval;
  }
  const last = intervals[intervals.length - 1];
  if (last && time >= last.end && time <= last.end + 1e-6) return last;
  return null;
}

export function isReferenceOwnedAt(layer: ReferenceTrajectoryLayer, time: number): boolean {
  return intervalAtTime(layer, time)?.owner === "REFERENCE";
}

function intervalsChangedBy(
  bindings: readonly ReferenceClipBinding[],
  clipId: string,
): { kinds: ReferencePromotion["affectedIntervals"]; clipIds: string[] } {
  const ordered = [...bindings].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((b) => b.clipId === clipId);
  const next = index >= 0 ? ordered[index + 1] : undefined;
  const clipIds = [clipId];
  if (next && next.referenceHoldStart > next.referenceStart) clipIds.push(next.clipId);
  return { kinds: ["TRANSITION", "HOLD"], clipIds };
}

/**
 * Promotes the given clips to planner ownership. Nothing else moves: the
 * closure over the following transition is DERIVED by `resolveReferenceIntervals`
 * rather than written into other bindings, so an unrelated clip can never be
 * silently regenerated.
 */
export function promoteReferenceClips(
  layer: ReferenceTrajectoryLayer,
  requests: readonly { clipId: string; reason: ReferencePromotion["reason"]; signature?: string }[],
  now = new Date().toISOString(),
): ReferenceLayerReconciliation {
  const promotions: ReferencePromotion[] = [];
  let bindings = layer.bindings.map((b) => ({ ...b }));
  for (const request of requests) {
    const target = bindings.find((b) => b.clipId === request.clipId);
    if (!target || target.owner === "PLANNER") {
      // Already planner-owned: refresh the signature so the same edit is not
      // reported again, but do not emit a duplicate promotion.
      if (target && request.signature) target.signature = request.signature;
      continue;
    }
    target.owner = "PLANNER";
    target.promotedAt = now;
    target.promotionReason = request.reason;
    if (request.signature) target.signature = request.signature;
    const affected = intervalsChangedBy(bindings, request.clipId);
    promotions.push({
      clipId: request.clipId,
      reason: request.reason,
      affectedIntervals: affected.kinds,
      affectedClipIds: affected.clipIds,
    });
  }
  if (promotions.length === 0) return { layer, promotions: [], changed: false };
  return { layer: { ...layer, bindings }, promotions, changed: true };
}

/**
 * Compares the live project against the recorded flight-output signatures and
 * promotes exactly the intervals whose output changed. Deleted clips lose their
 * binding (their interval becomes planner-owned by construction).
 */
export function reconcileReferenceLayer(
  project: ShowProject,
  layer: ReferenceTrajectoryLayer,
  context: ClipSignatureContext,
  now = new Date().toISOString(),
): ReferenceLayerReconciliation {
  const requests: { clipId: string; reason: ReferencePromotion["reason"]; signature?: string }[] = [];
  const removed: string[] = [];
  for (const binding of layer.bindings) {
    const signature = clipOutputSignature(project, binding.clipId, context);
    if (signature === null) {
      removed.push(binding.clipId);
      if (binding.owner === "REFERENCE") {
        requests.push({ clipId: binding.clipId, reason: "CLIP_REMOVED" });
      }
      continue;
    }
    if (signature !== binding.signature) {
      requests.push({ clipId: binding.clipId, reason: "OUTPUT_SIGNATURE_CHANGED", signature });
    }
  }
  const promoted = promoteReferenceClips(layer, requests, now);
  if (removed.length === 0) return promoted;
  const bindings = promoted.layer.bindings.filter((b) => !removed.includes(b.clipId));
  return {
    layer: { ...promoted.layer, bindings },
    promotions: promoted.promotions,
    changed: true,
  };
}

/** Re-seeds signatures without changing ownership (used after load / extraction). */
export function reseedReferenceSignatures(
  project: ShowProject,
  layer: ReferenceTrajectoryLayer,
  context: ClipSignatureContext,
): ReferenceTrajectoryLayer {
  const bindings = layer.bindings.map((binding) => {
    const signature = clipOutputSignature(project, binding.clipId, context);
    return signature === null ? binding : { ...binding, signature };
  });
  return { ...layer, bindings };
}
