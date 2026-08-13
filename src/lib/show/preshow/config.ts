/**
 * Pre-show configuration defaults and normalisation.
 *
 * The config is CREATIVE/OPERATIONAL data and lives on ShowProject, so it is
 * saved, exported and hashed into the analysis revision like everything else.
 */
import type { PreShowConfig } from "./types";
import { DEFAULT_GROUPING } from "./groups";
import { DEFAULT_LAUNCH_GRID } from "./launchGrid";
import { DEFAULT_STAGING } from "./staging";

export const DEFAULT_PRE_SHOW: PreShowConfig = {
  // Off by default: an existing project keeps its exact previous behaviour
  // until the operator explicitly plans a launch.
  enabled: false,
  launch: DEFAULT_LAUNCH_GRID,
  staging: DEFAULT_STAGING,
  grouping: DEFAULT_GROUPING,
  initialClearance: 8,
  ascentDuration: 6,
  transitDuration: 14,
  stagingHold: 3,
  lighting: "OFF",
  lightingColor: [0, 0, 0],
  assignmentStrategy: "optimalDistance",
  transitMode: "clearanceFirst",
};

/** Deep merge of a partial patch (UI edits) onto a full config. */
export function patchPreShowConfig(
  base: PreShowConfig,
  patch: DeepPartialPreShow,
): PreShowConfig {
  return {
    ...base,
    ...patch,
    launch: { ...base.launch, ...(patch.launch ?? {}) },
    staging: { ...base.staging, ...(patch.staging ?? {}) },
    grouping: { ...base.grouping, ...(patch.grouping ?? {}) },
  };
}

export interface DeepPartialPreShow
  extends Partial<Omit<PreShowConfig, "launch" | "staging" | "grouping">> {
  launch?: Partial<PreShowConfig["launch"]>;
  staging?: Partial<PreShowConfig["staging"]>;
  grouping?: Partial<PreShowConfig["grouping"]>;
}

export function resolvePreShowConfig(config?: Partial<PreShowConfig> | null): PreShowConfig {
  if (!config) return DEFAULT_PRE_SHOW;
  return patchPreShowConfig(DEFAULT_PRE_SHOW, config as DeepPartialPreShow);
}
