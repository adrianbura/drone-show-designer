import {
  addMotionGroup,
  applyPreset,
  dynamicFromFormation,
  neutralGroupKeyframe,
  patchMotionGroup,
  type DynamicFormation,
  type DynamicPresetId,
} from "../show/dynamic";
import type { ShowProject } from "../show/types";
import { projectScene, upsertScene } from "../show/scene";

export interface SceneMotionAuthoringRequest {
  readonly clipId: string;
  readonly objectIds: readonly string[];
  readonly primaryObjectId: string | null;
  readonly selectedPointIds: readonly string[];
  readonly preset: DynamicPresetId;
  readonly createId: () => string;
}

export interface SceneMotionAuthoringResult {
  readonly project: ShowProject;
  readonly dynamicFormationIds: readonly string[];
  readonly objectIds: readonly string[];
}

function localDynamicPointIds(
  objectId: string,
  selected: readonly string[],
  dynamic: DynamicFormation,
): string[] {
  const known = new Set(dynamic.points.map((point) => point.id));
  return selected
    .filter((id) => id.startsWith(`${objectId}#`))
    .map((id) => id.slice(objectId.length + 1))
    .map((id) => (/^\d+$/.test(id) ? `FP-${String(Number(id) + 1).padStart(3, "0")}` : id))
    .filter((id) => known.has(id));
}

function applyPresetToPoints(
  formation: DynamicFormation,
  pointIds: readonly string[],
  preset: DynamicPresetId,
): DynamicFormation {
  if (pointIds.length === 0) return formation;
  const duration = Math.max(0.1, formation.duration);
  const half = duration / 2;
  const groupId = `mg-selection-${formation.groups.length + 1}`;
  let next = addMotionGroup(formation, `Selection ${preset.toLowerCase()}`, pointIds, groupId);
  const peak = neutralGroupKeyframe(half);
  const keyframes = (() => {
    switch (preset) {
      case "PULSE":
        return [neutralGroupKeyframe(0), { ...peak, scale: 1.18 }, neutralGroupKeyframe(duration)];
      case "ORBIT":
        return [
          neutralGroupKeyframe(0),
          { ...peak, rotation: [0, 180, 0] as const, interpolation: "linear" as const },
          { ...neutralGroupKeyframe(duration), rotation: [0, 360, 0] as const },
        ];
      case "WAVE":
        return [
          neutralGroupKeyframe(0),
          { ...peak, offset: [0, 5, 0] as const },
          neutralGroupKeyframe(duration),
        ];
      case "FLAP":
        return [
          { ...neutralGroupKeyframe(0), rotation: [0, 0, -22] as const },
          { ...neutralGroupKeyframe(duration), rotation: [0, 0, 26] as const },
        ];
      case "TWIST":
        return [
          { ...neutralGroupKeyframe(0), rotation: [0, -18, 0] as const },
          { ...neutralGroupKeyframe(duration), rotation: [0, 18, 0] as const },
        ];
      case "DRIFT":
        return [
          neutralGroupKeyframe(0),
          { ...peak, offset: [12, 3, 0] as const },
          neutralGroupKeyframe(duration),
        ];
    }
  })();
  next = patchMotionGroup(next, groupId, {
    keyframes,
    loop: preset === "ORBIT" ? "REPEAT" : "PING_PONG",
    loopDuration: duration,
  });
  return next;
}

/** One pure project revision: promotion + preset + object binding. */
export function authorSceneMotion(
  project: ShowProject,
  request: SceneMotionAuthoringRequest,
): SceneMotionAuthoringResult {
  const scene = projectScene(project, request.clipId);
  if (!scene) return { project, dynamicFormationIds: [], objectIds: [] };
  const pointScoped = request.selectedPointIds.length > 0 && request.primaryObjectId !== null;
  const wanted = new Set(
    pointScoped && request.primaryObjectId ? [request.primaryObjectId] : request.objectIds,
  );
  if (wanted.size === 0) return { project, dynamicFormationIds: [], objectIds: [] };

  const dynamics = [...(project.dynamicFormations ?? [])];
  const dynamicIds: string[] = [];
  const objectIds: string[] = [];
  const objects = scene.objects.map((object) => {
    if (!wanted.has(object.id)) return object;
    let dynamic: DynamicFormation | undefined;
    const source = object.source;
    if (source.kind === "DYNAMIC") {
      dynamic = dynamics.find((candidate) => candidate.id === source.dynamicFormationId);
    } else {
      const formation = project.formations.find((candidate) => candidate.id === source.formationId);
      if (formation) {
        dynamic = dynamicFromFormation(formation, {
          id: request.createId(),
          duration: 8,
          seed: project.seed,
        });
      }
    }
    if (!dynamic) return object;
    const pointIds = pointScoped
      ? localDynamicPointIds(object.id, request.selectedPointIds, dynamic)
      : [];
    const authored = pointScoped
      ? applyPresetToPoints(dynamic, pointIds, request.preset)
      : applyPreset(dynamic, request.preset);
    const index = dynamics.findIndex((candidate) => candidate.id === authored.id);
    if (index >= 0) dynamics[index] = authored;
    else dynamics.push(authored);
    dynamicIds.push(authored.id);
    objectIds.push(object.id);
    return { ...object, source: { kind: "DYNAMIC" as const, dynamicFormationId: authored.id } };
  });
  if (objectIds.length === 0) return { project, dynamicFormationIds: [], objectIds: [] };
  const next = upsertScene({ ...project, dynamicFormations: dynamics }, { ...scene, objects });
  return { project: next, dynamicFormationIds: dynamicIds, objectIds };
}
