import { useMemo } from "react";
import * as THREE from "three";

import { audienceOrientation, perimeterLocal, type ShowSite } from "@/lib/show/geo";

/**
 * REAL-SITE GEOFENCE OVERLAY (presentation only).
 *
 * Draws the authorised flight polygon the operator authored in WGS84, projected
 * into the show-local frame by the canonical conversion, together with the
 * inner clearance margin and the authorised ceiling. It NEVER computes a
 * verdict: the canonical site classification is the sole authority.
 */
const FENCE = new THREE.Color("#f97316");
const MARGIN = new THREE.Color("#fbbf24");
const AUDIENCE = new THREE.Color("#22d3ee");

function shrunkPolygon(points: { x: number; z: number }[], inset: number) {
  if (inset <= 0) return points;
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cz = points.reduce((s, p) => s + p.z, 0) / points.length;
  return points.map((p) => {
    const dx = p.x - cx;
    const dz = p.z - cz;
    const length = Math.hypot(dx, dz) || 1;
    const scale = Math.max(0, length - inset) / length;
    return { x: cx + dx * scale, z: cz + dz * scale };
  });
}

function loopGeometry(points: { x: number; z: number }[], y: number) {
  const vertices = [...points, points[0]!].map((p) => new THREE.Vector3(p.x, y, p.z));
  return new THREE.BufferGeometry().setFromPoints(vertices);
}

export default function SiteGeofenceOverlay({ site }: { site: ShowSite }) {
  const polygon = useMemo(() => perimeterLocal(site), [site]);

  const audience = useMemo(() => audienceOrientation(site), [site]);

  const audienceLine = useMemo(() => {
    if (!audience) return null;
    return new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.2, 0),
      new THREE.Vector3(audience.local.x, 0.2, audience.local.z),
    ]);
  }, [audience]);

  const geometry = useMemo(() => {
    if (polygon.length < 3) return null;
    const floor = loopGeometry(polygon, 0.05);
    const ceiling = loopGeometry(polygon, site.ceilingM);
    const margin = loopGeometry(shrunkPolygon(polygon, site.marginM), 0.05);
    const walls = new THREE.BufferGeometry().setFromPoints(
      polygon.flatMap((p) => [
        new THREE.Vector3(p.x, 0.05, p.z),
        new THREE.Vector3(p.x, site.ceilingM, p.z),
      ]),
    );
    return { floor, ceiling, margin, walls };
  }, [polygon, site.ceilingM, site.marginM]);

  if (!geometry) return null;

  return (
    <group name="site-geofence">
      <line>
        <primitive object={geometry.floor} attach="geometry" />
        <lineBasicMaterial color={FENCE} transparent opacity={0.9} />
      </line>
      <line>
        <primitive object={geometry.ceiling} attach="geometry" />
        <lineBasicMaterial color={FENCE} transparent opacity={0.45} />
      </line>
      <line>
        <primitive object={geometry.margin} attach="geometry" />
        <lineDashedMaterial color={MARGIN} transparent opacity={0.5} dashSize={2} gapSize={2} />
      </line>
      <lineSegments>
        <primitive object={geometry.walls} attach="geometry" />
        <lineBasicMaterial color={FENCE} transparent opacity={0.25} />
      </lineSegments>
      {audience && audienceLine ? (
        <group name="site-audience">
          <line>
            <primitive object={audienceLine} attach="geometry" />
            <lineBasicMaterial color={AUDIENCE} transparent opacity={0.7} />
          </line>
          <mesh position={[audience.local.x, 0.6, audience.local.z]}>
            <sphereGeometry args={[1.6, 12, 12]} />
            <meshBasicMaterial color={AUDIENCE} transparent opacity={0.8} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}
