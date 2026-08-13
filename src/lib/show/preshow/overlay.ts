/**
 * PRE-SHOW OVERLAY MODEL — read-only visualization data derived from an
 * existing PreShowPlan.
 *
 * This module contains NO planning logic: it never generates pads, staging
 * targets, groups or trajectories. It reshapes the canonical plan into a flat,
 * deterministic structure the 3D viewport (and tests) can consume without
 * touching engine internals. Nothing here influences trajectory generation.
 */
import type { RGB, Vector3Tuple } from "../types";
import { rotateXZ } from "./launchGrid";
import type {
  LaunchGridConfig,
  PreShowPhaseName,
  PreShowPlan,
  StagingBounds,
  StagingFormationKind,
} from "./types";

export const PRE_SHOW_OVERLAY_VERSION = "0.1.0";

/** Coarse pre-show situation of one drone at a given show time. */
export type PreShowDroneState = "ON_PAD" | "ASCENT" | "TRANSIT" | "STAGED" | "SHOW";

export interface OverlayPad {
  readonly padId: string;
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly position: Vector3Tuple;
  readonly droneId: string;
  readonly droneIndex: number;
  readonly groupId: string;
}

export interface OverlayStagingTarget {
  readonly droneId: string;
  readonly droneIndex: number;
  readonly groupId: string;
  readonly position: Vector3Tuple;
}

export interface OverlayFootprint {
  readonly center: Vector3Tuple;
  readonly width: number;
  readonly depth: number;
  readonly rotationDeg: number;
  /** Rotated footprint corners, counter-clockwise from (-x,-z). */
  readonly corners: Vector3Tuple[];
}

/** Unit heading vectors of a rotated frame, for orientation indicators. */
export interface OverlayOrientation {
  readonly rotationDeg: number;
  readonly right: Vector3Tuple;
  readonly forward: Vector3Tuple;
}

export interface OverlayGroup {
  readonly groupId: string;
  readonly index: number;
  readonly droneIndices: number[];
  readonly droneIds: string[];
  readonly padIds: string[];
  readonly padPositions: Vector3Tuple[];
  readonly stagingTargets: Vector3Tuple[];
  /** Deterministic diagnostic colour — never used for the artistic program. */
  readonly color: RGB;
  readonly startTime: number;
}

export interface PreShowOverlayModel {
  readonly overlayVersion: string;
  readonly droneCount: number;
  readonly launch: {
    readonly config: LaunchGridConfig;
    readonly pads: OverlayPad[];
    readonly footprint: OverlayFootprint;
    readonly center: Vector3Tuple;
    readonly groundAltitude: number;
    readonly orientation: OverlayOrientation;
    readonly algorithmVersion: string;
  };
  readonly staging: {
    readonly formationKind: StagingFormationKind;
    readonly formationId: string | null;
    readonly targets: OverlayStagingTarget[];
    readonly center: Vector3Tuple;
    readonly bounds: StagingBounds;
    readonly footprint: OverlayFootprint;
    readonly orientation: OverlayOrientation;
    readonly algorithmVersion: string;
  };
  readonly groups: OverlayGroup[];
  readonly groupIdByDrone: string[];
}

/**
 * Deterministic diagnostic group colour: golden-angle hue rotation, so any
 * group index always maps to the same colour for the same index.
 */
export function launchGroupColor(index: number): RGB {
  const hue = ((index * 137.508) % 360) / 360;
  const s = 0.72;
  const v = 1;
  const i = Math.floor(hue * 6);
  const f = hue * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6] as [number, number, number];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function orientationOf(rotationDeg: number): OverlayOrientation {
  const [rx, rz] = rotateXZ(1, 0, rotationDeg);
  const [fx, fz] = rotateXZ(0, 1, rotationDeg);
  return {
    rotationDeg,
    right: [rx, 0, rz],
    forward: [fx, 0, fz],
  };
}

/**
 * Footprint corners of an axis-aligned extent rotated about its own centre.
 * `width` / `depth` are the LOCAL (unrotated) extents of the layout.
 */
function footprintOf(
  center: Vector3Tuple,
  width: number,
  depth: number,
  rotationDeg: number,
): OverlayFootprint {
  const hw = width / 2;
  const hd = depth / 2;
  const local: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  const corners = local.map(([x, z]) => {
    const [rx, rz] = rotateXZ(x, z, rotationDeg);
    return [center[0] + rx, center[1], center[2] + rz] as Vector3Tuple;
  });
  return { center, width, depth, rotationDeg, corners };
}

/** Local (unrotated) extents of the launch grid, from its configured spacing. */
function launchLocalExtent(config: LaunchGridConfig, rows: number, columns: number) {
  return {
    width: Math.max(0, (columns - 1) * config.spacingX),
    depth: Math.max(0, (rows - 1) * config.spacingZ),
  };
}

