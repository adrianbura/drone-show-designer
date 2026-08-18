import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { resolveGridShape, rotateXZ } from "@/lib/show/preshow/launchGrid";
import {
  preShowStatesAt,
  type PreShowDroneState,
  type PreShowOverlayModel,
} from "@/lib/show/preshow";
import type { Vector3Tuple } from "@/lib/show/types";

/**
 * Read-only LAUNCH / STAGING design guide.
 *
 * Consumes the overlay model computed by the pre-show engine — it never
 * generates pads, staging targets or trajectories, and never affects planning.
 * Pads and staging targets are drawn with instanced meshes so 200+ drones cost a
 * constant number of draw calls.
 *
 * COUNT INVARIANT: the number of rendered pads / staging markers is ALWAYS
 * `overlay.launch.pads.length` / `overlay.staging.targets.length`, i.e. exactly
 * `project.droneCount`. Unoccupied grid cells (grid capacity above the fleet
 * size) are drawn separately as dim, flat guides that can never be mistaken for
 * a drone or a pad.
 */

const STATE_COLOR: Record<PreShowDroneState, THREE.ColorRepresentation> = {
  ON_PAD: "#6b7a8f",
  ASCENT: "#f2b53c",
  TRANSIT: "#38e0d0",
  STAGED: "#5ce27a",
  SHOW: "#38506b",
};

function Instances({
  positions,
  colors,
  radius,
  opacity = 1,
}: {
  positions: Vector3Tuple[];
  colors: THREE.Color[];
  radius: number;
  opacity?: number;
}) {
  const count = positions.length;
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const { matrices, colorArray } = useMemo(() => {
    const dummy = new THREE.Object3D();
    const m: THREE.Matrix4[] = [];
    const c = new Float32Array(count * 3);
    positions.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      m.push(dummy.matrix.clone());
      const col = colors[i] ?? new THREE.Color("#6b7a8f");
      c[i * 3] = col.r;
      c[i * 3 + 1] = col.g;
      c[i * 3 + 2] = col.b;
    });
    return { matrices: m, colorArray: c };
  }, [positions, colors, count]);

  // Explicitly re-write EVERY instance and pin `mesh.count`, so a fleet-size
  // change can never leave instances from the previous size on screen.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = count;
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute("color", new THREE.InstancedBufferAttribute(colorArray, 3));
  }, [matrices, colorArray, count]);

  if (count === 0) return null;

  return (
    <instancedMesh
      key={`inst-${count}`}
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
    >
      <sphereGeometry args={[radius, 8, 8]} />
      <meshBasicMaterial
        vertexColors
        toneMapped={false}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </instancedMesh>
  );
}

/**
 * UNOCCUPIED grid cells — capacity guides only. Flat, dim, wireframe rings laid
 * on the ground: deliberately unlike the solid pad spheres and drone bodies.
 */
function GridGuides({ overlay }: { overlay: PreShowOverlayModel }) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const positions = useMemo(() => {
    const config = overlay.launch.config;
    const occupied = overlay.launch.pads.length;
    const { rows, columns } = resolveGridShape(Math.max(1, occupied), config);
    const capacity = rows * columns;
    const out: Vector3Tuple[] = [];
    for (let i = occupied; i < capacity; i++) {
      const row = Math.floor(i / columns);
      const column = i % columns;
      const localX = (column - (columns - 1) / 2) * config.spacingX;
      const localZ = (row - (rows - 1) / 2) * config.spacingZ;
      const [rx, rz] = rotateXZ(localX, localZ, config.rotationDeg);
      out.push([rx + config.originX, config.groundAltitude + 0.02, rz + config.originZ]);
    }
    return out;
  }, [overlay]);

  const count = positions.length;

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    mesh.count = count;
    positions.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions, count]);

  if (count === 0) return null;

  return (
    <instancedMesh
      key={`guide-${count}`}
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
    >
      <ringGeometry args={[0.55, 0.7, 12]} />
      <meshBasicMaterial
        color="#33445c"
        transparent
        opacity={0.35}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}


function Footprint({
  corners,
  color,
  opacity = 0.8,
}: {
  corners: Vector3Tuple[];
  color: string;
  opacity?: number;
}) {
  const points = useMemo(
    () =>
      [...corners, corners[0]]
        .filter((p): p is Vector3Tuple => !!p)
        .map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    [corners],
  );
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  return (
    <primitive
      object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }))}
    />
  );
}

