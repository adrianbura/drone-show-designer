import { useMemo } from "react";
import * as THREE from "three";

import type { SafetyLimits, ShowArea, Vector3Tuple } from "@/lib/show/types";

/**
 * SAFETY VOLUME OVERLAY (presentation only).
 *
 * Draws the flight envelope the validator already enforces:
 *   - lateral geofence from `project.area` (width on X, depth on Z),
 *   - altitude floor at `limits.minAltitude`,
 *   - altitude ceiling at `limits.maxAltitude`.
 *
 * It NEVER computes safety verdicts: the breach tint is a local read of the
 * positions the viewport is already sampling, purely so the operator can see
 * when a visual leaves the envelope. The canonical verdict stays in
 * `lib/show/safety.ts`.
 */
export interface SafetyVolumeBreach {
  readonly lateral: number;
  readonly ceiling: number;
  readonly floor: number;
}

export function safetyVolumeBreach(
  positions: readonly Vector3Tuple[],
  area: ShowArea,
  limits: SafetyLimits,
): SafetyVolumeBreach {
  const halfX = area.width / 2;
  const halfZ = area.depth / 2;
  let lateral = 0;
  let ceiling = 0;
  let floor = 0;
  for (const p of positions) {
    if (Math.abs(p[0]) > halfX + 0.01 || Math.abs(p[2]) > halfZ + 0.01) lateral++;
    if (p[1] > limits.maxAltitude + 0.01) ceiling++;
    else if (p[1] > 0.5 && p[1] < limits.minAltitude - 0.01) floor++;
  }
  return { lateral, ceiling, floor };
}

const SAFE = new THREE.Color("#38bdf8");
const ALERT = new THREE.Color("#f87171");

export default function SafetyVolumeOverlay({
  area,
  limits,
  breach,
}: {
  area: ShowArea;
  limits: SafetyLimits;
  breach: SafetyVolumeBreach;
}) {
  const height = Math.max(1, limits.maxAltitude - Math.max(0, limits.minAltitude));
  const midY = Math.max(0, limits.minAltitude) + height / 2;

  const cage = useMemo(() => {
    const box = new THREE.BoxGeometry(Math.max(1, area.width), height, Math.max(1, area.depth));
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [area.width, area.depth, height]);

  const lateralColor = breach.lateral > 0 ? ALERT : SAFE;
  const ceilingColor = breach.ceiling > 0 ? ALERT : SAFE;
  const floorColor = breach.floor > 0 ? ALERT : SAFE;

  return (
    <group name="safety-volume">
      {/* Lateral geofence cage */}
      <lineSegments geometry={cage} position={[0, midY, 0]}>
        <lineBasicMaterial
          color={lateralColor}
          transparent
          opacity={breach.lateral > 0 ? 0.85 : 0.35}
        />
      </lineSegments>

      {/* Ceiling */}
      <mesh position={[0, limits.maxAltitude, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.max(1, area.width), Math.max(1, area.depth)]} />
        <meshBasicMaterial
          color={ceilingColor}
          transparent
          opacity={breach.ceiling > 0 ? 0.16 : 0.05}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Altitude floor (minimum airborne altitude) */}
      {limits.minAltitude > 0.01 && (
        <mesh position={[0, limits.minAltitude, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[Math.max(1, area.width), Math.max(1, area.depth)]} />
          <meshBasicMaterial
            color={floorColor}
            transparent
            opacity={breach.floor > 0 ? 0.16 : 0.05}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}
