import { describe, expect, it } from "vitest";

import { parseProjectFile, serializeProject } from "../../project/serialize";
import { createDefaultProject } from "../defaultProject";
import {
  addObject,
  addSceneVisualGroup,
  emptyScene,
  removeObject,
  removeSceneVisualGroup,
  renameSceneVisualGroup,
  resolveSceneAt,
  sanitizeScenes,
} from "../scene";

function fixture() {
  const project = createDefaultProject(30);
  let scene = emptyScene("clip-visual", "Visual scene");
  const ids: string[] = [];
  for (const formation of project.formations.slice(0, 3)) {
    const added = addObject(project, scene, {
      source: { kind: "STATIC", formationId: formation.id },
      name: formation.name,
    });
    scene = added.scene;
    ids.push(added.objectId);
  }
  return { project, scene, ids };
}

describe("scene visual groups", () => {
  it("groups objects without changing resolved flight geometry", () => {
    const { project, scene, ids } = fixture();
    const before = resolveSceneAt(project, scene, 0);
    const result = addSceneVisualGroup(scene, "Ring with sparkle", ids.slice(0, 2));
    expect(result.groupId).toBe("clip-visual-visual-1");
    expect(result.scene.visualGroups?.[0]?.objectIds).toEqual(ids.slice(0, 2));
    expect(resolveSceneAt(project, result.scene, 0)).toEqual(before);
  });

  it("regroups deterministically and never leaves one-object containers", () => {
    const { scene, ids } = fixture();
    const first = addSceneVisualGroup(scene, "First", ids.slice(0, 2)).scene;
    const second = addSceneVisualGroup(first, "Second", ids.slice(1, 3)).scene;
    expect(second.visualGroups).toHaveLength(1);
    expect(second.visualGroups?.[0]?.objectIds).toEqual(ids.slice(1, 3));
  });

  it("renames and ungroups without removing visual objects", () => {
    const { scene, ids } = fixture();
    const created = addSceneVisualGroup(scene, "Visual", ids.slice(0, 2));
    const renamed = renameSceneVisualGroup(created.scene, created.groupId!, "Engagement ring");
    expect(renamed.visualGroups?.[0]?.name).toBe("Engagement ring");
    const ungrouped = removeSceneVisualGroup(renamed, created.groupId!);
    expect(ungrouped.visualGroups).toEqual([]);
    expect(ungrouped.objects).toEqual(scene.objects);
  });

  it("cleans memberships on object deletion and persisted input", () => {
    const { scene, ids } = fixture();
    const grouped = addSceneVisualGroup(scene, "All", ids).scene;
    expect(removeObject(grouped, ids[0]!).visualGroups?.[0]?.objectIds).toEqual(ids.slice(1));
    const sanitized = sanitizeScenes([
      {
        ...grouped,
        visualGroups: [
          { id: "valid", name: "Valid", objectIds: [ids[0], ids[1], "missing", ids[1]] },
          { id: "invalid", name: "Invalid", objectIds: [ids[0], "missing"] },
        ],
      },
    ]);
    expect(sanitized[0]?.visualGroups).toEqual([
      { id: "valid", name: "Valid", objectIds: ids.slice(0, 2) },
    ]);
  });

  it("survives project save and reopen", () => {
    const { project, scene, ids } = fixture();
    const grouped = addSceneVisualGroup(scene, "Reusable visual", ids.slice(0, 2)).scene;
    const envelope = serializeProject({ ...project, scenes: [grouped] });
    const reopened = parseProjectFile(JSON.stringify(envelope)).project;
    expect(reopened.scenes?.[0]?.visualGroups).toEqual(grouped.visualGroups);
  });
});
