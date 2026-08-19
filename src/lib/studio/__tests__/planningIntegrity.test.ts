/**
 * PLANNING STATE INTEGRITY.
 *
 * Applied transition overrides decide the flown trajectory, so they are
 * canonical planning state — not a transient analysis result. These tests pin
 * down (a) the timeline-history snapshot contract (project + overrides move
 * together) and (b) surgical invalidation: an override survives edits that do
 * not change its planning basis, and is dropped when they do.
 */
import { describe, expect, it } from "vitest";

import { createDemoProject } from "@/lib/show/defaultProject";
import { removeTimelineClipReferences } from "@/lib/show/timeline";
import { buildShowPlan } from "@/lib/show/trajectory/schedule";
import { sampleTrajectorySet } from "@/lib/show/trajectory/sampler";
import type { ClipTransitionOverride } from "@/lib/show/trajectory/schedule";
import { clipPhase, type ShowProject } from "@/lib/show/types";
import {
  computeOverrideBasis,
  overrideBasis,
  pruneTransitionOverrides,
  type TimelineHistorySnapshot,
} from "../planningIntegrity";

const project = createDemoProject(24);
const showClips = project.timeline.filter((c) => clipPhase(c) === "SHOW" && c.transition > 0);
const clipA = showClips[0]!;
const clipB = showClips[1] ?? showClips[0]!;

function override(p: ShowProject, clipId: string): ClipTransitionOverride {
  const clip = p.timeline.find((c) => c.id === clipId)!;
  const points = p.formations.find((f) => f.id === clip.formationId)!.points;
  const n = p.droneCount;
  return {
    targetPointIndex: Array.from({ length: n }, (_, i) => (points.length - 1 - i + points.length * 2) % points.length),
    startOffsets: Array.from({ length: n }, (_, i) => (i % 4) * 0.05),
    laneOffsets: Array.from({ length: n }, (_, i) => ((i % 3) - 1) * 0.5),
    strategy: "optimalDistance+optimized",
  };
}

const overrides = { [clipA.id]: override(project, clipA.id), [clipB.id]: override(project, clipB.id) };
const basis = computeOverrideBasis(project, overrides);

/** Minimal model of the store's history + prune lifecycle. */
function snapshot(p: ShowProject, o: Record<string, ClipTransitionOverride>): TimelineHistorySnapshot {
  return { project: p, transitionOverrides: { ...o } };
}

describe("timeline history snapshot", () => {
  it("delete -> undo restores the deleted clip's override exactly", () => {
    const past: TimelineHistorySnapshot[] = [snapshot(project, overrides)];
    const afterDelete = removeTimelineClipReferences(project, clipA.id);
    const remaining = { ...overrides };
    delete remaining[clipA.id];
    expect(remaining[clipA.id]).toBeUndefined();

    const restored = past.pop()!;
    expect(restored.transitionOverrides[clipA.id]).toEqual(overrides[clipA.id]);
    expect(restored.project.timeline.some((c) => c.id === clipA.id)).toBe(true);
    expect(afterDelete.timeline.some((c) => c.id === clipA.id)).toBe(false);
  });

  it("redo removes it again and never touches other clips' overrides", () => {
    const future = [snapshot(removeTimelineClipReferences(project, clipA.id), { [clipB.id]: overrides[clipB.id]! })];
    const redone = future.pop()!;
    expect(redone.transitionOverrides[clipA.id]).toBeUndefined();
    expect(redone.transitionOverrides[clipB.id]).toEqual(overrides[clipB.id]);
  });

  it("restoring a snapshot re-seeds a basis that keeps the override valid", () => {
    const restored = snapshot(project, overrides);
    const reseeded = computeOverrideBasis(restored.project, restored.transitionOverrides);
    const pruned = pruneTransitionOverrides(restored.project, restored.transitionOverrides, reseeded);
    expect(pruned.invalidated).toEqual([]);
    expect(pruned.overrides).toEqual(overrides);
  });
});

