/**
 * PRESENTATION-ONLY GEOFENCE PROJECTION.
 *
 * Projects the canonical `scanGeofence()` verdict onto the geometry the operator
 * authored: every formation a timeline clip actually uses. It is deliberately
 * honest about its scope — it checks AUTHORED FORMATION POSITIONS, not flown
 * transition paths, which remain the domain of full-show validation. No second
 * safety model is introduced here; the site classification is the canonical one.
 */
import { scanGeofence, type GeofenceScanResult, type ShowSite } from "../show/geo";
import type { ShowProject, Vector3Tuple } from "../show/types";

export interface FormationGeofenceResult {
  formationId: string;
  formationName: string;
  scan: GeofenceScanResult;
}

export interface ProjectGeofenceResult {
  formations: FormationGeofenceResult[];
  /** Formations with at least one drone outside the polygon or above ceiling. */
  blockedFormations: number;
  /** Formations only breaching the authored clearance margin. */
  warningFormations: number;
  minClearanceM: number;
  minHeadroomM: number;
  checkedFormations: number;
}

/** Formations referenced by the timeline, in timeline order, without repeats. */
function usedFormations(project: ShowProject) {
  const seen = new Set<string>();
  const out: { id: string; name: string; points: readonly Vector3Tuple[] }[] = [];
  for (const clip of project.timeline) {
    const id = clip.formationId;
    if (!id || seen.has(id)) continue;
    const formation = project.formations.find((f) => f.id === id);
    if (!formation) continue;
    seen.add(id);
    out.push({ id: formation.id, name: formation.name, points: formation.points });
  }
  return out;
}

export function checkProjectGeofence(project: ShowProject, site: ShowSite): ProjectGeofenceResult {
  const formations = usedFormations(project).map(({ id, name, points }) => ({
    formationId: id,
    formationName: name,
    scan: scanGeofence(
      points.map((position, droneIndex) => ({ droneIndex, time: 0, position })),
      site,
    ),
  }));

  let blockedFormations = 0;
  let warningFormations = 0;
  let minClearanceM = Infinity;
  let minHeadroomM = Infinity;
  for (const entry of formations) {
    const { outsideCount, ceilingCount, marginCount } = entry.scan;
    if (outsideCount > 0 || ceilingCount > 0) blockedFormations += 1;
    else if (marginCount > 0) warningFormations += 1;
    minClearanceM = Math.min(minClearanceM, entry.scan.minClearanceM);
    minHeadroomM = Math.min(minHeadroomM, entry.scan.minHeadroomM);
  }

  return {
    formations,
    blockedFormations,
    warningFormations,
    minClearanceM: Number.isFinite(minClearanceM) ? minClearanceM : 0,
    minHeadroomM: Number.isFinite(minHeadroomM) ? minHeadroomM : 0,
    checkedFormations: formations.length,
  };
}

export type GeofenceVerdict = "no-site" | "nothing-to-check" | "blocked" | "warning" | "clear";

export function geofenceVerdict(result: ProjectGeofenceResult | null): GeofenceVerdict {
  if (!result) return "no-site";
  if (result.checkedFormations === 0) return "nothing-to-check";
  if (result.blockedFormations > 0) return "blocked";
  if (result.warningFormations > 0) return "warning";
  return "clear";
}

export function geofenceVerdictLabel(verdict: GeofenceVerdict): string {
  switch (verdict) {
    case "no-site":
      return "No site set";
    case "nothing-to-check":
      return "No formations on the timeline";
    case "blocked":
      return "Outside the authorised area";
    case "warning":
      return "Close to the boundary";
    case "clear":
      return "Inside the authorised area";
  }
}
