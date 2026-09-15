import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { referencePathPoints, sampleReferenceShow, type ReferenceShow } from "@/lib/import/essp";

/**
 * Exact playback of an IMPORTED reference show. Purely presentational: it reads
 * the immutable reference tracks and never plans or modifies anything.
 */
export default function ReferenceSwarm({
  show,
  time,
  showPaths,
  selectedDroneId,
  activeDroneIds = [],
  presentation = false,
}: {
  show: ReferenceShow;
  time: number;
  showPaths: boolean;
  selectedDroneId: string | null;
  /** Forensics: drones moving relative to the rigid formation body. */
  activeDroneIds?: string[];
  presentation?: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const glow = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const count = show.drones.length;
  const activeSet = useMemo(() => new Set(activeDroneIds), [activeDroneIds]);

  const pathGeometry = useMemo(() => {
    if (!showPaths) return null;
    const drones = selectedDroneId
      ? show.drones.filter((d) => d.sourceId === selectedDroneId)
      : show.drones;
    const positions: number[] = [];
    drones.forEach((drone) => {
      const pts = referencePathPoints(drone);
      for (let i = 1; i < pts.length; i += 1) {
        positions.push(...pts[i - 1]!, ...pts[i]!);
      }
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  }, [show, showPaths, selectedDroneId]);

  useFrame(() => {
    const inst = mesh.current;
    const glowMesh = glow.current;
    if (!inst || !glowMesh) return;
    const samples = sampleReferenceShow(show, time);
    samples.forEach((sample, i) => {
      dummy.position.set(sample.position[0], sample.position[1], sample.position[2]);
      const id = show.drones[i]?.sourceId;
      const selected = selectedDroneId === id;
      const active = activeSet.size > 0 && id !== undefined && activeSet.has(id);
      dummy.scale.setScalar(selected ? 2.2 : active ? 1.8 : 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      dummy.scale.multiplyScalar(presentation ? 4.8 : 2.4);
      dummy.updateMatrix();
      glowMesh.setMatrixAt(i, dummy.matrix);
      // Highlighting only changes the RENDERED colour; RGB data is untouched.
      if (active) color.setRGB(1, 0.75, 0.2);
      else color.setRGB(sample.color[0] / 255, sample.color[1] / 255, sample.color[2] / 255);
      inst.setColorAt(i, color);
      glowMesh.setColorAt(i, color);
    });
    inst.instanceMatrix.needsUpdate = true;
    glowMesh.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        key={`ref-${count}`}
        ref={mesh}
        args={[undefined, undefined, count]}
        frustumCulled={false}
      >
        <sphereGeometry args={[presentation ? 0.7 : 0.55, 12, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        key={`ref-glow-${count}`}
        ref={glow}
        args={[undefined, undefined, count]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.55, 8, 8]} />
        <meshBasicMaterial
          transparent
          opacity={presentation ? 0.24 : 0.1}
          depthWrite={false}
          toneMapped={false}
          blending={presentation ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </instancedMesh>
      {pathGeometry ? (
        <lineSegments geometry={pathGeometry}>
          <lineBasicMaterial color="#38e0d0" transparent opacity={0.32} />
        </lineSegments>
      ) : null}
    </group>
  );
}
