/**
 * IMPORTED LIGHTING AUDIT — PRESENTATION / ANALYSIS ONLY.
 *
 * TWO DISTINCT TRUTHS (never merged here):
 *   A. REFERENCE RGB   — the exact ESSP samples, owned by the reference layer.
 *   B. EDITABLE LIGHTING — the Studio lighting program authored by the operator.
 *
 * This module NEVER produces lighting effects and never touches the reference
 * bytes. It only DESCRIBES the imported RGB track so the operator can see
 * blackouts, held colours and colour changes on the timeline, and so we can
 * measure which intervals a Studio effect could reproduce with PROVABLE ZERO
 * sample error. Classification is done on the imported RGB clock, frame by
 * frame, against the original bytes — never on an interpolated preview clock.
 */

import { colorAt } from "../playback";
import type { ReferenceDrone, ReferenceShow } from "../types";
import { intervalAtTime } from "./intervals";
import type { ReferenceTrajectoryLayer } from "./types";

export type ImportedLightingKind =
  /** Every drone, every frame is exactly (0,0,0). */
  | "BLACKOUT"
  /** One colour held for the whole interval, identical on every drone. */
  | "SOLID"
  /** Colour changes over the interval, or drones differ from each other. */
  | "VARYING";

export interface ImportedLightingInterval {
  readonly startTime: number;
  /** Exclusive end on the RGB clock. */
  readonly endTime: number;
  readonly kind: ImportedLightingKind;
  /** Fleet colour when SOLID / BLACKOUT, else the first frame's mean colour. */
  readonly color: readonly [number, number, number];
  /** True when every drone shares the same colour in every frame. */
  readonly fleetUniform: boolean;
  /** Playback ownership of the interval start (REFERENCE / PLANNER / null). */
  readonly owner: "REFERENCE" | "PLANNER" | null;
  /**
   * TRUE only when an existing Studio semantic effect can reproduce every RGB
   * byte of this interval with ZERO error (global solid colour, blackout).
   */
  readonly exactlyReconstructible: boolean;
}

export interface ImportedLightingAudit {
  readonly rgbRateHz: number;
  readonly frameCount: number;
  readonly droneCount: number;
  readonly intervals: readonly ImportedLightingInterval[];
  /** Share of RGB frames covered by zero-error reconstructible intervals. */
  readonly exactCoverage: number;
  readonly blackoutSeconds: number;
  readonly solidSeconds: number;
  readonly varyingSeconds: number;
}

function frameColor(drone: ReferenceDrone, frame: number): [number, number, number] {
  const i = Math.min(Math.max(frame, 0), Math.max(0, drone.rgbSampleCount - 1)) * 3;
  return [drone.rgbSamples[i] ?? 0, drone.rgbSamples[i + 1] ?? 0, drone.rgbSamples[i + 2] ?? 0];
}

/** Fleet colour of one RGB frame, or null when drones disagree. */
function uniformFrameColor(
  show: ReferenceShow,
  frame: number,
): [number, number, number] | null {
  const first = show.drones[0];
  if (!first) return null;
  const base = frameColor(first, frame);
  for (let d = 1; d < show.drones.length; d += 1) {
    const c = frameColor(show.drones[d]!, frame);
    if (c[0] !== base[0] || c[1] !== base[1] || c[2] !== base[2]) return null;
  }
  return base;
}

function meanFrameColor(show: ReferenceShow, frame: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const drone of show.drones) {
    const c = frameColor(drone, frame);
    r += c[0];
    g += c[1];
    b += c[2];
  }
  const n = Math.max(1, show.drones.length);
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * Segments the imported RGB track into maximal runs of identical fleet
 * behaviour. A run ends when the uniform fleet colour changes, when the fleet
 * stops being uniform, or when playback ownership changes.
 */
