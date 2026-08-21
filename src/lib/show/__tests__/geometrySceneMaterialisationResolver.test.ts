import { describe, expect, it } from "vitest";

import { createDemoProject } from "../defaultProject";
import { resolveProposalMaterialisation } from "../diagnostics";
import { resolveSceneAt } from "../scene";
import type { FormationScene } from "../scene/types";
import type { ShowProject } from "../types";

function fixture(): { project: ShowProject; scene: FormationScene; time: number } {
  const base = createDemoProject();
  const clip = base.timeline.find((candidate) => (candidate.phase ?? "SHOW") === "SHOW") ?? base.timeline[0]!;
  const formation = base.formations.find((candidate) => candidate.id === clip.formationId) ?? base.formations[0]!;
  const scene: FormationScene = {
    id: clip.id,
    name: "Composite",
    schemaVersion: 1,
    transform: { position: [2, 1, -3], rotationDeg: [0, 8, 0], scale: 1 },
    objects: [
      {
        id: `${clip.id}-a`,
        name: "A",
        source: { kind: "STATIC", formationId: formation.id },
        requestedDroneCount: Math.max(1, Math.floor(formation.points.length / 2)),
        transform: { position: [-5, 0, 0], rotationDeg: [0, 0, 0], scale: 1 },
      },
      {
        id: `${clip.id}-b`,
        name: "B",
        source: { kind: "STATIC", formationId: formation.id },
        requestedDroneCount: Math.max(1, Math.floor(formation.points.length / 3)),
        transform: { position: [5, 0, 2], rotationDeg: [0, 0, 0], scale: 0.8 },
      },
    ],
  };
  const project: ShowProject = { ...base, scenes: [scene] };
  return { project, scene, time: clip.start + clip.transition + Math.min(0.1, Math.max(0, clip.hold / 2)) };
}

describe("geometry proposal materialisation routing", () => {
  it("routes a static composite/subsampled scene to the canonical scene materialiser", () => {
    const { project, scene, time } = fixture();
    const count = resolveSceneAt(project, scene).points.length;
    const result = resolveProposalMaterialisation(project, time, count);
    expect(result).toEqual({ kind: "SCENE", clipId: scene.id, sceneId: scene.id, pointCount: count });
  });

  it("keeps a dynamic scene object explicitly unavailable", () => {
    const { project, scene, time } = fixture();
    const dynamicScene: FormationScene = {
      ...scene,
      objects: [
        scene.objects[0]!,
        { ...scene.objects[1]!, source: { kind: "DYNAMIC", dynamicFormationId: "missing" } },
      ],
    };
    const changed: ShowProject = { ...project, scenes: [dynamicScene] };
    const result = resolveProposalMaterialisation(changed, time, 1);
    expect(result.kind).toBe("UNAVAILABLE");
    if (result.kind === "UNAVAILABLE") expect(result.reason).toContain("dynamic scene object");
  });
});
