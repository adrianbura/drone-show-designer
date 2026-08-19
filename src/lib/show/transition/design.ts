/**
 * TRANSITION DESIGN (designer-facing layer over the existing override format).
 *
 * This module adds NO new planner, NO second scheduler and NO parallel offset
 * storage. It is a pure translator:
 *
 *   designer intent (mode + stagger pattern + total stagger)
 *        -> the EXISTING `ClipTransitionOverride`
 *           (targetPointIndex / startOffsets / laneOffsets)
 *
 * The canonical target assignment always comes from a `TransitionAnalysis`
 * produced by the existing optimizer/analyzer (`analyzeTransition`), so the
 * assignment a designed transition flies is exactly the assignment the
 * scheduler would resolve. Offsets are derived from the CANONICAL SOURCE
 * GEOMETRY of the analysis (`dronePlans[i].from`), never from viewport pixels.
 *
 * Clamping follows the scheduler contract: a start offset is consumed as
 * `duration = transition - startOffset` and bounded by `transition * 0.5`
 * (see trajectory/schedule.ts and transition/plan.ts).
 */
import type { ClipTransitionOverride } from "../trajectory/schedule";
import type { Vector3Tuple } from "../types";
import type { TransitionAnalysis } from "./types";

export type TransitionModeId = "AUTO" | "SYNCHRONIZED" | "STAGGERED" | "MANUAL";

export const TRANSITION_MODES: readonly TransitionModeId[] = [
  "AUTO",
  "SYNCHRONIZED",
  "STAGGERED",
  "MANUAL",
];

export type StaggerPatternId =
  | "LEFT_RIGHT"
  | "RIGHT_LEFT"
  | "FRONT_BACK"
  | "BACK_FRONT"
  | "CENTER_OUT"
  | "OUTSIDE_IN";

export const STAGGER_PATTERNS: readonly StaggerPatternId[] = [
  "LEFT_RIGHT",
  "RIGHT_LEFT",
  "FRONT_BACK",
  "BACK_FRONT",
  "CENTER_OUT",
  "OUTSIDE_IN",
];

export type StaggerDistributionId = "linear" | "smooth";

export const STAGGER_DISTRIBUTIONS: readonly StaggerDistributionId[] = ["linear", "smooth"];

/** Authored transition design state for ONE clip. Persisted with planning. */
export interface TransitionDesignState {
  readonly mode: TransitionModeId;
  readonly pattern: StaggerPatternId;
  /** Total stagger spread in seconds (first drone 0 .. last drone total). */
  readonly totalStagger: number;
  readonly distribution: StaggerDistributionId;
}

export const DEFAULT_TRANSITION_DESIGN: TransitionDesignState = {
  mode: "AUTO",
  pattern: "LEFT_RIGHT",
  totalStagger: 2,
  distribution: "linear",
};

export const MAX_TOTAL_STAGGER = 10;

const PATTERN_LABEL: Record<StaggerPatternId, string> = {
  LEFT_RIGHT: "L→R",
  RIGHT_LEFT: "R→L",
  FRONT_BACK: "F→B",
  BACK_FRONT: "B→F",
  CENTER_OUT: "C→OUT",
  OUTSIDE_IN: "OUT→C",
};

export function staggerPatternLabel(pattern: StaggerPatternId): string {
  return PATTERN_LABEL[pattern];
}

export function isTransitionMode(v: unknown): v is TransitionModeId {
  return typeof v === "string" && (TRANSITION_MODES as readonly string[]).includes(v);
}

export function isStaggerPattern(v: unknown): v is StaggerPatternId {
  return typeof v === "string" && (STAGGER_PATTERNS as readonly string[]).includes(v);
}

export function isStaggerDistribution(v: unknown): v is StaggerDistributionId {
  return typeof v === "string" && (STAGGER_DISTRIBUTIONS as readonly string[]).includes(v);
}

/** Normalises any partial/untrusted design payload into a valid design. */
export function normalizeTransitionDesign(raw: unknown): TransitionDesignState {
  const o = (raw ?? {}) as Partial<TransitionDesignState>;
  const total = typeof o.totalStagger === "number" && Number.isFinite(o.totalStagger)
    ? Math.max(0, Math.min(MAX_TOTAL_STAGGER, o.totalStagger))
    : DEFAULT_TRANSITION_DESIGN.totalStagger;
  return {
    mode: isTransitionMode(o.mode) ? o.mode : DEFAULT_TRANSITION_DESIGN.mode,
    pattern: isStaggerPattern(o.pattern) ? o.pattern : DEFAULT_TRANSITION_DESIGN.pattern,
    totalStagger: total,
    distribution: isStaggerDistribution(o.distribution)
      ? o.distribution
      : DEFAULT_TRANSITION_DESIGN.distribution,
  };
}

/** Compact designer-facing summary, e.g. "STAGGER 3.0s L→R". */
export function describeTransitionDesign(design: TransitionDesignState): string {
  switch (design.mode) {
    case "AUTO":
      return "AUTO";
    case "SYNCHRONIZED":
      return "SYNC";
    case "STAGGERED":
      return `STAGGER ${design.totalStagger.toFixed(1)}s ${staggerPatternLabel(design.pattern)}`;
    case "MANUAL":
      return "MANUAL";
  }
}