export function analyzeImportedLighting(
  show: ReferenceShow | null,
  layer: ReferenceTrajectoryLayer | null,
): ImportedLightingAudit | null {
  if (!show || show.drones.length === 0) return null;
  const rate = show.timing.rgbRateHz;
  const frames = Math.max(
    1,
    Math.min(...show.drones.map((d) => d.rgbSampleCount)) || show.timing.rgbSampleCount,
  );
  const dt = 1 / rate;

  interface Run {
    start: number;
    end: number;
    uniform: [number, number, number] | null;
    fleetUniform: boolean;
    owner: "REFERENCE" | "PLANNER" | null;
    changed: boolean;
    firstMean: [number, number, number];
  }
  const runs: Run[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame * dt;
    const uniform = uniformFrameColor(show, frame);
    const owner = layer ? (intervalAtTime(layer, time)?.owner ?? null) : null;
    const current = runs[runs.length - 1];
    const sameColor =
      current &&
      current.owner === owner &&
      ((uniform === null && !current.fleetUniform) ||
        (uniform !== null &&
          current.uniform !== null &&
          uniform[0] === current.uniform[0] &&
          uniform[1] === current.uniform[1] &&
          uniform[2] === current.uniform[2]));
    if (sameColor && current) {
      current.end = frame + 1;
      continue;
    }
    runs.push({
      start: frame,
      end: frame + 1,
      uniform,
      fleetUniform: uniform !== null,
      owner,
      changed: false,
      firstMean: uniform ?? meanFrameColor(show, frame),
    });
  }

  const intervals: ImportedLightingInterval[] = runs.map((run) => {
    const black = run.fleetUniform && run.uniform![0] === 0 && run.uniform![1] === 0 && run.uniform![2] === 0;
    const kind: ImportedLightingKind = black ? "BLACKOUT" : run.fleetUniform ? "SOLID" : "VARYING";
    return {
      startTime: run.start * dt,
      endTime: run.end * dt,
      kind,
      color: run.firstMean,
      fleetUniform: run.fleetUniform,
      owner: run.owner,
      // ZERO-ERROR ONLY: a held global colour (including black) is reproduced
      // byte-exactly by a SOLID_COLOR / blackout Studio effect. Anything that
      // varies within the interval or across the fleet is NOT claimed exact.
      exactlyReconstructible: kind !== "VARYING",
    };
  });

  const exactFrames = runs.reduce(
    (sum, run, i) => sum + (intervals[i]!.exactlyReconstructible ? run.end - run.start : 0),
    0,
  );
  const seconds = (kind: ImportedLightingKind) =>
    intervals
      .filter((iv) => iv.kind === kind)
      .reduce((sum, iv) => sum + (iv.endTime - iv.startTime), 0);

  return {
    rgbRateHz: rate,
    frameCount: frames,
    droneCount: show.drones.length,
    intervals,
    exactCoverage: frames > 0 ? exactFrames / frames : 0,
    blackoutSeconds: seconds("BLACKOUT"),
    solidSeconds: seconds("SOLID"),
    varyingSeconds: seconds("VARYING"),
  };
}

/**
 * ZERO-ERROR VERIFICATION of one classified interval: samples the claimed
 * reconstruction (a constant fleet colour) at the imported RGB clock and
 * compares it against the ORIGINAL bytes of every drone. Returns the maximum
 * per-channel deviation; only 0 may be classified exact.
 */
export function verifyExactReconstruction(
  show: ReferenceShow,
  interval: ImportedLightingInterval,
): number {
  const rate = show.timing.rgbRateHz;
  const from = Math.round(interval.startTime * rate);
  const to = Math.round(interval.endTime * rate);
  let worst = 0;
  for (let frame = from; frame < to; frame += 1) {
    for (const drone of show.drones) {
      const c = colorAt(drone, frame / rate, rate);
      worst = Math.max(
        worst,
        Math.abs(c[0] - interval.color[0]),
        Math.abs(c[1] - interval.color[1]),
        Math.abs(c[2] - interval.color[2]),
      );
    }
  }
  return worst;
}
