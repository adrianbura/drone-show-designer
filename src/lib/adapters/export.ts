/**
 * Export Adapter Layer — serializers only.
 *
 * NAMING NOTE: there is deliberately no "Skybrush export" here. The previous
 * `toSkybrushShow()` emitted a Skybrush-*like* layout that was never verified
 * against the real format, so it is replaced by the documented internal schema
 * `DroneShowStudioShow` (see docs/EXPORT_FORMAT.md). A real, verified
 * SkybrushAdapter can be added later behind the existing adapter contract.
 */
import { ASSIGNMENT_ALGORITHM_VERSION } from "../show/assignment";
import { CONFLICT_DETECTION_VERSION } from "../show/conflicts";
import { COORDINATE_SYSTEM } from "../show/coordinates";
import { DYNAMIC_FORMATION_ALGORITHM_VERSION } from "../show/dynamic";
import { emittedColor, projectLightingAt } from "../show/lighting";
import { TRANSITION_OPTIMIZER_VERSION } from "../show/transition";
import type { ShowPlan, TrajectorySet } from "../show/trajectory";
import type { RGB, ShowProject, Vector3Tuple } from "../show/types";
import { showDuration } from "../show/types";
import type { SafetyReport } from "../show/safety";
import type { PreShowValidationReport } from "../show/preshow";
import { projectFileToJson, serializeProject } from "../project";
import { toPreShowExportSection } from "./preshowExport";
import type { FullShowValidationReport } from "../show/fullshow/types";

export const EXPORT_SCHEMA_NAME = "DroneShowStudioShow";
export const EXPORT_SCHEMA_VERSION = 1;

const round = (v: number, p = 3) => Number(v.toFixed(p));

export interface GenericExportInput {
  project: ShowProject;
  plan: ShowPlan;
  set: TrajectorySet;
  safety?: SafetyReport;
  /** Full-show validation provenance, when a report exists for this revision. */
  fullShow?: FullShowValidationReport | null;
  /** True when the report was produced for a DIFFERENT project revision. */
  fullShowStale?: boolean;
  /** Pre-show validation provenance for `plan.preShow`, when one exists. */
  preShowReport?: PreShowValidationReport | null;
  /** True when the pre-show report describes a DIFFERENT project revision. */
  preShowStale?: boolean;
}

/**
 * Canonical emitted RGB for every sampled fleet frame.
 *
 * Export must use the SAME lighting path as preview/full-show validation:
 * clip/instance base colour -> authored lighting stack -> participation reserve
 * policy. WORLD_SPACE effects receive the actual sampled trajectory positions.
 */
function lightingFrames(
  project: ShowProject,
  set: TrajectorySet,
  participation: ShowPlan["participation"] = [],
): RGB[][] {
  const frameCount = set.drones[0]?.samples.length ?? 0;
  const frames: RGB[][] = new Array(frameCount);
  for (let k = 0; k < frameCount; k++) {
    const t = set.drones[0]?.samples[k]?.t ?? (set.startTime ?? 0) + k / set.sampleRate;
    const positions: Vector3Tuple[] = set.drones.map(
      (drone) => drone.samples[k]?.position ?? ([0, 0, 0] as const),
    );
    frames[k] = projectLightingAt({ project, participation, positions }, t).map(emittedColor);
  }
  return frames;
}

/**
 * Documented internal interchange schema, version 1. Self-describing: a reader
 * only needs this file and docs/EXPORT_FORMAT.md.
 */