/**
 * Reshapes a composed PreShowPlan into overlay data. Pads reflect only the
 * ACTUAL populated pads of the plan: unused grid cells never appear.
 */
export function buildPreShowOverlay(plan: PreShowPlan): PreShowOverlayModel {
  const { layout, staging } = plan;
  const groupIndexById = new Map(plan.groups.map((g) => [g.id, g.index] as const));

  const pads: OverlayPad[] = layout.pads.map((pad) => {
    const droneId = layout.padToDrone[pad.id] ?? "";
    const droneIndex = pad.index;
    return {
      padId: pad.id,
      index: pad.index,
      row: pad.row,
      column: pad.column,
      position: pad.position,
      droneId,
      droneIndex,
      groupId: plan.groupIdByDrone[droneIndex] ?? "",
    };
  });

  const targets: OverlayStagingTarget[] = plan.targetByDrone.map((position, droneIndex) => ({
    droneId: layout.pads[droneIndex]
      ? (layout.padToDrone[layout.pads[droneIndex]!.id] ?? "")
      : "",
    droneIndex,
    groupId: plan.groupIdByDrone[droneIndex] ?? "",
    position,
  }));

  const launchExtent = launchLocalExtent(layout.config, layout.rows, layout.columns);

  const groups: OverlayGroup[] = plan.groups.map((group) => ({
    groupId: group.id,
    index: group.index,
    droneIndices: [...group.droneIndices],
    droneIds: [...group.droneIds],
    padIds: [...group.padIds],
    padPositions: group.droneIndices.map(
      (i) => layout.pads[i]?.position ?? ([0, 0, 0] as Vector3Tuple),
    ),
    stagingTargets: group.droneIndices.map(
      (i) => plan.targetByDrone[i] ?? ([0, 0, 0] as Vector3Tuple),
    ),
    color: launchGroupColor(groupIndexById.get(group.id) ?? group.index),
    startTime: group.startTime,
  }));

  return {
    overlayVersion: PRE_SHOW_OVERLAY_VERSION,
    droneCount: plan.droneCount,
    launch: {
      config: layout.config,
      pads,
      footprint: footprintOf(
        [layout.center[0], layout.config.groundAltitude, layout.center[2]],
        launchExtent.width,
        launchExtent.depth,
        layout.config.rotationDeg,
      ),
      center: layout.center,
      groundAltitude: layout.config.groundAltitude,
      orientation: orientationOf(layout.config.rotationDeg),
      algorithmVersion: layout.algorithmVersion,
    },
    staging: {
      formationKind: staging.formationKind,
      formationId: staging.config.formationId,
      targets,
      center: staging.center,
      bounds: staging.bounds,
      footprint: footprintOf(
        staging.center,
        staging.bounds.width,
        staging.bounds.depth,
        0, // staging bounds are already measured on rotated targets
      ),
      orientation: orientationOf(staging.config.rotationDeg),
      algorithmVersion: staging.algorithmVersion,
    },
    groups,
    groupIdByDrone: [...plan.groupIdByDrone],
  };
}

const STATE_BY_PHASE: Readonly<Record<PreShowPhaseName, PreShowDroneState>> = {
  GROUND_WAIT: "ON_PAD",
  LIFTOFF: "ASCENT",
  INITIAL_ASCENT: "ASCENT",
  STAGING_TRANSIT: "TRANSIT",
  FORM_UP: "STAGED",
  STAGING_HOLD: "STAGED",
  SHOW_READY: "STAGED",
};

/**
 * Pre-show state of one drone at a show time, read from the canonical plan
 * segments. Show time >= 0 is the artistic show, never a pre-show state.
 */
export function preShowDroneStateAt(
  plan: PreShowPlan,
  droneIndex: number,
  showTime: number,
): PreShowDroneState {
  if (showTime >= 0) return "SHOW";
  let state: PreShowDroneState = "ON_PAD";
  for (const segment of plan.segments) {
    if (segment.droneIndex !== droneIndex) continue;
    if (showTime >= segment.start && showTime < segment.end) return STATE_BY_PHASE[segment.phase];
    if (showTime >= segment.end) state = STATE_BY_PHASE[segment.phase];
  }
  return state;
}

/** Same as `preShowDroneStateAt` for the whole fleet, in drone-index order. */
export function preShowStatesAt(plan: PreShowPlan, showTime: number): PreShowDroneState[] {
  const states: PreShowDroneState[] = new Array(plan.droneCount).fill("ON_PAD");
  if (showTime >= 0) return states.fill("SHOW");
  for (const segment of plan.segments) {
    if (segment.droneIndex < 0 || segment.droneIndex >= plan.droneCount) continue;
    if (showTime >= segment.start && showTime < segment.end) {
      states[segment.droneIndex] = STATE_BY_PHASE[segment.phase];
    } else if (showTime >= segment.end) {
      states[segment.droneIndex] = STATE_BY_PHASE[segment.phase];
    }
  }
  return states;
}
