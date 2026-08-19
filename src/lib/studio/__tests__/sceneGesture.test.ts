import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../../show/defaultProject";
import {
  beginSceneGesture,
  cancelSceneGesture,
  commitSceneGesture,
  previewSceneGesture,
  sceneGestureTargets,
} from "../sceneGesture";
import type { FormationScene } from "../../show/scene";

function project() {
  return createDefaultProject();
}

function scene(id = "clip-1"): FormationScene {
  return {
    id,
    name: "Gesture scene",
    schemaVersion: 1,
    transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1 },
    objects: [
      {
        id: "a",
        name: "A",
        source: { kind: "STATIC", formationId: "f-a" },
        transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1 },
      },
      {
        id: "b",
        name: "B",
        source: { kind: "STATIC", formationId: "f-b" },
        transform: { position: [10, 0, 0], rotationDeg: [0, 0, 0], scale: 1 },
      },
    ],
  };
}

describe("scene gesture transaction", () => {
  it("captures canonical state exactly once and previews without mutating it", () => {
    const before = project();
    const tx = beginSceneGesture({
      clipId: "clip-1",
      objectIds: ["a", "b"],
      project: before,
      transitionOverrides: {},
    });
    const preview = { ...before, name: `${before.name} preview` };
    const next = previewSceneGesture(tx, preview);

    expect(next.before.project).toBe(before);
    expect(next.previewProject).toBe(preview);
    expect(tx.previewProject).toBe(before);
  });

  it("Escape/cancel restores the exact canonical snapshot and creates no alternate state", () => {
    const before = project();
    const tx = previewSceneGesture(
      beginSceneGesture({
        clipId: "clip-1",
        objectIds: ["a"],
        project: before,
        transitionOverrides: {},
      }),
      { ...before, name: "temporary preview" },
    );

    const cancelled = cancelSceneGesture(tx);
    expect(cancelled.project).toBe(before);
    expect(cancelled.transitionOverrides).toEqual({});
  });

  it("pointer-up exposes exactly one undo snapshot and the final preview", () => {
    const before = project();
    const preview1 = { ...before, name: "preview-1" };
    const preview2 = { ...before, name: "preview-2" };
    let tx = beginSceneGesture({
      clipId: "clip-1",
      objectIds: ["a", "b"],
      project: before,
      transitionOverrides: {},
    });
    tx = previewSceneGesture(tx, preview1);
    tx = previewSceneGesture(tx, preview2);

    const commit = commitSceneGesture(tx);
    expect(commit.changed).toBe(true);
    expect(commit.undoSnapshot.project).toBe(before);
    expect(commit.project).toBe(preview2);
  });

  it("reports an unchanged gesture as a no-op", () => {
    const before = project();
    const commit = commitSceneGesture(
      beginSceneGesture({
        clipId: "clip-1",
        objectIds: ["a"],
        project: before,
        transitionOverrides: {},
      }),
    );
    expect(commit.changed).toBe(false);
    expect(commit.project).toBe(before);
  });

  it("reconciles gesture targets against the current scene", () => {
    const before = project();
    const tx = beginSceneGesture({
      clipId: "clip-1",
      objectIds: ["missing", "b", "a"],
      project: before,
      transitionOverrides: {},
    });

    expect(sceneGestureTargets(tx, scene())).toEqual(["b", "a"]);
    expect(sceneGestureTargets(tx, scene("other"))).toEqual([]);
    expect(sceneGestureTargets(tx, null)).toEqual([]);
  });
});
