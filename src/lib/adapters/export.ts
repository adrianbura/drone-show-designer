/**
 * Export Adapter Layer — serializers only.
 *
 * NAMING NOTE: there is deliberately no "Skybrush export" here. The previous
 * `toSkybrushShow()` emitted a Skybrush-*like* layout that was never verified
 * against the real format, so it is replaced by the documented internal schema
 * `DroneShowStudioShow` (see docs/EXPORT_FORMAT.md). A real, verified
 * SkybrushAdapter can be added later behind the existing adapter contract.
 */
import { COORDINATE_SYSTEM } from "../show/coordinates";
import { lightColorAt } from "../show/lights";
import { activeClipAt } from "../show/timeline";
import type { ShowPlan } from "../show/trajectory";
import type { TrajectorySet } from "../show/trajectory";
import type { ShowProject } from "../show/types";
import { showDuration } from "../show/types";
import type { SafetyReport } from "../show/safety";

export const EXPORT_SCHEMA_NAME = "DroneShowStudioShow";
export const EXPORT_SCHEMA_VERSION = 1;

const round = (v: number, p = 3) => Number(v.toFixed(p));

export interface GenericExportInput {
  project: ShowProject;
  plan: ShowPlan;
  set: TrajectorySet;
  safety?: SafetyReport;
}

/**
 * Documented internal interchange schema, version 1. Self-describing: a reader
 * only needs this file and docs/EXPORT_FORMAT.md.
 */
export function toGenericShowJson({ project, plan, set, safety }: GenericExportInput): string {
  const drones = plan.drones.map((drone, i) => {
    const trajectory = set.drones[i];
    return {
      id: drone.id,
      index: drone.index,
      homePosition: drone.homePosition.map((v) => round(v)),
      samples: (trajectory?.samples ?? []).map((s) => ({
        t: round(s.t, 3),
        p: s.position.map((v) => round(v)),
        v: s.velocity.map((v) => round(v)),
        a: s.acceleration.map((v) => round(v)),
        j: s.jerk.map((v) => round(v)),
        yaw: round(s.yaw, 2),
        yawRate: round(s.yawRate, 2),
        c: lightColorAt(activeClipAt(project, s.t), drone.index, project.droneCount, s.t),
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
        // Reproducibility metadata for logo/vector formations (kind "svg").
        ...(f.svg ? { svg: f.svg } : {}),
      })),
      timeline: project.timeline.map((c) => ({ ...c, phase: c.phase ?? "SHOW" })),
      assignments: plan.assignments,
      trajectorySet: {
        droneCount: set.droneCount,
        duration: set.duration,
        sampleRate: set.sampleRate,
        algorithmVersion: set.algorithmVersion,
      },
      lighting: { evaluation: "per-sample, deterministic, from active clip effect" },
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

export function toTrajectoryCsv(project: ShowProject, set: TrajectorySet): string {
  const rows = ["time_s,drone_id,x_m,y_m,z_m,vx,vy,vz,yaw_deg,yaw_rate_dps,r,g,b"];
  const frames = set.drones[0]?.samples.length ?? 0;
  for (let k = 0; k < frames; k++) {
    for (let i = 0; i < set.drones.length; i++) {
      const drone = set.drones[i]!;
      const s = drone.samples[k];
      if (!s) continue;
      const c = lightColorAt(activeClipAt(project, s.t), i, project.droneCount, s.t);
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

export function toStudioProject(project: ShowProject): string {
  return JSON.stringify(
    {
      version: 1,
      kind: "drone-show-studio/project",
      schemaVersion: project.versions.schemaVersion,
      project,
    },
    null,
    2,
  );
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
