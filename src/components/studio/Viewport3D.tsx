import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { useStudio } from "@/lib/studio/store";
import { lightColorAt } from "@/lib/show/lights";
import { activeClip, samplePositions } from "@/lib/show/trajectory";
import type { ResolvedClip } from "@/lib/show/trajectory";
import type { ShowProject } from "@/lib/show/types";

/**
 * Instanced drone swarm. One InstancedMesh + per-instance colour keeps draw
 * calls constant, so 200+ drones stay at interactive frame rates.
 */
function Swarm({
  project,
  resolved,
  time,
  playing,
  highlighted,
}: {
  project: ShowProject;
  resolved: ResolvedClip[];
  time: number;
  playing: boolean;
  highlighted: number[];
}) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const halos = useRef<THREE.InstancedMesh>(null);
  const clock = useRef(time);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const highlightSet = useMemo(() => new Set(highlighted), [highlighted]);

  useFrame((_, delta) => {
    clock.current = playing ? (clock.current + delta) % Math.max(1, project.audio.duration) : time;
    const t = playing ? clock.current : time;
    const positions = samplePositions(project, resolved, t);
    const clip = activeClip(resolved, t);
    const bodyMesh = bodies.current;
    const haloMesh = halos.current;
    if (!bodyMesh || !haloMesh) return;

    positions.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      dummy.scale.setScalar(highlightSet.has(i) ? 4.2 : 2.4);
      dummy.updateMatrix();
      haloMesh.setMatrixAt(i, dummy.matrix);

      const c = lightColorAt(clip, i, project.droneCount, t);
      if (highlightSet.has(i)) color.setRGB(1, 0.25, 0.25);
      else color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
      bodyMesh.setColorAt(i, color);
      haloMesh.setColorAt(i, color);
    });
    bodyMesh.instanceMatrix.needsUpdate = true;
    haloMesh.instanceMatrix.needsUpdate = true;
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
    if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        key={`b-${project.droneCount}`}
        ref={bodies}
        args={[undefined, undefined, project.droneCount]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.55, 12, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        key={`h-${project.droneCount}`}
        ref={halos}
        args={[undefined, undefined, project.droneCount]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.55, 8, 8]} />
        <meshBasicMaterial transparent opacity={0.12} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function ShowVolume({ width, depth, height }: { width: number; depth: number; height: number }) {
  return (
    <group position={[0, height / 2, 0]}>
      <mesh>
        <boxGeometry args={[width, height, depth]} />
        <meshBasicMaterial color="#38e0d0" wireframe transparent opacity={0.07} />
      </mesh>
    </group>
  );
}

export default function Viewport3D() {
  const { project, resolved, time, playing, safety } = useStudio();
  const highlighted = useMemo(
    () =>
      safety.issues
        .filter((i) => i.severity === "critical" && Math.abs(i.time - time) < 1.5)
        .flatMap((i) => i.drones),
    [safety.issues, time],
  );

  return (
    <Canvas
      camera={{ position: [90, 60, 110], fov: 42, near: 0.5, far: 3000 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#05070d"]} />
      <fog attach="fog" args={["#05070d", 220, 700]} />
      <ambientLight intensity={0.4} />
      <Grid
        args={[project.area.width * 2, project.area.depth * 2]}
        cellSize={5}
        cellColor="#152232"
        sectionSize={25}
        sectionColor="#1d3b52"
        infiniteGrid
        fadeDistance={520}
        fadeStrength={1.4}
        position={[0, 0, 0]}
      />
      <ShowVolume {...project.area} />
      <Swarm
        project={project}
        resolved={resolved}
        time={time}
        playing={playing}
        highlighted={highlighted}
      />
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, project.area.height * 0.35, 0]}
        minDistance={20}
        maxDistance={600}
      />
    </Canvas>
  );
}
