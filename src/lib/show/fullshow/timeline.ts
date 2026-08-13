/**
 * Timeline structure validation and home-pad validation.
 *
 * Pure and independent of trajectories: these checks answer "is this show
 * describable at all?" before any planning cost is paid.
 */
import { buildDroneDefinitions } from "../drones";
import { clipPhase, showDuration, type ShowProject } from "../types";
import type { FullShowIssue, HomePadReport, TimelineValidationReport } from "./types";

const PHASE_ORDER = { TAKEOFF: 0, SHOW: 1, LANDING: 2 } as const;

export function validateTimelineStructure(project: ShowProject): TimelineValidationReport {
  const issues: FullShowIssue[] = [];
  const clips = [...project.timeline].sort((a, b) => a.start - b.start);
  const duration = showDuration(project);
  let n = 0;
  const issue = (i: Omit<FullShowIssue, "id">): void => {
    issues.push({ ...i, id: `tl-${++n}` });
  };

  if (clips.length === 0) {
    issue({
      severity: "error",
      category: "timeline",
      code: "EMPTY_TIMELINE",
      message: "The timeline is empty: there is no show to validate.",
    });
  }

  const takeoffs = clips.filter((c) => clipPhase(c) === "TAKEOFF");
  const landings = clips.filter((c) => clipPhase(c) === "LANDING");

  if (takeoffs.length === 0) {
    issue({
      severity: "error",
      category: "takeoff",
      code: "MISSING_TAKEOFF",
      message: "No TAKEOFF clip: the show does not describe how the fleet leaves the ground.",
    });
  }
  if (landings.length === 0) {
    issue({
      severity: "error",
      category: "landing",
      code: "MISSING_LANDING",
      message: "No LANDING clip: the show does not describe how the fleet returns to the ground.",
    });
  }
  if (landings.length > 1) {
    issue({
      severity: "warning",
      category: "landing",
      code: "MULTIPLE_LANDINGS",
      message: `${landings.length} LANDING clips found; only the last one ends the show.`,
      clipId: landings[landings.length - 1]!.id,
    });
  }
  if (landings.length > 0) {
    const last = clips[clips.length - 1]!;
    if (clipPhase(last) !== "LANDING") {
      issue({
        severity: "error",
        category: "landing",
        code: "LANDING_NOT_LAST",
        message: `LANDING is not the final clip: "${last.id}" runs after it.`,
        clipId: last.id,
        time: last.start,
      });
    }
  }
  if (clips.length > 0 && clipPhase(clips[0]!) !== "TAKEOFF") {
    issue({
      severity: "error",
      category: "takeoff",
      code: "TAKEOFF_NOT_FIRST",
      message: `The show starts with "${clips[0]!.id}" (${clipPhase(clips[0]!)}) instead of a TAKEOFF clip.`,
      clipId: clips[0]!.id,
      time: clips[0]!.start,
    });
  }

  let phaseOrderValid = true;
  let previousPhaseRank = -1;
  let previousEnd = 0;
  for (const [i, clip] of clips.entries()) {
    const phase = clipPhase(clip);
    const end = clip.start + clip.transition + clip.hold;

    if (!Number.isFinite(clip.start) || clip.start < 0) {
      issue({
        severity: "error",
        category: "timeline",
        code: "INVALID_START",
        message: `Clip "${clip.id}" has an invalid start time (${clip.start}).`,
        clipId: clip.id,
      });
    }
    if (!(clip.transition > 0)) {
      issue({
        severity: "error",
        category: "timeline",
        code: "NON_POSITIVE_TRANSITION",
        message: `Clip "${clip.id}" has a non-positive transition duration (${clip.transition}s).`,
        clipId: clip.id,
        time: clip.start,
        value: clip.transition,
      });
    }
    if (clip.hold < 0) {
      issue({
        severity: "error",
        category: "timeline",
        code: "NEGATIVE_HOLD",
        message: `Clip "${clip.id}" has a negative hold (${clip.hold}s).`,
        clipId: clip.id,
        time: clip.start,
        value: clip.hold,
      });
    }
    if (phase !== "LANDING" && !project.formations.some((f) => f.id === clip.formationId)) {
      issue({
        severity: "error",
        category: "timeline",
        code: "MISSING_FORMATION",
        message: `Clip "${clip.id}" references a formation that no longer exists.`,
        clipId: clip.id,
        time: clip.start,
      });
    }
    if (i > 0 && clip.start < previousEnd - 1e-6) {
      issue({
        severity: "error",
        category: "timeline",
        code: "CLIP_OVERLAP",
        message: `Clip "${clip.id}" starts at ${clip.start.toFixed(2)}s, before the previous clip ends (${previousEnd.toFixed(2)}s).`,
        clipId: clip.id,
        time: clip.start,
        value: previousEnd - clip.start,
      });
    } else if (i > 0 && clip.start > previousEnd + 1e-6) {
      issue({
        severity: "warning",
        category: "timeline",
        code: "TIMELINE_GAP",
        message: `${(clip.start - previousEnd).toFixed(2)}s gap before clip "${clip.id}": the fleet hovers in place.`,
        clipId: clip.id,
        time: previousEnd,
        value: clip.start - previousEnd,
      });
    }
    const rank = PHASE_ORDER[phase];
    if (rank < previousPhaseRank) {
      phaseOrderValid = false;
      issue({
        severity: "error",
        category: "timeline",
        code: "PHASE_OUT_OF_ORDER",
        message: `Clip "${clip.id}" (${phase}) appears after a later phase; phases must run TAKEOFF -> SHOW -> LANDING.`,
        clipId: clip.id,
        phase,
        time: clip.start,
      });
    }
    previousPhaseRank = Math.max(previousPhaseRank, rank);
    previousEnd = end;
  }

  return {
    clipCount: clips.length,
    hasTakeoff: takeoffs.length > 0,
    hasLanding: landings.length > 0,
    landingCount: landings.length,
    phaseOrderValid,
    duration,
    issues,
  };
}

