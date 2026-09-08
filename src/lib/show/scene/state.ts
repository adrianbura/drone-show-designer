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
  SceneVisualStateCue,
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
    visualStateCues: scene.visualStateCues?.filter((cue) => cue.stateId !== stateId) ?? [],
  };
}

export type AddVisualStateCueResult =
  | { readonly ok: true; readonly scene: FormationScene; readonly cueId: string }
  | { readonly ok: false; readonly scene: FormationScene; readonly reason: string };

function isTimelineCompatible(scene: FormationScene, state: SceneVisualState): boolean {
  const current = new Map(scene.objects.map((object) => [object.id, object]));
  return state.objects.every((snapshot) => {
    const object = current.get(snapshot.objectId);
    return (
      object !== undefined &&
      (object.visible !== false) === (snapshot.visible !== false) &&
      (object.requestedDroneCount ?? null) === (snapshot.requestedDroneCount ?? null)
    );
  });
}

export function addSceneVisualStateCue(
  scene: FormationScene,
  stateId: string,
  time: number,
  transitionDuration: number,
): AddVisualStateCueResult {
  const state = scene.visualStates?.find((candidate) => candidate.id === stateId);
  if (!state) return { ok: false, scene, reason: "Saved state not found." };
  if (!isTimelineCompatible(scene, state)) {
    return {
      ok: false,
      scene,
      reason: "This state changes visibility or drone allocation and cannot be animated safely.",
    };
  }
  const used = new Set((scene.visualStateCues ?? []).map((cue) => cue.id));
  let index = (scene.visualStateCues?.length ?? 0) + 1;
  let cueId = `${scene.id}-state-cue-${index}`;
  while (used.has(cueId)) cueId = `${scene.id}-state-cue-${++index}`;
  const cue: SceneVisualStateCue = {
    id: cueId,
    groupId: state.groupId,
    stateId,
    time: Math.max(0, Number.isFinite(time) ? time : 0),
    transitionDuration: Math.max(0, Number.isFinite(transitionDuration) ? transitionDuration : 0),
  };
  return {
    ok: true,
    cueId,
    scene: {
      ...scene,
      visualStateCues: [...(scene.visualStateCues ?? []), cue].sort(
        (a, b) => a.time - b.time || a.id.localeCompare(b.id),
      ),
    },
  };
}

export function removeSceneVisualStateCue(scene: FormationScene, cueId: string): FormationScene {
  if (!scene.visualStateCues) return scene;
  return { ...scene, visualStateCues: scene.visualStateCues.filter((cue) => cue.id !== cueId) };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function interpolateTransform(
  from: InstanceTransform,
  to: InstanceTransform,
  progress: number,
): InstanceTransform {
  const vector = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
    [lerp(a[0], b[0], progress), lerp(a[1], b[1], progress), lerp(a[2], b[2], progress)] as const;
  return {
    position: vector(from.position, to.position),
    rotationDeg: vector(from.rotationDeg, to.rotationDeg),
    scale: lerp(from.scale, to.scale, progress),
    ...(progress >= 1 && to.mirrorX ? { mirrorX: true } : from.mirrorX ? { mirrorX: true } : {}),
    ...(to.pivot ? { pivot: [...to.pivot] } : from.pivot ? { pivot: [...from.pivot] } : {}),
  };
}

/** Applies timed visual-state transforms without mutating scene or asset data. */
export function sceneAtVisualStateTime(scene: FormationScene, localTime: number): FormationScene {
  if (!scene.visualStateCues?.length || !scene.visualStates?.length) return scene;
  const states = new Map(scene.visualStates.map((state) => [state.id, state]));
  const transitions = new Map<
    string,
    {
      from: Map<string, SceneVisualStateObject> | null;
      to: Map<string, SceneVisualStateObject>;
      progress: number;
    }
  >();
  for (const group of scene.visualGroups ?? []) {
    let previous: Map<string, SceneVisualStateObject> | null = null;
    const cues = scene.visualStateCues.filter((cue) => cue.groupId === group.id);
    for (const cue of cues) {
      const state = states.get(cue.stateId);
      if (!state) continue;
      const start = cue.time - cue.transitionDuration;
      if (localTime < start) break;
      const target = new Map(state.objects.map((item) => [item.objectId, item]));
      if (localTime < cue.time && cue.transitionDuration > 0) {
        transitions.set(group.id, {
          from: previous,
          to: target,
          progress: Math.max(0, Math.min(1, (localTime - start) / cue.transitionDuration)),
        });
        break;
      }
      previous = target;
      transitions.set(group.id, { from: target, to: target, progress: 1 });
    }
  }
  if (transitions.size === 0) return scene;
  return {
    ...scene,
    objects: scene.objects.map((object) => {
      for (const [groupId, transition] of transitions) {
        if (
          !scene.visualGroups?.find((group) => group.id === groupId)?.objectIds.includes(object.id)
        )
          continue;
        const snapshot = transition.to.get(object.id);
        if (!snapshot) return object;
        const from = transition.from?.get(object.id)?.transform ?? object.transform;
        return {
          ...object,
          transform: interpolateTransform(from, snapshot.transform, transition.progress),
        };
      }
      return object;
    }),
  };
}
