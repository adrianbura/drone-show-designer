import { describe, expect, it } from "vitest";

import { dynamicFromFormation } from "../../show/dynamic";
import { createDefaultProject } from "../../show/defaultProject";
import { addObject, emptyScene } from "../../show/scene";
import { motionTimelineBlocks } from "../motionTimeline";

describe("motion timeline", () => {
  it("represents the canonical hold interval and instance playback", () => {
    const project = createDefaultProject(12);
    const formation = project.formations.find((candidate) => candidate.id === "f-sphere")!;
    const dynamic = dynamicFromFormation(formation, { id: "dynamic", duration: 4 });
    const clip = {
      id: "clip",
      formationId: formation.id,
      start: 10,
      transition: 6,
      hold: 9,
      easing: "minJerk" as const,
      color: [255, 255, 255] as const,
      effect: "solid" as const,
      phase: "SHOW" as const,
    };
    const added = addObject(project, emptyScene(clip.id, "Scene"), {
      source: { kind: "DYNAMIC", dynamicFormationId: dynamic.id },
      name: "SUPER RALY",
    });
    const scene = {
      ...added.scene,
      objects: added.scene.objects.map((object) => ({
        ...object,
        animation: { playbackRate: 1.5, startOffset: 0 },
      })),
    };
    expect(motionTimelineBlocks(clip, scene, [dynamic])).toEqual([
      expect.objectContaining({
        objectId: added.objectId,
        label: "SUPER RALY",
        start: 16,
        duration: 9,
        cycleDuration: 4,
        playbackRate: 1.5,
      }),
    ]);
  });

  it("does not invent blocks for static or missing dynamic sources", () => {
    const clip = {
      id: "static",
      formationId: "f-sphere",
      start: 0,
      transition: 2,
      hold: 4,
      easing: "minJerk" as const,
      color: [255, 255, 255] as const,
      effect: "solid" as const,
      phase: "SHOW" as const,
    };
    expect(motionTimelineBlocks(clip, emptyScene(clip.id, "Static"), [])).toEqual([]);
  });
});
