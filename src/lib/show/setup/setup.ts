/**
 * Pure project-setup evaluation and project construction.
 *
 * PAD POPULATION ORDER (documented, deterministic and owned by the launch grid
 * engine): pads are filled row-major from the first row, column 0 upward —
 * `row = floor(index / columns)`, `column = index % columns`. Drone `DRN-001`
 * always takes `PAD-001`. A partially filled final row is normal and the unused
 * cells simply do not become pads.
 */
import { createDefaultProject } from "../defaultProject";
import { buildLaunchLayout, DEFAULT_LAUNCH_GRID, resolveGridShape } from "../preshow/launchGrid";
import { resolvePreShowConfig } from "../preshow/config";
import { DEFAULT_STAGING } from "../preshow/staging";
import type { LaunchGridConfig, PreShowConfig } from "../preshow/types";
import type { ShowProject } from "../types";
import {
  LAUNCH_GRID_PRESETS,
  RECOMMENDED_MAX_DRONES,
  SETUP_MAX_DRONES,
  SETUP_MIN_DRONES,
  type GridFootprint,
  type LaunchGridPresetId,
  type ProjectSetupDraft,
  type ProjectSetupEvaluation,
  type SetupIssue,
} from "./types";

export const PAD_POPULATION_ORDER = "ROW_MAJOR_FIRST_ROW_FIRST_COLUMN";

export const DEFAULT_SETUP_DRAFT: ProjectSetupDraft = {
  name: "Untitled Show",
  description: "",
  droneCount: 48,
  launch: DEFAULT_LAUNCH_GRID,
  staging: {
    enabled: false,
    altitude: DEFAULT_STAGING.altitude,
    leftRight: DEFAULT_STAGING.leftRight,
    forwardBack: DEFAULT_STAGING.forwardBack,
    spacing: DEFAULT_STAGING.spacing,
  },
  preShowEnabled: true,
};

export function gridCapacity(launch: LaunchGridConfig): number {
  const rows = Math.max(1, Math.floor(launch.rows));
  const columns = Math.max(1, Math.floor(launch.columns));
  return rows * columns;
}

/** Footprint from the ACTUAL engine layout — no duplicated grid formula. */
export function gridFootprint(droneCount: number, launch: LaunchGridConfig): GridFootprint {
  const shape = resolveGridShape(Math.max(1, droneCount), launch);
  const width = Math.max(0, (shape.columns - 1) * Math.abs(launch.spacingX));
  const depth = Math.max(0, (shape.rows - 1) * Math.abs(launch.spacingZ));
  const layout = buildLaunchLayout(Math.max(1, Math.floor(droneCount) || 1), launch);
  return {
    width,
    depth,
    rotatedWidth: layout.bounds.width,
    rotatedDepth: layout.bounds.depth,
  };
}

export function detectLaunchGridPreset(launch: LaunchGridConfig): LaunchGridPresetId {
  for (const [id, preset] of Object.entries(LAUNCH_GRID_PRESETS)) {
    if (launch.spacingX === preset.spacingX && launch.spacingZ === preset.spacingZ) {
      return id as LaunchGridPresetId;
    }
  }
  return "CUSTOM";
}

/**
 * Validates a draft. Errors block creation; warnings never do and never make a
 * safety claim — they only describe the design.
 */
