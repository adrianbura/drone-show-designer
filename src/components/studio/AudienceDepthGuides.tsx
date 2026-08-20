/**
 * DEPTH GUIDES — additive diagnostic geometry only.
 *
 * Draws a faint segment from each drone to its position on the audience target
 * plane (z = 0), so depth offsets become visible. It NEVER recolours drone LEDs
 * and adds no material to the swarm itself.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import type { TrajectorySample } from "@/lib/show/trajectory";

export default function AudienceDepthGuides({
  count,
  time,
  samplesAtTime,
}: {
  count: number;
  time: number;
  samplesAtTime: (t: number) => TrajectorySample[];
}) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    return g;
  }, [count]);
  const ref = useRef<THREE.LineSegments>(null);

  useFrame(() => {
    if (!ref.current) return;
    const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const samples = samplesAtTime(time);
    for (let i = 0; i < count; i += 1) {
      const p = samples[i]?.position ?? [0, 0, 0];
      arr[i * 6 + 0] = p[0];
      arr[i * 6 + 1] = p[1];
      arr[i * 6 + 2] = p[2];
      arr[i * 6 + 3] = p[0];
      arr[i * 6 + 4] = p[1];
      arr[i * 6 + 5] = 0;
    }
    attr.needsUpdate = true;
  });

  return (
    <lineSegments ref={ref} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#38e0d0" transparent opacity={0.22} depthWrite={false} />
    </lineSegments>
  );
}
