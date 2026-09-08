/**
 * VISUAL STATES — pure snapshots of one visual group's editable properties.
 * States never contain physical drone identities and never duplicate assets.
 */
import type {
  FormationScene,
  InstanceTransform,
  SceneFormationInstance,
  SceneVisualState,
  SceneVisualStateObject,
} from "./types";

const cloneTransform = (transform: InstanceTransform): InstanceTransform => ({
  ...transform,
  position: [...transform.position],
  rotationDeg: [...transform.rotationDeg],
  ...(transform.pivot ? { pivot: [...transform.pivot] } : {}),
});

export function captureSceneVisualState(
  scene: FormationScene,
  groupId: string,
  name: string,
): { readonly scene: FormationScene; readonly stateId: string | null } {
  const group = scene.visualGroups?.find((candidate) => candidate.id === groupId);
  if (!group) return { scene, stateId: null };
  const byId = new Map(scene.objects.map((object) => [object.id, object]));
  const objects: SceneVisualStateObject[] = group.objectIds.flatMap((objectId) => {
    const object = byId.get(objectId);
    if (!object) return [];
    return [
      {
        objectId,
        transform: cloneTransform(object.transform),
        visible: object.visible !== false,
        requestedDroneCount: object.requestedDroneCount ?? null,
        ...(object.lighting ? { lighting: { ...object.lighting } } : {}),
        ...(object.animation ? { animation: { ...object.animation } } : {}),
      },
    ];
  });
  if (objects.length < 2) return { scene, stateId: null };
  const used = new Set((scene.visualStates ?? []).map((state) => state.id));
  let index = (scene.visualStates?.length ?? 0) + 1;
  let stateId = `${scene.id}-state-${index}`;
  while (used.has(stateId)) stateId = `${scene.id}-state-${++index}`;
  const state: SceneVisualState = {
    id: stateId,
    groupId,
    name: name.trim() || `State ${index}`,
    objects,
  };
  return { scene: { ...scene, visualStates: [...(scene.visualStates ?? []), state] }, stateId };
}

function restoreObject(
  object: SceneFormationInstance,
  snapshot: SceneVisualStateObject,
): SceneFormationInstance {
  const {
    visible: _visible,
    requestedDroneCount: _count,
    lighting: _lighting,
    animation: _animation,
    ...base
  } = object;
  return {
    ...base,
    transform: cloneTransform(snapshot.transform),
    ...(snapshot.visible === false ? { visible: false } : {}),
    ...(snapshot.requestedDroneCount !== null && snapshot.requestedDroneCount !== undefined
      ? { requestedDroneCount: snapshot.requestedDroneCount }
      : {}),
    ...(snapshot.lighting ? { lighting: { ...snapshot.lighting } } : {}),
    ...(snapshot.animation ? { animation: { ...snapshot.animation } } : {}),
  };
}

export function applySceneVisualState(scene: FormationScene, stateId: string): FormationScene {
  const state = scene.visualStates?.find((candidate) => candidate.id === stateId);
  if (!state) return scene;
  const group = scene.visualGroups?.find((candidate) => candidate.id === state.groupId);
  if (!group) return scene;
  const memberIds = new Set(group.objectIds);
  const snapshots = new Map(state.objects.map((object) => [object.objectId, object]));
  return {
    ...scene,
    objects: scene.objects.map((object) => {
      if (!memberIds.has(object.id)) return object;
      const snapshot = snapshots.get(object.id);
      return snapshot ? restoreObject(object, snapshot) : object;
    }),
  };
}

export function renameSceneVisualState(
  scene: FormationScene,
  stateId: string,
  name: string,
): FormationScene {
  const trimmed = name.trim();
  if (!trimmed || !scene.visualStates) return scene;
  return {
    ...scene,
    visualStates: scene.visualStates.map((state) =>
      state.id === stateId ? { ...state, name: trimmed } : state,
    ),
  };
}

export function removeSceneVisualState(scene: FormationScene, stateId: string): FormationScene {
  if (!scene.visualStates) return scene;
  return {
    ...scene,
    visualStates: scene.visualStates.filter((state) => state.id !== stateId),
  };
}