function Orientation({
  origin,
  forward,
  right,
  length,
}: {
  origin: Vector3Tuple;
  forward: Vector3Tuple;
  right: Vector3Tuple;
  length: number;
}) {
  const geometry = useMemo(() => {
    const o = new THREE.Vector3(origin[0], origin[1], origin[2]);
    const f = new THREE.Vector3(forward[0], forward[1], forward[2]).multiplyScalar(length).add(o);
    const r = new THREE.Vector3(right[0], right[1], right[2]).multiplyScalar(length * 0.6).add(o);
    return new THREE.BufferGeometry().setFromPoints([o, f, o, r]);
  }, [origin, forward, right, length]);
  return (
    <primitive
      object={new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#f2b53c" }))}
    />
  );
}

export default function PreShowOverlay({
  overlay,
  plan,
  time,
  showPads,
  showStaging,
  showGroups,
  selectedGroupId,
}: {
  overlay: PreShowOverlayModel;
  plan: Parameters<typeof preShowStatesAt>[0];
  time: number;
  showPads: boolean;
  showStaging: boolean;
  showGroups: boolean;
  selectedGroupId: string | null;
}) {
  // Coarse pre-show state per drone, read from the canonical plan segments.
  const states = useMemo(
    () => (time < 0 ? preShowStatesAt(plan, time) : null),
    [plan, time],
  );

  const groupColorByDrone = useMemo(() => {
    const map = new Map<number, THREE.Color>();
    overlay.groups.forEach((g) => {
      const c = new THREE.Color(g.color[0] / 255, g.color[1] / 255, g.color[2] / 255);
      g.droneIndices.forEach((i) => map.set(i, c));
    });
    return map;
  }, [overlay.groups]);

  const colorFor = (droneIndex: number, groupId: string, base: THREE.Color) => {
    if (selectedGroupId && groupId !== selectedGroupId) return new THREE.Color("#2a3648");
    if (showGroups) return groupColorByDrone.get(droneIndex) ?? base;
    if (states) return new THREE.Color(STATE_COLOR[states[droneIndex] ?? "ON_PAD"]);
    return base;
  };

  const padPositions = useMemo(() => overlay.launch.pads.map((p) => p.position), [overlay]);
  const padColors = useMemo(
    () =>
      overlay.launch.pads.map((p) =>
        colorFor(p.droneIndex, p.groupId, new THREE.Color("#4d6178")),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overlay, showGroups, selectedGroupId, states, groupColorByDrone],
  );

  const stagingPositions = useMemo(
    () => overlay.staging.targets.map((t) => t.position),
    [overlay],
  );
  const stagingColors = useMemo(
    () =>
      overlay.staging.targets.map((t) =>
        colorFor(t.droneIndex, t.groupId, new THREE.Color("#38e0d0")),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overlay, showGroups, selectedGroupId, states, groupColorByDrone],
  );

  const launchSpan = Math.max(6, overlay.launch.footprint.depth * 0.35);
  const stagingSpan = Math.max(6, overlay.staging.footprint.depth * 0.35);

  return (
    <group>
      {showPads ? (
        <group>
          <Instances positions={padPositions} colors={padColors} radius={0.7} />
          <Footprint corners={overlay.launch.footprint.corners} color="#38e0d0" opacity={0.5} />
          <Orientation
            origin={[
              overlay.launch.footprint.center[0],
              overlay.launch.groundAltitude + 0.05,
              overlay.launch.footprint.center[2],
            ]}
            forward={overlay.launch.orientation.forward}
            right={overlay.launch.orientation.right}
            length={launchSpan}
          />
        </group>
      ) : null}

      {showStaging ? (
        <group>
          <Instances positions={stagingPositions} colors={stagingColors} radius={0.5} opacity={0.75} />
          <Footprint corners={overlay.staging.footprint.corners} color="#5ce27a" opacity={0.4} />
          <Orientation
            origin={overlay.staging.center}
            forward={overlay.staging.orientation.forward}
            right={overlay.staging.orientation.right}
            length={stagingSpan}
          />
        </group>
      ) : null}
    </group>
  );
}
