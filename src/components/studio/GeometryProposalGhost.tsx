import { useMemo } from "react";
import * as THREE from "three";

import type { Vector3Tuple } from "@/lib/show/types";

/**
 * GEOMETRY PROPOSAL GHOST — additive preview markers only.
 *
 * Draws PROPOSED positions plus light original→proposed connectors. It never
 * replaces the real drones, never touches their LED colour and never writes to
 * project state.
 */
export default function GeometryProposalGhost({
  original,
  proposed,
}: {
  original: readonly Vector3Tuple[];
  proposed: readonly Vector3Tuple[];
}) {
  const cloud = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(proposed.flatMap((p) => [p[0], p[1], p[2]]), 3),
    );
    return geom;
  }, [proposed]);

  const links = useMemo(() => {
    const positions: number[] = [];
    const n = Math.min(original.length, proposed.length);
    for (let i = 0; i < n; i += 1) {
      const a = original[i]!;
      const b = proposed[i]!;
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    if (!positions.length) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  }, [original, proposed]);

  if (proposed.length === 0) return null;

  return (
    <group>
      <points geometry={cloud}>
        <pointsMaterial
          size={1.8}
          sizeAttenuation
          color="#9be7ff"
          transparent
          opacity={0.75}
          toneMapped={false}
        />
      </points>
      {links ? (
        <lineSegments geometry={links}>
          <lineBasicMaterial color="#9be7ff" transparent opacity={0.25} />
        </lineSegments>
      ) : null}
    </group>
  );
}
