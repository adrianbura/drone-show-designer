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
}: {
  show: ReferenceShow;
  time: number;
  showPaths: boolean;
  selectedDroneId: string | null;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const count = show.drones.length;

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
    if (!inst) return;
    const samples = sampleReferenceShow(show, time);
    samples.forEach((sample, i) => {
      dummy.position.set(sample.position[0], sample.position[1], sample.position[2]);
      const selected = selectedDroneId === show.drones[i]?.sourceId;
      dummy.scale.setScalar(selected ? 2.2 : 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      color.setRGB(sample.color[0] / 255, sample.color[1] / 255, sample.color[2] / 255);
      inst.setColorAt(i, color);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh key={`ref-${count}`} ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.55, 12, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {pathGeometry ? (
        <lineSegments geometry={pathGeometry}>
          <lineBasicMaterial color="#38e0d0" transparent opacity={0.32} />
        </lineSegments>
      ) : null}
    </group>
  );
}
