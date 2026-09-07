import { useMemo } from "react";
import * as THREE from "three";

import type { SafetyLimits, ShowArea } from "@/lib/show/types";

/**
 * SAFETY VOLUME OVERLAY (presentation only).
 *
 * Draws the flight envelope the validator already enforces:
 *   - lateral geofence from `project.area` (width on X, depth on Z),
 *   - altitude floor at `limits.minAltitude`,
 *   - altitude ceiling at `limits.maxAltitude`.
 *
 * It NEVER computes safety verdicts. The canonical validator is the sole
 * authority for warnings and blockers; this component only makes its configured
 * geometric envelope visible.
 */
const SAFE = new THREE.Color("#38bdf8");

export default function SafetyVolumeOverlay({
  area,
  limits,
}: {
  area: ShowArea;
  limits: SafetyLimits;
}) {
  const height = Math.max(1, limits.maxAltitude - Math.max(0, limits.minAltitude));
  const midY = Math.max(0, limits.minAltitude) + height / 2;

  const cage = useMemo(() => {
    const box = new THREE.BoxGeometry(Math.max(1, area.width), height, Math.max(1, area.depth));
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [area.width, area.depth, height]);

  return (
    <group name="safety-volume">
      {/* Lateral geofence cage */}
      <lineSegments geometry={cage} position={[0, midY, 0]}>
        <lineBasicMaterial color={SAFE} transparent opacity={0.35} />
      </lineSegments>

      {/* Ceiling */}
      <mesh position={[0, limits.maxAltitude, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.max(1, area.width), Math.max(1, area.depth)]} />
        <meshBasicMaterial
          color={SAFE}
          transparent
          opacity={0.05}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Altitude floor (minimum airborne altitude) */}
      {limits.minAltitude > 0.01 && (
        <mesh position={[0, limits.minAltitude, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[Math.max(1, area.width), Math.max(1, area.depth)]} />
          <meshBasicMaterial
            color={SAFE}
            transparent
            opacity={0.05}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}
