/**
 * AUDIENCE CAMERA — CAMERA ONLY.
 *
 * Moves the existing camera/orbit target to the diagnostic audience viewpoint
 * and restores the previous framing when disabled. It never touches project
 * coordinates, selection or scene transforms, and it does not replace the
 * existing OrbitControls.
 */
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import type { Vector3Tuple } from "@/lib/show/types";

interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
}

export default function AudienceCameraRig({
  enabled,
  viewer,
  target,
}: {
  enabled: boolean;
  viewer: Vector3Tuple;
  target: Vector3Tuple;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitLike | null;
  const saved = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (!controls) return;
    if (enabled) {
      if (!saved.current) {
        saved.current = { position: camera.position.clone(), target: controls.target.clone() };
      }
      camera.position.set(viewer[0], viewer[1], viewer[2]);
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
      return;
    }
    if (saved.current) {
      camera.position.copy(saved.current.position);
      controls.target.copy(saved.current.target);
      controls.update();
      saved.current = null;
    }
  }, [enabled, controls, camera, viewer[0], viewer[1], viewer[2], target[0], target[1], target[2]]);

  return null;
}