/**
 * Home pads are the physical launch/landing footprint. Overlapping pads are a
 * REAL problem: a valid airborne show that lands two drones on the same pad is
 * not flyable.
 */
export function validateHomePads(project: ShowProject): HomePadReport {
  const drones = buildDroneDefinitions(project);
  const issues: FullShowIssue[] = [];
  const halfW = project.area.width / 2;
  const halfD = project.area.depth / 2;
  const required = project.limits.minSeparation;
  let minSpacing = Infinity;
  let duplicateCount = 0;
  let outsideAreaCount = 0;
  let invalidAltitudeCount = 0;
  let nonFiniteCount = 0;
  let n = 0;

  for (const d of drones) {
    const p = d.homePosition;
    if (!p.every((v) => Number.isFinite(v))) {
      nonFiniteCount++;
      issues.push({
        id: `pad-${++n}`,
        severity: "error",
        category: "homePads",
        code: "NON_FINITE_PAD",
        message: `${d.id} has a non-finite home pad position.`,
        droneIds: [d.id],
        droneIndices: [d.index],
      });
      continue;
    }
    if (Math.abs(p[1]) > 1e-6) {
      invalidAltitudeCount++;
      issues.push({
        id: `pad-${++n}`,
        severity: "error",
        category: "homePads",
        code: "PAD_NOT_ON_GROUND",
        message: `${d.id} home pad is not at ground level (y = ${p[1].toFixed(2)} m).`,
        droneIds: [d.id],
        droneIndices: [d.index],
        value: p[1],
        limit: 0,
      });
    }
    if (Math.abs(p[0]) > halfW || Math.abs(p[2]) > halfD) {
      outsideAreaCount++;
      issues.push({
        id: `pad-${++n}`,
        severity: "error",
        category: "homePads",
        code: "PAD_OUTSIDE_AREA",
        message: `${d.id} home pad lies outside the show area footprint.`,
        droneIds: [d.id],
        droneIndices: [d.index],
      });
    }
  }

  for (let i = 0; i < drones.length; i++) {
    for (let j = i + 1; j < drones.length; j++) {
      const a = drones[i]!.homePosition;
      const b = drones[j]!.homePosition;
      const dxz = Math.hypot(a[0] - b[0], a[2] - b[2]);
      if (dxz < minSpacing) minSpacing = dxz;
      if (dxz < 1e-3) {
        duplicateCount++;
        if (duplicateCount <= 25) {
          issues.push({
            id: `pad-${++n}`,
            severity: "error",
            category: "homePads",
            code: "DUPLICATE_PAD",
            message: `${drones[i]!.id} and ${drones[j]!.id} share the same home pad.`,
            droneIds: [drones[i]!.id, drones[j]!.id],
            droneIndices: [i, j],
            value: dxz,
            limit: required,
          });
        }
      }
    }
  }

  if (Number.isFinite(minSpacing) && minSpacing >= 1e-3 && minSpacing < required) {
    issues.push({
      id: `pad-${++n}`,
      severity: "warning",
      category: "homePads",
      code: "PAD_SPACING_BELOW_SEPARATION",
      message: `Closest home pads are ${minSpacing.toFixed(2)} m apart, below the ${required.toFixed(2)} m separation minimum.`,
      value: minSpacing,
      limit: required,
    });
  }
  if (duplicateCount > 25) {
    issues.push({
      id: `pad-${++n}`,
      severity: "error",
      category: "homePads",
      code: "DUPLICATE_PAD_SUMMARY",
      message: `${duplicateCount} pad pairs share the same position (first 25 listed).`,
      value: duplicateCount,
    });
  }

  return {
    padCount: drones.length,
    minSpacing: Number.isFinite(minSpacing) ? minSpacing : 0,
    duplicateCount,
    outsideAreaCount,
    invalidAltitudeCount,
    nonFiniteCount,
    issues,
  };
}
