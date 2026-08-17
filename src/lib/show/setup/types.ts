/**
 * PROJECT SETUP — domain model for the New Show wizard and Show Setup editor.
 *
 * The wizard is a THIN authoring surface over existing canonical engines: the
 * launch grid is the real `LaunchGridConfig` of the pre-show engine and staging
 * is the real `StagingConfiguration`. Nothing here re-implements grid geometry;
 * every derived number comes from `buildLaunchLayout`.
 */
import type { LaunchGridConfig } from "../preshow/types";

export const PROJECT_SETUP_VERSION = "0.1.0";

/**
 * Fleet size the current performance envelope is validated for. This is a
 * DESIGN RECOMMENDATION, not a protocol or engine limit: the engines are
 * count-agnostic and larger fleets remain possible.
 */
export const RECOMMENDED_MAX_DRONES = 200;
/** Hard authoring bounds of the wizard input (not an engine constraint). */
export const SETUP_MIN_DRONES = 1;
export const SETUP_MAX_DRONES = 2000;

export type SetupStep = "PROJECT" | "FLEET" | "LAUNCH_GRID" | "REVIEW";
export const SETUP_STEPS: readonly SetupStep[] = ["PROJECT", "FLEET", "LAUNCH_GRID", "REVIEW"];

/** Staging part of the setup draft. Kept separate from the launch grid. */
export interface StagingSetupDraft {
  /** When false the pre-show planner keeps its own defaults. */
  readonly enabled: boolean;
  /** Metres above ground — NOT the launch ground altitude, NOT show altitude. */
  readonly altitude: number;
  /** +X offset of the staging centre relative to the launch grid centre. */
  readonly leftRight: number;
  /** +Z offset of the staging centre relative to the launch grid centre. */
  readonly forwardBack: number;
  readonly spacing: number;
}

export interface ProjectSetupDraft {
  readonly name: string;
  readonly description: string;
  readonly droneCount: number;
  /** Canonical pre-show launch grid configuration. */
  readonly launch: LaunchGridConfig;
  readonly staging: StagingSetupDraft;
  /** Whether the pre-show (launch → staging) phase is planned at all. */
  readonly preShowEnabled: boolean;
}

export type SetupIssueCode =
  | "NAME_REQUIRED"
  | "DRONE_COUNT_RANGE"
  | "GRID_CAPACITY"
  | "GRID_SHAPE"
  | "SPACING_RANGE"
  | "FLEET_ABOVE_RECOMMENDED"
  | "SPACING_TIGHT"
  | "UNUSED_PADS"
  | "STAGING_ALTITUDE";

export interface SetupIssue {
  /** Machine-readable code — never translated, never parsed from UI text. */
  readonly code: SetupIssueCode;
  readonly severity: "error" | "warning";
  /** Field this issue belongs to, in canonical property naming. */
  readonly field: string;
  /** Optional interpolation values for the localized message. */
  readonly values?: Record<string, string | number>;
}

export interface GridFootprint {
  /** Extent along +X, metres (pad centres). */
  readonly width: number;
  /** Extent along +Z, metres (pad centres). */
  readonly depth: number;
  /** Axis-aligned extents after rotation, metres. */
  readonly rotatedWidth: number;
  readonly rotatedDepth: number;
}

export interface ProjectSetupEvaluation {
  readonly capacity: number;
  readonly occupiedPads: number;
  readonly unusedPads: number;
  /** Rows actually needed by the engine (may exceed the configured rows). */
  readonly effectiveRows: number;
  readonly effectiveColumns: number;
  readonly footprint: GridFootprint;
  readonly minPadSpacing: number;
  readonly issues: readonly SetupIssue[];
  readonly canCreate: boolean;
}

/** Spacing presets — design conveniences only, never a safety statement. */
export const LAUNCH_GRID_PRESETS = {
  COMPACT: { spacingX: 1.5, spacingZ: 1.5 },
  STANDARD: { spacingX: 2.5, spacingZ: 2.5 },
  WIDE: { spacingX: 4, spacingZ: 4 },
} as const;

export type LaunchGridPresetId = keyof typeof LAUNCH_GRID_PRESETS | "CUSTOM";