export function evaluateProjectSetup(draft: ProjectSetupDraft): ProjectSetupEvaluation {
  const issues: SetupIssue[] = [];
  const droneCount = Math.floor(draft.droneCount);
  const capacity = gridCapacity(draft.launch);

  if (draft.name.trim().length === 0) {
    issues.push({ code: "NAME_REQUIRED", severity: "error", field: "name" });
  }
  if (
    !Number.isFinite(droneCount) ||
    droneCount < SETUP_MIN_DRONES ||
    droneCount > SETUP_MAX_DRONES
  ) {
    issues.push({
      code: "DRONE_COUNT_RANGE",
      severity: "error",
      field: "droneCount",
      values: { min: SETUP_MIN_DRONES, max: SETUP_MAX_DRONES },
    });
  }
  if (draft.launch.rows < 1 || draft.launch.columns < 1) {
    issues.push({ code: "GRID_SHAPE", severity: "error", field: "launchGrid" });
  }
  if (draft.launch.spacingX <= 0 || draft.launch.spacingZ <= 0) {
    issues.push({ code: "SPACING_RANGE", severity: "error", field: "spacing" });
  }
  if (capacity < droneCount) {
    issues.push({
      code: "GRID_CAPACITY",
      severity: "error",
      field: "launchGrid",
      values: { capacity, droneCount },
    });
  }
  if (droneCount > RECOMMENDED_MAX_DRONES) {
    issues.push({
      code: "FLEET_ABOVE_RECOMMENDED",
      severity: "warning",
      field: "droneCount",
      values: { recommended: RECOMMENDED_MAX_DRONES },
    });
  }
  if (draft.launch.spacingX > 0 && draft.launch.spacingX < 1.5) {
    issues.push({ code: "SPACING_TIGHT", severity: "warning", field: "spacingX" });
  }
  if (draft.launch.spacingZ > 0 && draft.launch.spacingZ < 1.5) {
    issues.push({ code: "SPACING_TIGHT", severity: "warning", field: "spacingZ" });
  }
  const unusedPads = Math.max(0, capacity - Math.max(0, droneCount));
  if (unusedPads > 0 && capacity >= droneCount) {
    issues.push({
      code: "UNUSED_PADS",
      severity: "warning",
      field: "launchGrid",
      values: { unusedPads },
    });
  }
  if (draft.staging.enabled && draft.staging.altitude <= draft.launch.groundAltitude) {
    issues.push({ code: "STAGING_ALTITUDE", severity: "warning", field: "stagingAltitude" });
  }

  const hasError = issues.some((i) => i.severity === "error");
  const shape = resolveGridShape(Math.max(1, droneCount || 1), draft.launch);
  const footprint = hasError
    ? { width: 0, depth: 0, rotatedWidth: 0, rotatedDepth: 0 }
    : gridFootprint(droneCount, draft.launch);
  const minPadSpacing = hasError
    ? 0
    : buildLaunchLayout(Math.max(1, droneCount), draft.launch).minPadSpacing;

  return {
    capacity,
    occupiedPads: Math.max(0, Math.min(droneCount, capacity)),
    unusedPads,
    effectiveRows: shape.rows,
    effectiveColumns: shape.columns,
    footprint,
    minPadSpacing,
    issues,
    canCreate: !hasError,
  };
}

/** Canonical pre-show config produced by a setup draft. */
export function preShowConfigFromSetup(
  draft: ProjectSetupDraft,
  base?: PreShowConfig | null,
): PreShowConfig {
  const resolved = resolvePreShowConfig(base);
  return {
    ...resolved,
    enabled: draft.preShowEnabled,
    launch: { ...draft.launch },
    staging: {
      ...resolved.staging,
      altitude: draft.staging.altitude,
      leftRight: draft.staging.leftRight,
      forwardBack: draft.staging.forwardBack,
      spacing: draft.staging.spacing,
    },
  };
}

/** Draft describing an existing project (used by the Show Setup editor). */
export function setupDraftFromProject(project: ShowProject): ProjectSetupDraft {
  const preShow = resolvePreShowConfig(project.preShow);
  return {
    name: project.name,
    description: "",
    droneCount: project.droneCount,
    launch: { ...preShow.launch },
    staging: {
      enabled: preShow.enabled,
      altitude: preShow.staging.altitude,
      leftRight: preShow.staging.leftRight,
      forwardBack: preShow.staging.forwardBack,
      spacing: preShow.staging.spacing,
    },
    preShowEnabled: preShow.enabled,
  };
}

/**
 * Builds a brand-new project from a validated draft. The canonical demo project
 * factory stays the single source of default formations/timeline; only project
 * identity, fleet size and the pre-show configuration come from the draft.
 */
export function createProjectFromSetup(draft: ProjectSetupDraft): ShowProject {
  const evaluation = evaluateProjectSetup(draft);
  if (!evaluation.canCreate) {
    throw new Error(
      `Invalid project setup: ${evaluation.issues
        .filter((i) => i.severity === "error")
        .map((i) => i.code)
        .join(", ")}`,
    );
  }
  const base = createDefaultProject(Math.floor(draft.droneCount));
  return {
    ...base,
    name: draft.name.trim(),
    preShow: preShowConfigFromSetup(draft, base.preShow),
  };
}
