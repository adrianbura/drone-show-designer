import type { Vector3Tuple } from "../types";
import { canonicalSceneSelection } from "./selection";
import type { FormationScene } from "./types";

export interface SceneGroupTransformInput {
  readonly objectIds: readonly string[];
  /** World-space centre for every selected scene object. */
  readonly worldCentres: Readonly<Record<string, Vector3Tuple>>;
  /** Deterministic group pivot in world space. */
  readonly pivot: Vector3Tuple;
}

const degToRad = (degrees: number): number => (degrees * Math.PI) / 180;

function rotateVectorXYZ(vector: Vector3Tuple, deltaDeg: Vector3Tuple): Vector3Tuple {
  const rx = degToRad(deltaDeg[0]);
  const ry = degToRad(deltaDeg[1]);
  const rz = degToRad(deltaDeg[2]);

  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  // Same documented Euler order as scene transforms: X -> Y -> Z.
  const x1 = vector[0];
  const y1 = vector[1] * cx - vector[2] * sx;
  const z1 = vector[1] * sx + vector[2] * cx;

  const x2 = x1 * cy + z1 * sy;
  const y2 = y1;
  const z2 = -x1 * sy + z1 * cy;

  return [x2 * cz - y2 * sz, x2 * sz + y2 * cz, z2];
}

/** Arithmetic centroid of the supplied object world centres, in scene order. */
export function sceneGroupPivot(
  scene: FormationScene,
  objectIds: readonly string[],
  worldCentres: Readonly<Record<string, Vector3Tuple>>,
): Vector3Tuple | null {
  const selected = canonicalSceneSelection(scene, objectIds).filter((id) => !!worldCentres[id]);
  if (selected.length === 0) return null;
  const sum: Vector3Tuple = [0, 0, 0];
  for (const id of selected) {
    const centre = worldCentres[id]!;
    sum[0] += centre[0];
    sum[1] += centre[1];
    sum[2] += centre[2];
  }
  return [sum[0] / selected.length, sum[1] / selected.length, sum[2] / selected.length];
}

/**
 * Rotates the selected layout around one common world-space pivot and rotates
 * each selected instance orientation by the same Euler delta.
 *
 * `worldCentres` is supplied by the resolver/store so this pure helper never
 * depends on project assets, Three.js or renderer state.
 */
export function rotateSceneGroupLayout(
  scene: FormationScene,
  input: SceneGroupTransformInput,
  deltaDeg: Vector3Tuple,
): FormationScene {
  if (deltaDeg[0] === 0 && deltaDeg[1] === 0 && deltaDeg[2] === 0) return scene;
  const selected = new Set(canonicalSceneSelection(scene, input.objectIds));
  if (selected.size === 0) return scene;

  let changed = false;
  const objects = scene.objects.map((object) => {
    if (!selected.has(object.id)) return object;
    const centre = input.worldCentres[object.id];
    if (!centre) return object;

    const relative: Vector3Tuple = [
      centre[0] - input.pivot[0],
      centre[1] - input.pivot[1],
      centre[2] - input.pivot[2],
    ];
    const rotated = rotateVectorXYZ(relative, deltaDeg);
    const targetCentre: Vector3Tuple = [
      input.pivot[0] + rotated[0],
      input.pivot[1] + rotated[1],
      input.pivot[2] + rotated[2],
    ];
    const centreDelta: Vector3Tuple = [
      targetCentre[0] - centre[0],
      targetCentre[1] - centre[1],
      targetCentre[2] - centre[2],
    ];
    changed = true;
    return {
      ...object,
      transform: {
        ...object.transform,
        position: [
          object.transform.position[0] + centreDelta[0],
          object.transform.position[1] + centreDelta[1],
          object.transform.position[2] + centreDelta[2],
        ],
        rotationDeg: [
          object.transform.rotationDeg[0] + deltaDeg[0],
          object.transform.rotationDeg[1] + deltaDeg[1],
          object.transform.rotationDeg[2] + deltaDeg[2],
        ],
      },
    };
  });

  return changed ? { ...scene, objects } : scene;
}

/**
 * Scales the selected layout around one common world-space pivot and multiplies
 * each selected object's own uniform scale by the same factor.
 */
export function scaleSceneGroupLayout(
  scene: FormationScene,
  input: SceneGroupTransformInput,
  factor: number,
  minimumScale = 0.05,
): FormationScene {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return scene;
  const selected = new Set(canonicalSceneSelection(scene, input.objectIds));
  if (selected.size === 0) return scene;
  const floor = Math.max(1e-6, minimumScale);

  let changed = false;
  const objects = scene.objects.map((object) => {
    if (!selected.has(object.id)) return object;
    const centre = input.worldCentres[object.id];
    if (!centre) return object;
    const targetCentre: Vector3Tuple = [
      input.pivot[0] + (centre[0] - input.pivot[0]) * factor,
      input.pivot[1] + (centre[1] - input.pivot[1]) * factor,
      input.pivot[2] + (centre[2] - input.pivot[2]) * factor,
    ];
    const centreDelta: Vector3Tuple = [
      targetCentre[0] - centre[0],
      targetCentre[1] - centre[1],
      targetCentre[2] - centre[2],
    ];
    changed = true;
    return {
      ...object,
      transform: {
        ...object.transform,
        position: [
          object.transform.position[0] + centreDelta[0],
          object.transform.position[1] + centreDelta[1],
          object.transform.position[2] + centreDelta[2],
        ],
        scale: Math.max(floor, object.transform.scale * factor),
      },
    };
  });

  return changed ? { ...scene, objects } : scene;
}
