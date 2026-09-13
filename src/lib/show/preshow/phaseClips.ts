/**
 * AUTOMATIC TAKE-OFF AND LANDING CLIP MATHS (pure).
 *
 * The take-off climb-out and the return-to-home descent are technical segments
 * no designer should have to hand-author. This module only builds the CANONICAL
 * timeline clips for them, from the project's own altitudes and flight envelope.
 *
 * It invents no safety rule: the suggested duration is the authored altitude
 * divided by a conservative fraction of the authored maximum velocity, and the
 * dedicated TAKEOFF/LANDING planners remain the only owners of the geometry.
 */
import { clipPhase, type ShowProject, type TimelineClip } from "../types";

/** Fraction of the authored maximum velocity used for a vertical segment. */
export const VERTICAL_SPEED_FRACTION = 0.4;

export interface PhaseClipParams {
  /** Seconds spent climbing or descending. */
  readonly transition: number;
  /** Seconds held after the vertical move completes. */
  readonly hold: number;
}

/** Conservative vertical duration for `altitude`, never below 4 s. */
export function suggestVerticalDuration(altitude: number, maxVelocity: number): number {
  const speed = Math.max(0.1, maxVelocity * VERTICAL_SPEED_FRACTION);
  return Math.max(4, Math.round((Math.max(0, altitude) / speed) * 10) / 10);
}

export function defaultTakeoffParams(project: ShowProject): PhaseClipParams {
  return {
    transition: suggestVerticalDuration(project.altitudes.takeoff, project.limits.maxVelocity),
    hold: 4,
  };
}

export function defaultLandingParams(project: ShowProject): PhaseClipParams {
  return {
    transition: suggestVerticalDuration(project.altitudes.show, project.limits.maxVelocity),
    hold: 2,
  };
}

export function hasPhaseClip(
  timeline: readonly TimelineClip[],
  phase: "TAKEOFF" | "SHOW" | "LANDING",
): boolean {
  return timeline.some((c) => clipPhase(c) === phase);
}

function sanitize(params: PhaseClipParams): PhaseClipParams {
  return {
    transition: Math.max(0.5, params.transition),
    hold: Math.max(0, params.hold),
  };
}

/**
 * Prepends a TAKEOFF clip at t = 0 and shifts every existing clip forward, so
 * the show body keeps its relative order and length.
 */
export function withTakeoffClip(
  timeline: readonly TimelineClip[],
  clip: { readonly id: string; readonly formationId: string },
  params: PhaseClipParams,
): TimelineClip[] {
  const p = sanitize(params);
  const shift = p.transition + p.hold;
  const takeoff: TimelineClip = {
    id: clip.id,
    formationId: clip.formationId,
    start: 0,
    transition: p.transition,
    hold: p.hold,
    easing: "minJerk",
    color: [80, 200, 255],
    effect: "solid",
    phase: "TAKEOFF",
  };
  return [takeoff, ...timeline.map((c) => ({ ...c, start: c.start + shift }))];
}

/** Appends a LANDING clip after the whole authored body. */
export function withLandingClip(
  timeline: readonly TimelineClip[],
  clip: { readonly id: string; readonly formationId: string },
  params: PhaseClipParams,
): TimelineClip[] {
  const p = sanitize(params);
  const end = timeline.reduce((m, c) => Math.max(m, c.start + c.transition + c.hold), 0);
  const landing: TimelineClip = {
    id: clip.id,
    formationId: clip.formationId,
    start: end,
    transition: p.transition,
    hold: p.hold,
    easing: "minJerk",
    color: [70, 100, 200],
    effect: "solid",
    phase: "LANDING",
  };
  return [...timeline, landing];
}
