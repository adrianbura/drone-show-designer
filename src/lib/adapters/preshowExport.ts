/**
 * PRE-SHOW / LAUNCH EXPORT PROVENANCE (versioned section of DroneShowStudioShow).
 *
 * Emits the semantic numeric configuration needed to RECONSTRUCT the same
 * launch/staging plan with the same algorithm versions — never UI labels and
 * never autopilot commands. The section is always built from the pre-show plan
 * embedded in the exported ShowPlan, so it can never describe a launch other
 * than the one that was sampled, validated and played.
 */
import {
  buildPreShowOverlay,
  PRE_SHOW_OVERLAY_VERSION,
  type PreShowPlan,
  type PreShowValidationReport,
} from "../show/preshow";

export const PRE_SHOW_EXPORT_SECTION_VERSION = 1;

export interface PreShowExportInput {
  readonly plan: PreShowPlan;
  /** Validation report for this plan, when one exists. */
  readonly report?: PreShowValidationReport | null;
  /** True when the report was produced for a DIFFERENT project revision. */
  readonly stale?: boolean;
  /** Revision string of the analysis that produced `report`. */
  readonly analysisRevision?: string | null;
}

const round = (v: number, p = 3) => (Number.isFinite(v) ? Number(v.toFixed(p)) : null);
const vec = (v: readonly [number, number, number]) => v.map((n) => round(n));

export function toPreShowExportSection({
  plan,
  report,
  stale,
  analysisRevision,
}: PreShowExportInput) {
  const overlay = buildPreShowOverlay(plan);
  const { layout, staging, config } = plan;

  return {
    sectionVersion: PRE_SHOW_EXPORT_SECTION_VERSION,
    enabled: true,
    preShowEngineVersion: plan.algorithmVersions.preShowEngine,
    launchAlgorithmVersion: plan.algorithmVersions.launch,
    stagingAlgorithmVersion: plan.algorithmVersions.staging,
    assignmentAlgorithmVersion: plan.algorithmVersions.assignment,
    assignmentStrategy: plan.assignmentStrategy,
    overlayVersion: PRE_SHOW_OVERLAY_VERSION,
    droneCount: plan.droneCount,

    launchLayout: {
      kind: layout.kind,
      rows: layout.rows,
      columns: layout.columns,
      spacingX: round(layout.config.spacingX),
      spacingZ: round(layout.config.spacingZ),
      originX: round(layout.config.originX),
      originZ: round(layout.config.originZ),
      groundAltitude: round(layout.config.groundAltitude),
      rotationDeg: round(layout.config.rotationDeg),
      padCount: layout.pads.length,
      center: vec(layout.center),
      bounds: {
        width: round(layout.bounds.width),
        depth: round(layout.bounds.depth),
        minX: round(layout.bounds.minX),
        maxX: round(layout.bounds.maxX),
        minZ: round(layout.bounds.minZ),
        maxZ: round(layout.bounds.maxZ),
      },
      minPadSpacing: round(layout.minPadSpacing),
    },

    launchPads: layout.pads.map((pad) => ({
      padId: pad.id,
      index: pad.index,
      row: pad.row,
      column: pad.column,
      position: vec(pad.position),
    })),

    dronePadMapping: Object.entries(layout.droneToPad).map(([droneId, padId]) => ({
      droneId,
      padId,
    })),

    staging: {
      formationKind: staging.formationKind,
      formationId: staging.config.formationId,
      altitude: round(staging.config.altitude),
      leftRight: round(staging.config.leftRight),
      forwardBack: round(staging.config.forwardBack),
      rotationDeg: round(staging.config.rotationDeg),
      spacing: staging.formationKind === "formation" ? null : round(staging.config.spacing),
      rows: staging.config.rows,
      columns: staging.config.columns,
      center: vec(staging.center),
      bounds: {
        width: round(staging.bounds.width),
        height: round(staging.bounds.height),
        depth: round(staging.bounds.depth),
        minStaticSpacing: round(staging.bounds.minStaticSpacing),
      },
      targets: plan.targetByDrone.map((p, droneIndex) => ({
        droneIndex,
        position: vec(p),
      })),
    },

    grouping: {
      strategy: config.grouping.strategy,
      order: config.grouping.order,
      rowsPerGroup: config.grouping.rowsPerGroup,
      columnsPerGroup: config.grouping.columnsPerGroup,
      blockRows: config.grouping.blockRows,
      blockColumns: config.grouping.blockColumns,
      groupIntervalSeconds: round(config.grouping.groupIntervalSeconds),
      startTimeOverrides: config.grouping.startTimeOverrides,
    },

    launchGroups: overlay.groups.map((group) => ({
      groupId: group.groupId,
      index: group.index,
      droneIds: group.droneIds,
      droneIndices: group.droneIndices,
      padIds: group.padIds,
      startTime: round(group.startTime),
      /** Deterministic diagnostic colour, not part of the artistic program. */
      diagnosticColor: group.color,
    })),

    motion: {
      initialClearance: round(config.initialClearance),
      ascentDuration: round(config.ascentDuration),
      transitDuration: round(config.transitDuration),
      stagingHold: round(config.stagingHold),
      transitMode: config.transitMode,
      lighting: config.lighting,
      lightingColor: config.lightingColor,
    },

    timing: {
      preShowDuration: round(plan.duration),
      firstLiftoffTime: round(plan.firstLiftoffTime),
      lastLiftoffTime: round(plan.lastLiftoffTime),
      allDronesAtStagingTime: round(plan.allDronesAtStagingTime),
      stagingHoldDuration: round(config.stagingHold),
      showStartOperationalTime: round(plan.showStartOperationalTime),
      /** Show time zero is canonical and always 0 by construction. */
      showTimeZero: 0,
      /** First playable show time; the pre-show occupies negative show time. */
      preShowStartShowTime: round(-plan.duration),
      showReadyTime: round(plan.showReadyTime),
    },

    preShowValidation: report
      ? {
          statement: report.statement,
          status: report.status,
          stale: !!stale,
          analysisRevision: analysisRevision ?? null,
          engineVersion: report.engineVersion,
          metrics: report.metrics,
          launchGrid: report.launchGrid,
          stagingSummary: report.staging,
          groupCount: report.groupCount,
          errorCount: report.errors.length,
          warningCount: report.warnings.length,
          issueCount: report.issues.length,
        }
      : {
          statement:
            "No pre-show validation was performed for this export — do not assume the launch plan is valid.",
          status: null,
          stale: true,
          analysisRevision: null,
          engineVersion: plan.algorithmVersions.preShowEngine,
          metrics: null,
          launchGrid: null,
          stagingSummary: null,
          groupCount: plan.groups.length,
          errorCount: null,
          warningCount: null,
          issueCount: null,
        },

    planningErrors: plan.errors.map((e) => ({ code: e.code, message: e.message })),
  };
}
