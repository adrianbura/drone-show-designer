import { useMemo } from "react";
import * as THREE from "three";

import type { SvgDraft } from "@/lib/studio/store";

/**
 * Viewport guide for a pending SVG import: the source contours as lines plus the
 * exact-N sampled points. Pure visualisation — it never influences planning.
 */
export default function SvgDraftPreview({ draft }: { draft: SvgDraft }) {
  const result = draft.result;

  const contourGeometries = useMemo(() => {
    if (!result) return [];
    return result.guideContours
      .filter((c) => c.length > 1)
      .map((c) =>
        new THREE.BufferGeometry().setFromPoints(c.map((p) => new THREE.Vector3(p[0], p[1], p[2]))),
      );
  }, [result]);

  const pointGeometry = useMemo(() => {
    if (!result) return null;
    return new THREE.BufferGeometry().setFromPoints(
      result.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    );
  }, [result]);

  if (!result) return null;

  return (
    <group>
      {contourGeometries.map((geometry, i) => (
        <line key={i}>
          <primitive object={geometry} attach="geometry" />
          <lineBasicMaterial color="#3ba9ff" transparent opacity={0.5} toneMapped={false} />
        </line>
      ))}
      {pointGeometry ? (
        <points>
          <primitive object={pointGeometry} attach="geometry" />
          <pointsMaterial color="#ffd166" size={1.4} sizeAttenuation toneMapped={false} />
        </points>
      ) : null}
    </group>
  );
}
