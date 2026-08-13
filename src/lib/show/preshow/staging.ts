/**
 * STAGING ENGINE — the aerial formation the fleet assembles into BEFORE Show
 * Time Zero.
 *
 * Staging is independent from the first artistic formation and from the ground
 * grid. Sign conventions (documented, not implied):
 *   leftRight   -> +X, relative to the LAUNCH GRID CENTRE
 *   forwardBack -> +Z, relative to the LAUNCH GRID CENTRE
 *   altitude    -> +Y, absolute metres above ground
 *   rotationDeg -> yaw about the STAGING CENTRE (never the world origin)
 */
import type { Formation, Vector3Tuple } from "../types";
import { rotateXZ } from "./launchGrid";
import {
  PreShowError,
  STAGING_ALGORITHM_VERSION,
  type LaunchLayout,
  type StagingBounds,
  type StagingConfiguration,
  type StagingLayout,
} from "./types";

export const DEFAULT_STAGING: StagingConfiguration = {
  formationKind: "grid",
  formationId: null,
  spacing: 6,
  rows: null,
  columns: null,
  altitude: 50,
  leftRight: 0,
  forwardBack: 0,
  rotationDeg: 0,
};

/** Local (centred, y = 0) staging points before rotation and translation. */
function localPoints(count: number, config: StagingConfiguration, formation?: Formation): Vector3Tuple[] {
  if (config.formationKind === "formation") {
    if (!formation) {
      throw new PreShowError(
        "MISSING_STAGING_FORMATION",
        `Staging references a missing formation (${config.formationId ?? "none"})`,
        { formationId: config.formationId },
      );
    }
    const pts = formation.points;
    if (pts.length === 0) {
      throw new PreShowError("INVALID_STAGING", "Staging formation has no points");
    }
    // Exactly `count` points: repeat deterministically when the formation is
    // smaller, truncate when larger. Centred on its own XZ centroid.
    const chosen: Vector3Tuple[] = [];
    for (let i = 0; i < count; i++) chosen.push(pts[i % pts.length]!);
    let cx = 0;
    let cz = 0;
    for (const p of chosen) {
      cx += p[0];
      cz += p[2];
    }
    cx /= chosen.length;
    cz /= chosen.length;
    return chosen.map((p) => [p[0] - cx, 0, p[2] - cz] as Vector3Tuple);
  }

  const spacing = Math.max(0.1, config.spacing);
  if (config.formationKind === "circle") {
    const radius = (spacing * count) / (2 * Math.PI);
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2;
      return [Math.cos(a) * radius, 0, Math.sin(a) * radius] as Vector3Tuple;
    });
  }

  // GRID (default): operationally predictable, deterministic shape.
  const columns = Math.max(1, Math.floor(config.columns ?? Math.ceil(Math.sqrt(count))));
  const rows = Math.max(1, Math.max(Math.floor(config.rows ?? 0), Math.ceil(count / columns)));
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / columns);
    const column = i % columns;
    return [
      (column - (columns - 1) / 2) * spacing,
      0,
      (row - (rows - 1) / 2) * spacing,
    ] as Vector3Tuple;
  });
}

export function buildStagingLayout(
  droneCount: number,
  config: StagingConfiguration,
  layout: LaunchLayout,
  formation?: Formation,
): StagingLayout {
  if (!Number.isFinite(config.altitude)) {
    throw new PreShowError("INVALID_STAGING", "Staging altitude must be finite");
  }
  const center: Vector3Tuple = [
    layout.center[0] + config.leftRight,
    config.altitude,
    layout.center[2] + config.forwardBack,
  ];
  const local = localPoints(droneCount, config, formation);
  const targets = local.map((p) => {
    const [x, z] = rotateXZ(p[0], p[2], config.rotationDeg);
    return [center[0] + x, config.altitude, center[2] + z] as Vector3Tuple;
  });

  return {
    targets,
    center,
    bounds: stagingBounds(targets),
    config,
    formationKind: config.formationKind,
    algorithmVersion: STAGING_ALGORITHM_VERSION,
  };
}

export function stagingBounds(points: readonly Vector3Tuple[]): StagingBounds {
  if (points.length === 0) {
    return { width: 0, height: 0, depth: 0, minStaticSpacing: Infinity };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
    minZ = Math.min(minZ, p[2]);
    maxZ = Math.max(maxZ, p[2]);
  }
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < min) min = d;
    }
  }
  return {
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
    minStaticSpacing: points.length < 2 ? Infinity : min,
  };
}
