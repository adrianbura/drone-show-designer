import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { useStudio } from "@/lib/studio/store";
import { lightColorAt } from "@/lib/show/lights";
import { activeClipAt } from "@/lib/show/timeline";
import type { TrajectorySample } from "@/lib/show/trajectory";
import type { ShowProject } from "@/lib/show/types";
import { preShowStatesAt, type PreShowDroneState, type PreShowPlan } from "@/lib/show/preshow";
import SvgDraftPreview from "./SvgDraftPreview";
import PreShowOverlay from "./PreShowOverlay";
import TransitionOverlay from "./TransitionOverlay";
import ReferenceSwarm from "./ReferenceSwarm";

/**
 * Instanced drone swarm. One InstancedMesh + per-instance colour keeps draw
 * calls constant, so 200+ drones stay at interactive frame rates.
 *
 * The viewport CONSUMES computed data: it samples the planned schedules through
 * the store and never generates trajectories itself.
 */
/** Diagnostic pre-show state tint — never used during the artistic show. */
const PRE_SHOW_STATE_RGB: Record<PreShowDroneState, [number, number, number]> = {
  ON_PAD: [0.42, 0.48, 0.56],
  ASCENT: [0.95, 0.71, 0.24],
  TRANSIT: [0.22, 0.88, 0.82],
  STAGED: [0.36, 0.89, 0.48],
  SHOW: [0.22, 0.31, 0.42],
};

function Swarm({
  project,
  time,
  samplesAtTime,
  highlighted,
  preShowPlan,
  showGroups,
  groupIdByDrone,
  groupRgbByDrone,
  selectedGroupId,
}: {
  project: ShowProject;
  time: number;
  samplesAtTime: (t: number) => TrajectorySample[];
  highlighted: number[];
  preShowPlan: PreShowPlan | null;
  showGroups: boolean;
  groupIdByDrone: string[];
  groupRgbByDrone: Map<number, [number, number, number]>;
  selectedGroupId: string | null;
}) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const halos = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const highlightSet = useMemo(() => new Set(highlighted), [highlighted]);

  useFrame(() => {
    const bodyMesh = bodies.current;
    const haloMesh = halos.current;
    if (!bodyMesh || !haloMesh) return;

    const samples = samplesAtTime(time);
    const clip = activeClipAt(project, time);
    // Pre-show context comes from the canonical plan segments — there is no
    // separate pre-show simulation path.
    const states = preShowPlan && time < 0 ? preShowStatesAt(preShowPlan, time) : null;

    samples.forEach((sample, i) => {
      const p = sample.position;
      dummy.position.set(p[0], p[1], p[2]);
      dummy.rotation.set(0, (-sample.yaw * Math.PI) / 180, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      dummy.scale.setScalar(highlightSet.has(i) ? 4.2 : 2.4);
      dummy.updateMatrix();
      haloMesh.setMatrixAt(i, dummy.matrix);

      const c = lightColorAt(clip, i, project.droneCount, time);
      const group = groupRgbByDrone.get(i);
      const dimmed = !!selectedGroupId && groupIdByDrone[i] !== selectedGroupId;
      if (highlightSet.has(i)) color.setRGB(1, 0.25, 0.25);
      else if (dimmed) color.setRGB(0.16, 0.21, 0.28);
      else if (showGroups && group) color.setRGB(group[0], group[1], group[2]);
      else if (states) {
        const s = PRE_SHOW_STATE_RGB[states[i] ?? "ON_PAD"];
        color.setRGB(s[0], s[1], s[2]);
      } else color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
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
  const {
    project,
    time,
    safety,
    samplesAtTime,
    svgDraft,
    plan,
    preShowOverlay,
    showLaunchPads,
    showStaging,
    showLaunchGroups,
    selectedLaunchGroupId,
    transitionAnalysis,
    selectedClipId,
    showPaths,
    showConflicts,
    highlightedDrones,
    referenceShow,
    referencePlayback,
    showReferencePaths,
    forensicActiveDroneIds,
    selectedReferenceDroneId,
  } = useStudio();
  // Reference playback replaces the designed swarm — the two are never mixed.
  const reference = referencePlayback && referenceShow ? referenceShow : null;
  const overlayAnalysis =
    transitionAnalysis && transitionAnalysis.clipId === selectedClipId
      ? transitionAnalysis.analysis
      : null;
  // Live critical violations near the playhead, plus whatever the operator
  // selected in the full-show issue list.
  const highlighted = useMemo(
    () => [
      ...safety.issues
        .filter((i) => i.severity === "critical" && Math.abs(i.time - time) < 1.5)
        .flatMap((i) => i.drones),
      ...highlightedDrones,
    ],
    [safety.issues, time, highlightedDrones],
  );

  const groupRgbByDrone = useMemo(() => {
    const map = new Map<number, [number, number, number]>();
    preShowOverlay?.groups.forEach((g) => {
      const rgb: [number, number, number] = [g.color[0] / 255, g.color[1] / 255, g.color[2] / 255];
      g.droneIndices.forEach((i) => map.set(i, rgb));
    });
    return map;
  }, [preShowOverlay]);

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
      {reference ? null : <ShowVolume {...project.area} />}
      {reference ? (
        <ReferenceSwarm
          show={reference}
          time={time}
          showPaths={showReferencePaths}
          selectedDroneId={selectedReferenceDroneId}
          activeDroneIds={forensicActiveDroneIds}
        />
      ) : null}
      {reference ? null : (
      <Swarm
        project={project}
        time={time}
        samplesAtTime={samplesAtTime}
        highlighted={highlighted}
        preShowPlan={plan.preShow}
        showGroups={showLaunchGroups}
        groupIdByDrone={preShowOverlay?.groupIdByDrone ?? []}
        groupRgbByDrone={groupRgbByDrone}
        selectedGroupId={selectedLaunchGroupId}
      />
      )}
      {!reference && preShowOverlay && plan.preShow && (showLaunchPads || showStaging) ? (
        <PreShowOverlay
          overlay={preShowOverlay}
          plan={plan.preShow}
          time={time}
          showPads={showLaunchPads}
          showStaging={showStaging}
          showGroups={showLaunchGroups}
          selectedGroupId={selectedLaunchGroupId}
        />
      ) : null}
      {!reference && svgDraft ? <SvgDraftPreview draft={svgDraft} /> : null}
      {!reference && overlayAnalysis && (showPaths || showConflicts) ? (
        <TransitionOverlay
          analysis={overlayAnalysis}
          paths={showPaths}
          conflicts={showConflicts}
        />
      ) : null}
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
