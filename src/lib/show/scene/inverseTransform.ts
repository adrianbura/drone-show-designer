import { quatFromEulerDeg, rotateByQuat } from "../dynamic/math";
import type { Vector3Tuple } from "../types";
import type { InstanceTransform } from "./types";

/** Exact inverse of `applyInstanceTransform` for the transform's effective scale. */
export function applyInverseInstanceTransform(
  world: Vector3Tuple,
  transform: InstanceTransform,
  pivot: Vector3Tuple,
): Vector3Tuple {
  const scale = Number.isFinite(transform.scale) && transform.scale !== 0 ? transform.scale : 1;
  const mirror = transform.mirrorX ? -1 : 1;
  const translated: Vector3Tuple = [
    world[0] - pivot[0] - transform.position[0],
    world[1] - pivot[1] - transform.position[1],
    world[2] - pivot[2] - transform.position[2],
  ];
  const q = quatFromEulerDeg(transform.rotationDeg);
  const unrotated = rotateByQuat(translated, [-q[0], -q[1], -q[2], q[3]]);
  return [
    pivot[0] + unrotated[0] / (mirror * scale),
    pivot[1] + unrotated[1] / scale,
    pivot[2] + unrotated[2] / scale,
  ];
}
