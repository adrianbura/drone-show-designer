import { describe, expect, it } from "vitest";

import { analyzeFullShow } from "../fullshow";
import { createDemoProject } from "../defaultProject";
import {
  addObject,
  addSceneVisualGroup,
  addSceneVisualStateCue,
  captureSceneVisualState,
  emptyScene,
  upsertScene,
} from "../scene";

describe("visual state timeline safety", () => {
  it("blocks full-show readiness when a state transition exceeds acceleration limits", () => {
    const project = createDemoProject(30);
    const clip = project.timeline.find((candidate) => candidate.phase === "SHOW")!;
    let scene = emptyScene(clip.id, "Fast visual state");
    const ids: string[] = [];
    for (const formation of project.formations.slice(0, 2)) {
      const added = addObject(project, scene, {
        source: { kind: "STATIC", formationId: formation.id },
        name: formation.name,
        requestedDroneCount: 15,
      });
      scene = added.scene;
      ids.push(added.objectId);
    }
    scene = addSceneVisualGroup(scene, "Logo", ids).scene;
    const moved = {
      ...scene,
      objects: scene.objects.map((object) => ({
        ...object,
        transform: { ...object.transform, position: [20, 0, 0] as const },
      })),
    };
    const captured = captureSceneVisualState(moved, moved.visualGroups![0]!.id, "Far right");
    const base = { ...captured.scene, objects: scene.objects };
    const cued = addSceneVisualStateCue(base, captured.stateId!, 1, 0.25);
    expect(cued.ok).toBe(true);
    if (!cued.ok) return;

    const result = analyzeFullShow(upsertScene(project, cued.scene), { sampleRate: 20 });
    expect(result.report.status).toBe("FAIL");
    expect(result.report.exportReadiness.status).toBe("BLOCKED");
    expect(
      result.report.errors.some(
        (issue) =>
          issue.clipId === clip.id &&
          issue.code === "ACCELERATION" &&
          issue.message.includes("Visual-state transition is not flyable"),
      ),
    ).toBe(true);
  });
});
