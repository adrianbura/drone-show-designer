/**
 * Full-show light program evaluation.
 *
 * The light program is evaluated over the SAME show timeline the trajectory set
 * was composed from, so colours in the preview, in the report and in the export
 * come from one evaluation path. This module validates the program (finite,
 * in-gamut, defined for every instant) — it does not judge artistic intent.
 */
import { lightColorAt } from "../lights";
import {
  participationOf,
  reserveLightingScale,
  resolveParticipationSettings,
} from "../participation";
import { emittedColor, projectLightingAt, validateLightingProgram } from "../lighting";
import { activeClipAt } from "../timeline";
import type { RGB, ShowProject } from "../types";
import type { DroneLightSample, FullShowIssue, FullShowPlan, LightingReport } from "./types";

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const scaleColor = (color: RGB, scale: number): RGB =>
  scale === 1
    ? color
    : ([clampByte(color[0] * scale), clampByte(color[1] * scale), clampByte(color[2] * scale)] as RGB);

export function lightSamplesAt(
  project: ShowProject,
  plan: FullShowPlan,
  t: number,
): DroneLightSample[] {
  const clip = activeClipAt(project, t);
  // Non-participating drones are lit by policy, never by the artistic clip: the
  // default is OFF so a reserve swarm stays invisible in the image.
  const policy = resolveParticipationSettings(project.participation).reserveLighting;
  const participation = clip
    ? (plan.showPlan.participation.find((p) => p.clipId === clip.id) ?? null)
    : null;
  // Authored lighting effects (Sprint 7.4) take precedence over the legacy
  // per-clip effect: one evaluation path for preview, report and export.
  const lights =
    (project.lighting?.effects.length ?? 0) > 0
      ? projectLightingAt({ project, participation: plan.showPlan.participation }, t)
      : [];
  return plan.drones.map((d) => {
    const state = lights[d.index];
    const base = state ? emittedColor(state) : lightColorAt(clip, d.index, project.droneCount, t);
    const role = participation ? participationOf(participation, d.index)?.role : undefined;
    const color = role ? scaleColor(base, reserveLightingScale(role, policy)) : base;
    return {
      t,
      droneId: d.id,
      color,
      brightness: (color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722) / 255,
    };
  });
}


export interface LightingValidationOptions {
  /** Instants per second evaluated for the validation pass. Default 2. */
  readonly rate?: number;
}

export function validateLightProgram(
  project: ShowProject,
  plan: FullShowPlan,
  options: LightingValidationOptions = {},
): LightingReport {
  const rate = options.rate ?? 2;
  const steps = Math.max(1, Math.floor(plan.duration * rate) + 1);
  const issues: FullShowIssue[] = [];
  let invalidSamples = 0;
  let n = 0;
  const reported = new Set<string>();

  for (let k = 0; k < steps; k++) {
    const t = k / rate;
    const clip = activeClipAt(project, t);
    if (!clip) {
      const key = "no-clip";
      if (!reported.has(key)) {
        reported.add(key);
        issues.push({
          id: `light-${++n}`,
          severity: "warning",
          category: "lighting",
          code: "NO_LIGHT_CLIP",
          message: `No clip governs lighting at ${t.toFixed(2)}s; drones fall back to the idle colour.`,
          time: t,
        });
      }
      continue;
    }
    // Sampling a bounded set of drones per instant keeps validation O(duration)
    // while still catching per-index effects (chase/twinkle/rainbow).
    const probes = Math.min(project.droneCount, 8);
    for (let p = 0; p < probes; p++) {
      const index = Math.floor((p * project.droneCount) / probes);
      const color: RGB = lightColorAt(clip, index, project.droneCount, t);
      const finite = color.every((c) => Number.isFinite(c));
      const inGamut = color.every((c) => c === clampByte(c));
      if (!finite || !inGamut) {
        invalidSamples++;
        const key = `${clip.effect}-${finite ? "gamut" : "nan"}`;
        if (!reported.has(key)) {
          reported.add(key);
          issues.push({
            id: `light-${++n}`,
            severity: finite ? "warning" : "error",
            category: "lighting",
            code: finite ? "COLOR_OUT_OF_GAMUT" : "COLOR_NOT_FINITE",
            message: finite
              ? `Effect "${clip.effect}" produced an out-of-range colour channel (clamped on export).`
              : `Effect "${clip.effect}" produced a non-finite colour.`,
            time: t,
            clipId: clip.id,
          });
        }
      }
    }
  }

  // The authored lighting program is validated structurally once and folded in
  // as advisory issues; it never blocks the flight validation result.
  for (const issue of validateLightingProgram(project).issues) {
    issues.push({
      id: `light-${++n}`,
      severity: issue.severity,
      category: "lighting",
      code: issue.code,
      message: issue.message,
      time: issue.time ?? 0,
      clipId: issue.clipId,
    });
  }

  return { sampledInstants: steps, invalidSamples, issues };
}
