/**
 * Export Adapter Layer — serializers only. No external code is vendored here;
 * these emit documented interchange layouts (see src/lib/adapters/index.ts).
 */
import { lightColorAt } from "../show/lights";
import { sampleTimeline, type ResolvedClip } from "../show/trajectory";
import { activeClip } from "../show/trajectory";
import type { ShowProject } from "../show/types";
import { showDuration } from "../show/types";

const EXPORT_DT = 0.2;

export function toSkybrushShow(project: ShowProject, resolved: ResolvedClip[]): string {
  const frames = sampleTimeline(project, resolved, EXPORT_DT);
  const drones = Array.from({ length: project.droneCount }, (_, i) => {
    const trajectory = frames.map((f) => ({
      t: f.t,
      p: (f.positions[i] ?? [0, 0, 0]).map((v) => Number(v.toFixed(3))),
    }));
    const lights = frames.map((f) => ({
      t: f.t,
      c: lightColorAt(activeClip(resolved, f.t), i, project.droneCount, f.t),
    }));
    return {
      id: `drone-${String(i + 1).padStart(3, "0")}`,
      settings: {
        name: `Drone ${i + 1}`,
        trajectory: { version: 1, points: trajectory },
        lights: { version: 1, points: lights },
      },
    };
  });

  return JSON.stringify(
    {
      version: 1,
      generator: "Drone Show Studio",
      meta: {
        name: project.name,
        droneCount: project.droneCount,
        duration: showDuration(project),
        coordinateSystem: "show-local, metres, +Y up",
        audio: project.audio,
        limits: project.limits,
      },
      environment: { type: "outdoor", area: project.area },
      drones,
    },
    null,
    2,
  );
}

export function toTrajectoryCsv(project: ShowProject, resolved: ResolvedClip[]): string {
  const frames = sampleTimeline(project, resolved, EXPORT_DT);
  const rows = ["time_s,drone_id,x_m,y_m,z_m,r,g,b"];
  for (const frame of frames) {
    const clip = activeClip(resolved, frame.t);
    frame.positions.forEach((p, i) => {
      const c = lightColorAt(clip, i, project.droneCount, frame.t);
      rows.push(
        `${frame.t.toFixed(2)},${i + 1},${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)},${c[0]},${c[1]},${c[2]}`,
      );
    });
  }
  return rows.join("\n");
}

export function toStudioProject(project: ShowProject): string {
  return JSON.stringify({ version: 1, kind: "drone-show-studio/project", project }, null, 2);
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