export function toGenericShowJson({
  project,
  plan,
  set,
  safety,
  fullShow,
  fullShowStale,
  preShowReport,
  preShowStale,
}: GenericExportInput): string {
  const colors = lightingFrames(project, set, plan.participation);
  const drones = plan.drones.map((drone, i) => {
    const trajectory = set.drones[i];
    return {
      id: drone.id,
      index: drone.index,
      homePosition: drone.homePosition.map((v) => round(v)),
      samples: (trajectory?.samples ?? []).map((s, k) => ({
        t: round(s.t, 3),
        p: s.position.map((v) => round(v)),
        v: s.velocity.map((v) => round(v)),
        a: s.acceleration.map((v) => round(v)),
        j: s.jerk.map((v) => round(v)),
        yaw: round(s.yaw, 2),
        yawRate: round(s.yawRate, 2),
        c: colors[k]?.[i] ?? ([0, 0, 0] as RGB),
      })),
    };
  });

  return JSON.stringify(
    {
      schema: EXPORT_SCHEMA_NAME,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      generator: "Drone Show Studio",
      project: {
        id: project.id,
        name: project.name,
        droneCount: project.droneCount,
        duration: showDuration(project),
        seed: project.seed,
        versions: project.versions,
        area: project.area,
        altitudes: project.altitudes,
        audio: project.audio,
      },
      coordinateSystem: COORDINATE_SYSTEM,
      safetyProfile: project.limits,
      formations: project.formations.map((f) => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        params: f.params,
        points: f.points.map((p) => p.map((v) => round(v))),
        ...(f.svg ? { svg: f.svg } : {}),
      })),
      ...(project.dynamicFormations && project.dynamicFormations.length > 0
        ? {
            dynamicFormations: project.dynamicFormations.map((d) => ({
              id: d.id,
              name: d.name,
              sourceFormationId: d.sourceFormationId ?? null,
              duration: round(d.duration),
              loop: d.loop,
              pivot: d.pivot.map((v) => round(v)),
              seed: d.seed,
              algorithmVersion: d.algorithmVersion,
              points: d.points.map((p) => ({ id: p.id, base: p.base.map((v) => round(v)) })),
              transform: d.transform,
              groups: d.groups,
            })),
            dynamicFormationAlgorithmVersion: DYNAMIC_FORMATION_ALGORITHM_VERSION,
          }
        : {}),
      timeline: project.timeline.map((c) => ({ ...c, phase: c.phase ?? "SHOW" })),
      planning: {
        assignmentAlgorithmVersion: ASSIGNMENT_ALGORITHM_VERSION,
        assignmentStrategy: plan.assignmentStrategy,
        optimizerVersion: TRANSITION_OPTIMIZER_VERSION,
        conflictDetectionVersion: CONFLICT_DETECTION_VERSION,
        optimizedClipIds: plan.optimizedClipIds,
      },
      assignments: plan.assignments,
      preShow: plan.preShow
        ? toPreShowExportSection({
            plan: plan.preShow,
            report: preShowReport ?? null,
            stale: !!preShowStale,
            analysisRevision: fullShow?.analysisRevision ?? null,
          })
        : null,
      operationalTiming: {
        showTimeZero: 0,
        firstPlayableShowTime: round(plan.startTime),
        showStartOperationalTime: round(plan.showStartOperationalTime),
      },
      trajectorySet: {
        droneCount: set.droneCount,
        duration: set.duration,
        sampleRate: set.sampleRate,
        algorithmVersion: set.algorithmVersion,
      },
      lighting: {
        evaluation: "per-sample, deterministic, canonical lighting engine + participation policy",
      },
      validation: safety
        ? {
            statement: "Validated against current safety profile — not a real-world safety guarantee",
            status: safety.status,
            metrics: safety.metrics,
            errorCount: safety.errors.length,
            warningCount: safety.warnings.length,
            sampleRate: safety.sampleRate,
          }
        : null,
      fullShowValidation: fullShow
        ? {
            statement: fullShow.statement,
            status: fullShow.status,
            stale: !!fullShowStale,
            analysisRevision: fullShow.analysisRevision,
            showPackageId: fullShow.showPackageId,
            engineVersion: fullShow.engineVersion,
            algorithmVersions: fullShow.algorithmVersions,
            metrics: fullShow.metrics,
            errorCount: fullShow.errors.length,
            warningCount: fullShow.warnings.length,
            unresolvedTransitions: fullShow.unresolvedTransitions,
            exportReadiness: fullShow.exportReadiness,
          }
        : null,
      planningErrors: plan.errors.map((e) => ({
        code: e.code,
        message: e.message,
        details: e.details,
      })),
      drones,
    },
    null,
    2,
  );
}

/**
 * CSV export uses the canonical lighting engine too. `plan` is optional only for
 * backwards compatibility with older callers; pass it whenever available so
 * partial-fleet reserve lighting uses the exact participation plan that flew.
 */
export function toTrajectoryCsv(
  project: ShowProject,
  set: TrajectorySet,
  plan?: Pick<ShowPlan, "participation">,
): string {
  const rows = ["time_s,drone_id,x_m,y_m,z_m,vx,vy,vz,yaw_deg,yaw_rate_dps,r,g,b"];
  const frames = set.drones[0]?.samples.length ?? 0;
  const colors = lightingFrames(project, set, plan?.participation ?? []);
  for (let k = 0; k < frames; k++) {
    for (let i = 0; i < set.drones.length; i++) {
      const drone = set.drones[i]!;
      const s = drone.samples[k];
      if (!s) continue;
      const c = colors[k]?.[i] ?? ([0, 0, 0] as RGB);
      rows.push(
        [
          s.t.toFixed(3),
          drone.droneId,
          ...s.position.map((v) => v.toFixed(3)),
          ...s.velocity.map((v) => v.toFixed(3)),
          s.yaw.toFixed(2),
          s.yawRate.toFixed(2),
          c[0],
          c[1],
          c[2],
        ].join(","),
      );
    }
  }
  return rows.join("\n");
}

/**
 * Serialises the editable Studio project through the canonical project-file
 * envelope. This deliberately delegates to src/lib/project so Save/Open and the
 * Inspector export can never drift to different `kind` or schema semantics.
 */
export function toStudioProject(project: ShowProject): string {
  return projectFileToJson(serializeProject(project));
}

export function downloadText(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