/**
 * Mode inferred from override data alone — used for legacy projects (v1/v2/v3)
 * that carry an override without an explicit design descriptor.
 */
export function deriveTransitionMode(override: ClipTransitionOverride | undefined): TransitionModeId {
  if (!override) return "AUTO";
  const flat =
    override.startOffsets.every((v) => Math.abs(v) < 1e-6) &&
    override.laneOffsets.every((v) => Math.abs(v) < 1e-6);
  return flat ? "SYNCHRONIZED" : "MANUAL";
}

function ranking(from: readonly Vector3Tuple[], pattern: StaggerPatternId): number[] {
  const n = from.length;
  let cx = 0;
  let cz = 0;
  for (const p of from) {
    cx += p[0];
    cz += p[2];
  }
  cx /= Math.max(1, n);
  cz /= Math.max(1, n);
  return from.map((p) => {
    switch (pattern) {
      case "LEFT_RIGHT":
        return p[0];
      case "RIGHT_LEFT":
        return -p[0];
      case "FRONT_BACK":
        return p[2];
      case "BACK_FRONT":
        return -p[2];
      case "CENTER_OUT":
        return Math.hypot(p[0] - cx, p[2] - cz);
      case "OUTSIDE_IN":
        return -Math.hypot(p[0] - cx, p[2] - cz);
    }
  });
}

function shape(u: number, distribution: StaggerDistributionId): number {
  if (distribution === "smooth") return u * u * (3 - 2 * u);
  return u;
}

/**
 * Deterministic start offsets for a stagger pattern.
 *
 * `total` is the spread between the first and last departing drone; every
 * offset is additionally clamped to `duration * 0.5`, the scheduler bound.
 */
export function staggerStartOffsets(
  from: readonly Vector3Tuple[],
  pattern: StaggerPatternId,
  total: number,
  duration: number,
  distribution: StaggerDistributionId = "linear",
): number[] {
  const n = from.length;
  if (n === 0) return [];
  const cap = Math.max(0, Math.min(Math.max(0, total), Math.max(0, duration) * 0.5, MAX_TOTAL_STAGGER));
  if (cap <= 0) return new Array<number>(n).fill(0);
  const keys = ranking(from, pattern);
  let min = Infinity;
  let max = -Infinity;
  for (const k of keys) {
    if (k < min) min = k;
    if (k > max) max = k;
  }
  const span = max - min;
  if (!(span > 1e-9)) return new Array<number>(n).fill(0);
  return keys.map((k) => round4(shape((k - min) / span, distribution) * cap));
}

function round4(v: number): number {
  return Number(v.toFixed(4));
}

/**
 * Translates a design into the existing override format, using the canonical
 * assignment of `analysis`. Returns `null` for AUTO (no authored override) and
 * for MANUAL (manual mode edits the existing override data directly).
 */
export function buildDesignOverride(
  analysis: TransitionAnalysis,
  design: TransitionDesignState,
  duration: number,
): ClipTransitionOverride | null {
  if (design.mode === "AUTO" || design.mode === "MANUAL") return null;
  if (analysis.dronePlans.length === 0) return null;
  const targetPointIndex = analysis.dronePlans.map((p) => p.targetPointIndex);
  const from = analysis.dronePlans.map((p) => p.from);
  const zeros = new Array<number>(analysis.dronePlans.length).fill(0);
  if (design.mode === "SYNCHRONIZED") {
    return {
      targetPointIndex,
      startOffsets: [...zeros],
      laneOffsets: [...zeros],
      strategy: `${analysis.metrics.assignmentStrategy}+sync`,
    };
  }
  return {
    targetPointIndex,
    startOffsets: staggerStartOffsets(
      from,
      design.pattern,
      design.totalStagger,
      duration,
      design.distribution,
    ),
    laneOffsets: [...zeros],
    strategy: `${analysis.metrics.assignmentStrategy}+stagger:${design.pattern}`,
  };
}

export interface DepartureGroups {
  readonly early: number;
  readonly middle: number;
  readonly late: number;
  readonly maxOffset: number;
  /** Histogram of offsets over 8 equal buckets between 0 and maxOffset. */
  readonly histogram: readonly number[];
}

/** Lightweight departure-timing summary for the transition visualisation. */
export function departureGroups(startOffsets: readonly number[]): DepartureGroups {
  const buckets = new Array<number>(8).fill(0);
  const max = startOffsets.reduce((m, v) => Math.max(m, v), 0);
  let early = 0;
  let middle = 0;
  let late = 0;
  for (const v of startOffsets) {
    const u = max > 1e-9 ? v / max : 0;
    if (u < 1 / 3) early++;
    else if (u < 2 / 3) middle++;
    else late++;
    const idx = Math.min(7, Math.floor(u * 8));
    buckets[idx] = (buckets[idx] ?? 0) + 1;
  }
  return { early, middle, late, maxOffset: max, histogram: buckets };
}
