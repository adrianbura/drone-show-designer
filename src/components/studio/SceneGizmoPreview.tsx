import { useMemo } from "react";
import * as THREE from "three";

import type { Vector3Tuple } from "@/lib/show/types";

/**
 * Live gesture preview of the drafted scene points. DIAGNOSTIC ONLY: these
 * points are resolved scene geometry, never a plan and never exported.
 */
export default function SceneGizmoPreview({ points }: { points: readonly Vector3Tuple[] }) {
  const geometry = useMemo(() => {
    const array = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      array[i * 3] = p[0];
      array[i * 3 + 1] = p[1];
      array[i * 3 + 2] = p[2];
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(array, 3));
    return g;
  }, [points]);

  if (points.length === 0) return null;
  return (
    <points geometry={geometry}>
      <pointsMaterial size={1.1} sizeAttenuation color="#ffe066" transparent opacity={0.75} />
    </points>
  );
}
