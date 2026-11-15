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
  counts: Map<AgentValidationIssue, number>,
): void {
  const bump = (i: AgentValidationIssue) => {
    issues.add(i);
    counts.set(i, (counts.get(i) ?? 0) + 1);
  };
  const { width, depth, height } = project.area;
  const { minAltitude, maxAltitude } = project.limits;
  const hx = width / 2 + 1;
  const hz = depth / 2 + 1;
  for (const p of points) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
      bump("NON_FINITE_GEOMETRY");
      continue;
    }
    if (Math.abs(p[0]) > hx || Math.abs(p[2]) > hz || p[1] > height + 1) {
      bump("OUTSIDE_FLIGHT_AREA");
    }
    if (p[1] < minAltitude - 1e-6) bump("ALTITUDE_BELOW_MIN");
    if (p[1] > maxAltitude + 1e-6) bump("ALTITUDE_ABOVE_MAX");
  }
}

function measureClip(project: ShowProject, clipId: string) {
  const issues = new Set<AgentValidationIssue>();
  const counts = new Map<AgentValidationIssue, number>();
  const clip: TimelineClip | undefined = project.timeline.find((c) => c.id === clipId);
  if (clip) {
    if (clip.dynamicFormationId) {
      const f = project.dynamicFormations?.find((d) => d.id === clip.dynamicFormationId);
      if (f) {
        const steps = Math.max(8, Math.min(200, Math.ceil(f.duration * 4)));
        for (let i = 0; i <= steps; i++) {
          checkPoints(project, sampleDynamicFormation(f, (f.duration * i) / steps), issues, counts);
        }
      }
    } else {
      const f = project.formations.find((x) => x.id === clip.formationId);
      if (f) checkPoints(project, f.points, issues, counts);
    }
  }
  return { issues, counts };
}

/**
 * Validates the geometry reachable from one clip in a candidate project.
 *
 * Absolute (fail-closed) by default. When `baseline` is given AND the project
 * carries an IMPORTED_SHOW safety profile, the rule is "do not worsen": an
 * imported scene that already violated the profile may be edited as long as
 * no violation type is added and no violation count grows (same sampling).
 * Non-finite geometry is always refused.
 */
export function validateAgentProject(
  project: ShowProject,
  clipId: string,
  baseline?: ShowProject,
): AgentValidationResult {
  const after = measureClip(project, clipId);
  const relative =
    !!baseline &&
    project.safetyProfile?.source === "IMPORTED_SHOW" &&
    baseline.safetyProfile?.source === "IMPORTED_SHOW";
  if (!relative) return { ok: after.issues.size === 0, issues: [...after.issues] };
  // Judge the baseline against the SAME limits/area the candidate uses.
  const before = measureClip({ ...baseline!, limits: project.limits, area: project.area }, clipId);
  const worse: AgentValidationIssue[] = [];
  for (const issue of after.issues) {
    if (issue === "NON_FINITE_GEOMETRY") worse.push(issue);
    else if ((after.counts.get(issue) ?? 0) > (before.counts.get(issue) ?? 0)) worse.push(issue);
  }
  return { ok: worse.length === 0, issues: worse };
}
