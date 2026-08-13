import { useMemo } from "react";
import * as THREE from "three";

import type { TransitionAnalysis } from "@/lib/show/transition";

/**
 * Read-only 3D overlay for the analysed transition of the selected clip.
 *
 * `paths` draws the sampled trajectory polyline of every drone (post
 * deconfliction, so staggered and lane-shifted paths are visible), and
 * `conflicts` marks the closest-approach point of every detected conflict.
 * Nothing here plans or mutates anything: it only visualises analysis output.
 */
export default function TransitionOverlay({
  analysis,
  paths,
  conflicts,
}: {
  analysis: TransitionAnalysis;
  paths: boolean;
  conflicts: boolean;
}) {
  const pathGeometry = useMemo(() => {
    if (!paths) return null;
    const positions: number[] = [];
    for (const drone of analysis.trajectorySet.drones) {
      const samples = drone.samples;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!.position;
        const b = samples[i]!.position;
        positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  }, [analysis, paths]);

  const conflictPoints = useMemo(() => {
    if (!conflicts) return [];
    return analysis.conflicts.conflicts.slice(0, 400);
  }, [analysis, conflicts]);

  return (
    <group>
      {pathGeometry && (
        <lineSegments geometry={pathGeometry}>
          <lineBasicMaterial color="#38e0d0" transparent opacity={0.28} toneMapped={false} />
        </lineSegments>
      )}
      {conflictPoints.map((c) => (
        <mesh
          key={c.id}
          position={[
            (c.positionA[0] + c.positionB[0]) / 2,
            (c.positionA[1] + c.positionB[1]) / 2,
            (c.positionA[2] + c.positionB[2]) / 2,
          ]}
        >
          <sphereGeometry args={[1.1, 10, 10]} />
          <meshBasicMaterial
            color={c.severity === "critical" ? "#ff4d5e" : "#ffc861"}
            transparent
            opacity={0.5}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
