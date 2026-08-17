import { useMemo } from "react";
import * as THREE from "three";

import type { ComparisonFrame, ComparisonMode } from "@/lib/import/essp/conversion";

const ORIGINAL_COLOR = new THREE.Color("#38e0d0");

/** Blue -> red heatmap of reconstruction error. Diagnostic render only. */
function heatColor(error: number, max: number, out: THREE.Color): THREE.Color {
  const u = max > 0 ? Math.min(1, error / max) : 0;
  return out.setRGB(0.15 + 0.85 * u, 0.55 * (1 - u) + 0.25, 1 - u);
}

/**
 * Diagnostic comparison of an ESSP reference segment against its converted
 * DynamicFormation. Both datasets are read-only: this component only renders.
 */
export default function ConversionOverlay({
  frame,
  mode,
  vectorScale,
}: {
  frame: ComparisonFrame;
  mode: ComparisonMode;
  vectorScale: number;
}) {
  const showOriginal = mode === "ORIGINAL" || mode === "OVERLAY" || mode === "ERROR_VECTORS";
  const showReconstructed = mode !== "ORIGINAL";

  const originalGeometry = useMemo(() => {
    const positions = new Float32Array(frame.original.length * 3);
    frame.original.forEach((p, i) => {
      positions[i * 3] = p[0];
      positions[i * 3 + 1] = p[1];
      positions[i * 3 + 2] = p[2];
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  }, [frame]);

  const reconstructed = useMemo(() => {
    const positions = new Float32Array(frame.reconstructed.length * 3);
    const colors = new Float32Array(frame.reconstructed.length * 3);
    const c = new THREE.Color();
    frame.reconstructed.forEach((p, i) => {
      positions[i * 3] = p[0];
      positions[i * 3 + 1] = p[1];
      positions[i * 3 + 2] = p[2];
      heatColor(frame.errors[i] ?? 0, frame.maxError, c);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geom;
  }, [frame]);

  const vectors = useMemo(() => {
    if (mode !== "ERROR_VECTORS") return null;
    const scale = Math.max(1, vectorScale);
    const positions: number[] = [];
    frame.reconstructed.forEach((r, i) => {
      const o = frame.original[i];
      if (!o) return;
      positions.push(
        r[0],
        r[1],
        r[2],
        r[0] + (o[0] - r[0]) * scale,
        r[1] + (o[1] - r[1]) * scale,
        r[2] + (o[2] - r[2]) * scale,
      );
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  }, [frame, mode, vectorScale]);

  return (
    <group>
      {showOriginal ? (
        <points geometry={originalGeometry}>
          <pointsMaterial size={1.5} sizeAttenuation color={ORIGINAL_COLOR} transparent opacity={0.55} />
        </points>
      ) : null}
      {showReconstructed ? (
        <points geometry={reconstructed}>
          <pointsMaterial size={2.2} sizeAttenuation vertexColors toneMapped={false} />
        </points>
      ) : null}
      {vectors ? (
        <lineSegments geometry={vectors}>
          <lineBasicMaterial color="#ff6b6b" transparent opacity={0.85} />
        </lineSegments>
      ) : null}
    </group>
  );
}
