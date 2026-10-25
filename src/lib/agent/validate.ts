/**
 * AI AGENT — pre-commit validation.
 *
 * Runs BEFORE an agent-proposed project is installed. The agent may never
 * commit a project that breaks hard invariants: non-finite geometry, points
 * outside the declared flight area, or altitudes outside the project safety
 * limits. A rigid rotation preserves velocities and separation by
 * construction, so those are not re-measured here; the full-show analysis
 * remains the authoritative safety report.
 */
import { sampleDynamicFormation } from "../show/dynamic/sampler";
import type { ShowProject, TimelineClip, Vector3Tuple } from "../show/types";

export type AgentValidationIssue =
  "NON_FINITE_GEOMETRY" | "OUTSIDE_FLIGHT_AREA" | "ALTITUDE_BELOW_MIN" | "ALTITUDE_ABOVE_MAX";

export interface AgentValidationResult {
  ok: boolean;
  issues: AgentValidationIssue[];
}

function checkPoints(
  project: ShowProject,
  points: readonly Vector3Tuple[],
  issues: Set<AgentValidationIssue>,
): void {
  const { width, depth, height } = project.area;
  const { minAltitude, maxAltitude } = project.limits;
  const hx = width / 2 + 1;
  const hz = depth / 2 + 1;
  for (const p of points) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
      issues.add("NON_FINITE_GEOMETRY");
      continue;
    }
    if (Math.abs(p[0]) > hx || Math.abs(p[2]) > hz || p[1] > height + 1) {
      issues.add("OUTSIDE_FLIGHT_AREA");
    }
    if (p[1] < minAltitude - 1e-6) issues.add("ALTITUDE_BELOW_MIN");
    if (p[1] > maxAltitude + 1e-6) issues.add("ALTITUDE_ABOVE_MAX");
  }
}

/** Validates the geometry reachable from one clip in a candidate project. */
export function validateAgentProject(project: ShowProject, clipId: string): AgentValidationResult {
  const issues = new Set<AgentValidationIssue>();
  const clip: TimelineClip | undefined = project.timeline.find((c) => c.id === clipId);
  if (clip) {
    if (clip.dynamicFormationId) {
      const f = project.dynamicFormations?.find((d) => d.id === clip.dynamicFormationId);
      if (f) {
        const steps = Math.max(8, Math.min(200, Math.ceil(f.duration * 4)));
        for (let i = 0; i <= steps; i++) {
          checkPoints(project, sampleDynamicFormation(f, (f.duration * i) / steps), issues);
        }
      }
    } else {
      const f = project.formations.find((x) => x.id === clip.formationId);
      if (f) checkPoints(project, f.points, issues);
    }
  }
  return { ok: issues.size === 0, issues: [...issues] };
}
