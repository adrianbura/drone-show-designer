import { TransformControls } from "@react-three/drei";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import type { SceneGizmoMode, SceneGroupDelta } from "@/lib/show/scene";
import type { Vector3Tuple } from "@/lib/show/types";

/**
 * VIEWPORT TRANSFORM GIZMO — a pure INPUT DEVICE.
 *
 * The gizmo never computes geometry: it only reports a DELTA relative to the
 * canonical selection pivot. The scene domain applies that delta (one atomic
 * mutation on release), so the planner, conflict detector and validator stay
 * the only authorities over flight output.
 */
const MODE: Record<SceneGizmoMode, "translate" | "rotate" | "scale"> = {
  MOVE: "translate",
  ROTATE: "rotate",
  SCALE: "scale",
};

export default function SceneGizmo({
  pivot,
  mode,
  translateSnap,
  rotateSnap,
  onBegin,
  onUpdate,
  onCommit,
}: {
  pivot: Vector3Tuple;
  mode: SceneGizmoMode;
  /** Metres per step; 0 = free. */
  translateSnap: number;
  /** Degrees per step; 0 = free. */
  rotateSnap: number;
  onBegin: () => void;
  onUpdate: (delta: SceneGroupDelta) => void;
  onCommit: () => void;
}) {
  const proxy = useRef<THREE.Object3D>(new THREE.Object3D());

  // The proxy is re-seeded at the pivot whenever the selection or the mode
  // changes, so every gesture starts from an identity delta.
  useEffect(() => {
    const object = proxy.current;
    if (!object) return;
    object.position.set(pivot[0], pivot[1], pivot[2]);
    object.rotation.set(0, 0, 0);
    object.scale.setScalar(1);
  }, [pivot, mode]);

  return (
    <>
      <primitive object={proxy.current} />
      <TransformControls
        object={proxy.current}
        mode={MODE[mode]}
        size={0.85}
        translationSnap={translateSnap > 0 ? translateSnap : null}
        rotationSnap={rotateSnap > 0 ? (rotateSnap * Math.PI) / 180 : null}
        onMouseDown={onBegin}
        onMouseUp={onCommit}
        onObjectChange={() => {
          const object = proxy.current;
          if (!object) return;
          const scale = (object.scale.x + object.scale.y + object.scale.z) / 3;
          onUpdate({
            position: [
              object.position.x - pivot[0],
              object.position.y - pivot[1],
              object.position.z - pivot[2],
            ],
            rotationDeg: [
              THREE.MathUtils.radToDeg(object.rotation.x),
              THREE.MathUtils.radToDeg(object.rotation.y),
              THREE.MathUtils.radToDeg(object.rotation.z),
            ],
            scaleFactor: scale > 0 ? scale : 1,
          });
        }}
      />
    </>
  );
}
