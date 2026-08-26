import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { useCallback, useMemo, useRef } from "react";
import * as THREE from "three";

import { useStudio } from "@/lib/studio/store";
import { useGeometryProposalPreview } from "@/lib/studio/geometryProposalPreview";
import { lightColorAt } from "@/lib/show/lights";
import { emittedColor, type DroneLightState } from "@/lib/show/lighting";
import { activeClipAt } from "@/lib/show/timeline";
import type { TrajectorySample } from "@/lib/show/trajectory";
import type { ShowProject } from "@/lib/show/types";
import { preShowStatesAt, type PreShowDroneState, type PreShowPlan } from "@/lib/show/preshow";
import SvgDraftPreview from "./SvgDraftPreview";
import PreShowOverlay from "./PreShowOverlay";
import TransitionOverlay from "./TransitionOverlay";
import ReferenceSwarm from "./ReferenceSwarm";
import ConversionOverlay from "./ConversionOverlay";
import ReferenceGhostSwarm from "./ReferenceGhostSwarm";
import GeometryProposalGhost from "./GeometryProposalGhost";
import SceneGizmo from "./SceneGizmo";
import SceneGizmoPreview from "./SceneGizmoPreview";

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
  dynamicSelected,
  dynamicGroupRgbByDrone,
  lightingStatesAt,
  onSelectDrone,
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
  /** Drone indices whose dynamic base point is selected for group editing. */
  dynamicSelected: number[];
  /** Motion-group tint per drone while editing a dynamic formation. */
  dynamicGroupRgbByDrone: Map<number, [number, number, number]>;
  /** Per-drone LED state from the lighting engine; empty = no lighting program. */
  lightingStatesAt: (t: number) => DroneLightState[];
  onSelectDrone: (index: number, additive: boolean) => void;
}) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const halos = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const highlightSet = useMemo(() => new Set(highlighted), [highlighted]);
  const selectedSet = useMemo(() => new Set(dynamicSelected), [dynamicSelected]);

  useFrame(() => {
    const bodyMesh = bodies.current;
    const haloMesh = halos.current;
    if (!bodyMesh || !haloMesh) return;

    const samples = samplesAtTime(time);
    const clip = activeClipAt(project, time);
    // Pre-show context comes from the canonical plan segments — there is no
    // separate pre-show simulation path.
    const states = preShowPlan && time < 0 ? preShowStatesAt(preShowPlan, time) : null;
    // LED colours come from the lighting engine — the SAME evaluation path the
    // report and the export use. Empty means "no lighting program authored".
    const lights = time >= 0 ? lightingStatesAt(time) : [];

    samples.forEach((sample, i) => {
      const p = sample.position;
      dummy.position.set(p[0], p[1], p[2]);
      dummy.rotation.set(0, (-sample.yaw * Math.PI) / 180, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      dummy.scale.setScalar(highlightSet.has(i) || selectedSet.has(i) ? 4.2 : 2.4);
      dummy.updateMatrix();
      haloMesh.setMatrixAt(i, dummy.matrix);

      const light = lights[i];
      const c = light ? emittedColor(light) : lightColorAt(clip, i, project.droneCount, time);
      const group = groupRgbByDrone?.get(i);
      const motionGroup = dynamicGroupRgbByDrone?.get(i);
      const dimmed = !!selectedGroupId && groupIdByDrone?.[i] !== selectedGroupId;
      const selected = selectedSet.has(i);
      // SELECTION IS NEVER A COLOUR HACK: when the canonical lighting engine
      // owns the LED at this instant the body keeps its real LED colour and the
      // selection is communicated by the halo ring only.
      if (highlightSet.has(i)) color.setRGB(1, 0.25, 0.25);
      else if (selected && !light) color.setRGB(1, 0.95, 0.55);
      else if (dimmed) color.setRGB(0.16, 0.21, 0.28);
      else if (showGroups && group) color.setRGB(group[0], group[1], group[2]);
      else if (motionGroup) color.setRGB(motionGroup[0], motionGroup[1], motionGroup[2]);
      else if (states) {
        const s = PRE_SHOW_STATE_RGB[states[i] ?? "ON_PAD"];
        color.setRGB(s[0], s[1], s[2]);
      } else color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
      bodyMesh.setColorAt(i, color);
      if (selected && !highlightSet.has(i)) color.setRGB(1, 0.95, 0.55);

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
        onPointerDown={(e) => {
          // Picking a drone selects the BASE POINT it flies, so the selection
          // survives re-assignment. Shift adds to the current selection.
          if (e.instanceId === undefined) return;
          e.stopPropagation();
          onSelectDrone(e.instanceId, e.shiftKey);
        }}
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
    lightingStatesAt,
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
    conversionComparisonFrame,
    comparisonMode,
    errorVectorScale,
    selectedDroneIndices,
    dynamicGroupRgbByDrone,
    pointIdForDrone,
    togglePointSelection,
    setSelectedPointIds,
    sceneGhostFrame,
    selectedSceneObjectId,
    sceneCorrespondence,
    selectedSceneObjectIds,
    selectSceneObject,
    sceneObjectIdForDrone,
    sceneSelectionMode,
    selectScenePointForDrone,
    selectedScenePointDroneIndices,
    gizmoMode,
    gizmoTranslateSnap,
    gizmoRotateSnap,
    sceneGizmoPivot,
    sceneGizmoPreviewPoints,
    beginSceneGizmo,
    updateSceneGizmo,
    commitSceneGizmo,
  } = useStudio();
  const proposalPreview = useGeometryProposalPreview();
  const handleSelectDrone = useCallback(
    (index: number, additive: boolean) => {
      if (sceneSelectionMode === "POINT" && sceneObjectIdForDrone(index)) {
        selectScenePointForDrone(index, additive);
        return;
      }
      // SCENE-FIRST PICKING: clicking a drone selects the SCENE OBJECT whose
      // resolved points that drone flies. Ctrl/Shift toggles membership.
      const sceneObjectId = sceneObjectIdForDrone(index);
      if (sceneObjectId) {
        selectSceneObject(sceneObjectId, additive ? "TOGGLE" : "REPLACE");
        return;
      }
      const id = pointIdForDrone(index);
      if (!id) return;
      if (additive) togglePointSelection(id);
      else setSelectedPointIds([id]);
    },
    [
      pointIdForDrone,
      sceneSelectionMode,
      sceneObjectIdForDrone,
      selectScenePointForDrone,
      selectSceneObject,
      setSelectedPointIds,
      togglePointSelection,
    ],
  );

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

  /** Drones flying the selected scene objects — highlight only, never flight. */
  const sceneSelectedDrones = useMemo(() => {
    if (selectedSceneObjectIds.length === 0) return [];
    const wanted = new Set(selectedSceneObjectIds);
    const indices: number[] = [];
    for (let i = 0; i < project.droneCount; i++) {
      const id = sceneObjectIdForDrone(i);
      if (id && wanted.has(id)) indices.push(i);
    }
    return indices;
  }, [project.droneCount, sceneObjectIdForDrone, selectedSceneObjectIds]);

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
      {conversionComparisonFrame ? (
        <ConversionOverlay
          frame={conversionComparisonFrame}
          mode={comparisonMode}
          vectorScale={errorVectorScale}
        />
      ) : null}
      {sceneGhostFrame && !reference ? (
        <ReferenceGhostSwarm
          frame={sceneGhostFrame}
          selectedObjectId={selectedSceneObjectId}
          correspondence={sceneCorrespondence}
        />
      ) : null}

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
          dynamicSelected={
            sceneSelectionMode === "POINT"
              ? selectedScenePointDroneIndices
              : sceneSelectedDrones.length > 0
                ? sceneSelectedDrones
                : selectedDroneIndices
          }
          dynamicGroupRgbByDrone={dynamicGroupRgbByDrone}
          lightingStatesAt={lightingStatesAt}
          onSelectDrone={handleSelectDrone}
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
      {!reference && proposalPreview.enabled ? (
        <GeometryProposalGhost
          original={proposalPreview.original}
          proposed={proposalPreview.proposed}
        />
      ) : null}
      {!reference && svgDraft ? <SvgDraftPreview draft={svgDraft} /> : null}
      {!reference && overlayAnalysis && (showPaths || showConflicts) ? (
        <TransitionOverlay analysis={overlayAnalysis} paths={showPaths} conflicts={showConflicts} />
      ) : null}
      {!reference && sceneGizmoPivot ? (
        <>
          <SceneGizmoPreview points={sceneGizmoPreviewPoints} />
          <SceneGizmo
            pivot={sceneGizmoPivot}
            mode={gizmoMode}
            translateSnap={gizmoTranslateSnap}
            rotateSnap={gizmoRotateSnap}
            onBegin={beginSceneGizmo}
            onUpdate={updateSceneGizmo}
            onCommit={commitSceneGizmo}
          />
        </>
      ) : null}
      <OrbitControls
        makeDefault
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
