import { useMemo } from "react";
import * as THREE from "three";

import type { CorrespondenceLine, ReferenceGhostFrame } from "@/lib/import/essp/native";

const SELECTED = new THREE.Color("#38e0d0");
const DIMMED = new THREE.Color("#5b6b78");

/**
 * REFERENCE GHOST: the ORIGINAL imported positions of the selected clip, drawn
 * behind the editable geometry. Read-only diagnostics — it renders reference
 * samples and never plans, promotes or modifies anything. When one scene object
 * is selected, only that object's source drones are highlighted; the rest are
 * dimmed so membership is visible at a glance.
 */
export default function ReferenceGhostSwarm({
  frame,
  selectedObjectId,
  correspondence,
}: {
  frame: ReferenceGhostFrame;
  selectedObjectId: string | null;
  correspondence: readonly CorrespondenceLine[];
}) {
  const cloud = useMemo(() => {
    const points: number[] = [];
    const colors: number[] = [];
    frame.groups.forEach((group) => {
      const dim = selectedObjectId !== null && group.objectId !== selectedObjectId;
      const c = dim ? DIMMED : SELECTED;
      group.points.forEach((p) => {
        points.push(p[0], p[1], p[2]);
        colors.push(c.r, c.g, c.b);
      });
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geom;
  }, [frame, selectedObjectId]);

  const lines = useMemo(() => {
    if (correspondence.length === 0) return null;
    const positions: number[] = [];
    correspondence.forEach((l) => {
      positions.push(l.reference[0], l.reference[1], l.reference[2]);
      positions.push(l.editable[0], l.editable[1], l.editable[2]);
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  }, [correspondence]);

  return (
    <group>
      <points geometry={cloud}>
        <pointsMaterial size={1.4} sizeAttenuation vertexColors transparent opacity={0.5} toneMapped={false} />
      </points>
      {lines ? (
        <lineSegments geometry={lines}>
          <lineBasicMaterial color="#ffb347" transparent opacity={0.5} />
        </lineSegments>
      ) : null}
    </group>
  );
}