describe("override validity under timing edits", () => {
  function patch(clipId: string, p: Partial<{ start: number; transition: number; hold: number }>): ShowProject {
    return { ...project, timeline: project.timeline.map((c) => (c.id === clipId ? { ...c, ...p } : c)) };
  }

  it("is timing-dependent: transition resize invalidates only that clip", () => {
    const next = patch(clipA.id, { transition: clipA.transition + 1.5 });
    const pruned = pruneTransitionOverrides(next, overrides, basis);
    expect(pruned.invalidated).toEqual([clipA.id]);
    expect(pruned.overrides[clipB.id]).toEqual(overrides[clipB.id]);
  });

  it("move (start) invalidates the override, because the source state changes", () => {
    const pruned = pruneTransitionOverrides(patch(clipA.id, { start: clipA.start + 2 }), overrides, basis);
    expect(pruned.invalidated).toEqual([clipA.id]);
  });

  it("hold resize is NOT part of the planner override contract and preserves it", () => {
    const next = patch(clipA.id, { hold: clipA.hold + 3 });
    const pruned = pruneTransitionOverrides(next, overrides, basis);
    expect(pruned.invalidated).toEqual([]);
    // Trajectory semantics stay valid: the optimized clip is still planned with
    // the override after the hold-only edit.
    const plan = buildShowPlan(next, { assignmentStrategy: "optimalDistance", transitionOverrides: pruned.overrides });
    expect(plan.optimizedClipIds).toContain(clipA.id);
    const samples = sampleTrajectorySet(plan, { sampleRate: 10 });
    expect(samples.drones.length).toBe(next.droneCount);
  });

  it("drops an override whose clip or formation disappeared", () => {
    const deleted = removeTimelineClipReferences(project, clipA.id);
    expect(overrideBasis(deleted, clipA.id)).toBeNull();
    expect(pruneTransitionOverrides(deleted, overrides, basis).invalidated).toEqual([clipA.id]);
  });

  it("drops an override whose length no longer matches the fleet", () => {
    const resized = { ...project, droneCount: project.droneCount + 4 };
    const pruned = pruneTransitionOverrides(resized, overrides, computeOverrideBasis(resized, overrides));
    expect(pruned.overrides).toEqual({});
  });

  it("undoing a timing edit restores timing and planning together", () => {
    const before = snapshot(project, overrides);
    const edited = patch(clipA.id, { transition: clipA.transition + 1.5 });
    const pruned = pruneTransitionOverrides(edited, overrides, basis);
    expect(pruned.overrides[clipA.id]).toBeUndefined();

    const restoredBasis = computeOverrideBasis(before.project, before.transitionOverrides);
    const afterUndo = pruneTransitionOverrides(before.project, before.transitionOverrides, restoredBasis);
    expect(afterUndo.overrides).toEqual(overrides);
    expect(before.project.timeline.find((c) => c.id === clipA.id)!.transition).toBe(clipA.transition);
  });

  it("stays trajectory-equivalent after undo", () => {
    const a = sampleTrajectorySet(
      buildShowPlan(project, { assignmentStrategy: "optimalDistance", transitionOverrides: overrides }),
      { sampleRate: 10 },
    );
    const restored = snapshot(project, overrides);
    const b = sampleTrajectorySet(
      buildShowPlan(restored.project, {
        assignmentStrategy: "optimalDistance",
        transitionOverrides: restored.transitionOverrides,
      }),
      { sampleRate: 10 },
    );
    for (let d = 0; d < a.drones.length; d++) {
      const x = a.drones[d]!.samples;
      const y = b.drones[d]!.samples;
      expect(y.length).toBe(x.length);
      for (let i = 0; i < x.length; i++) {
        for (let axis = 0; axis < 3; axis++) {
          expect(y[i]!.position[axis]!).toBeCloseTo(x[i]!.position[axis]!, 9);
        }
      }
    }
  });
});
