/**
 * Top-down (X / Z) preview of the launch grid. Purely derived from the
 * canonical `buildLaunchLayout` engine output — this component never computes
 * pad geometry itself, so the preview can never disagree with the planner.
 */
import { useMemo } from "react";

import { buildLaunchLayout } from "@/lib/show/preshow/launchGrid";
import type { LaunchGridConfig } from "@/lib/show/preshow/types";

export default function LaunchGridPreview({
  droneCount,
  launch,
  height = 190,
  highlightFirst = true,
}: {
  droneCount: number;
  launch: LaunchGridConfig;
  height?: number;
  highlightFirst?: boolean;
}) {
  const layout = useMemo(() => {
    try {
      return buildLaunchLayout(Math.max(1, Math.round(droneCount)), launch);
    } catch {
      return null;
    }
  }, [droneCount, launch]);

  if (!layout || layout.pads.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-border bg-surface-sunken font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
        style={{ height }}
      >
        no pads
      </div>
    );
  }

  const pad = 12;
  const width = 260;
  const xs = layout.pads.map((p) => p.position[0]);
  const zs = layout.pads.map((p) => p.position[2]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const spanX = maxX - minX || 1;
  const spanZ = maxZ - minZ || 1;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanZ);
  // +Z (forward) points away from the viewer, so it is drawn upwards.
  const px = (x: number) => pad + (x - minX) * scale + (width - pad * 2 - spanX * scale) / 2;
  const py = (z: number) => height - pad - (z - minZ) * scale - (height - pad * 2 - spanZ * scale) / 2;
  const radius = Math.max(1.4, Math.min(4, scale * 0.32));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full rounded-md border border-border bg-surface-sunken"
      style={{ height }}
      role="img"
      aria-label={`Launch grid preview, ${layout.pads.length} pads`}
    >
      <line
        x1={px(layout.center[0])}
        y1={pad / 2}
        x2={px(layout.center[0])}
        y2={height - pad / 2}
        stroke="currentColor"
        strokeWidth={0.5}
        className="text-border"
      />
      <line
        x1={pad / 2}
        y1={py(layout.center[2])}
        x2={width - pad / 2}
        y2={py(layout.center[2])}
        stroke="currentColor"
        strokeWidth={0.5}
        className="text-border"
      />
      {layout.pads.map((p, i) => (
        <circle
          key={p.id}
          cx={px(p.position[0])}
          cy={py(p.position[2])}
          r={radius}
          className={
            highlightFirst && i === 0
              ? "fill-accent"
              : p.row === 0
                ? "fill-primary/80"
                : "fill-muted-foreground/60"
          }
        />
      ))}
    </svg>
  );
}
