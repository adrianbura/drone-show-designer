/**
 * LIGHTING TIMELINE PRESENTATION (pure, deterministic).
 *
 * Turns CANONICAL lighting effects into timeline geometry and readouts. It
 * contains:
 *   - NO lighting evaluation (LED colour is only ever produced by the canonical
 *     lighting engine / the viewport),
 *   - NO second target resolver (targets come from the canonical model),
 *   - NO timeline view math (zoom/scroll/pixel mapping stay in `timelineEdit`),
 *   - NO store mutation (gesture results are handed to canonical store actions).
 *
 * Timing always resolves through `resolvedEffectInterval`, which delegates to
 * the canonical `resolveEffectStart` anchor authority.
 *
 * No React, no DOM.
 */
import type { LightingEffectInstance } from "@/lib/show/lighting";
import type { RGB, TimelineClip } from "@/lib/show/types";
import { resolvedEffectInterval } from "./lightingAuthoring";
import { pixelsPerSecond, snapTimelineTime, type SnapMode, type SnapResult } from "./timelineEdit";

/** Shortest authorable effect duration; mirrors the store's own clamp. */
export const MIN_EFFECT_DURATION = 0.1;

/** Width thresholds (CSS px) that decide how verbose one effect block may be. */
export const EFFECT_LABEL_PX = 44;
export const EFFECT_RICH_PX = 130;

export type EffectDensity = "COMPACT" | "MEDIUM" | "RICH";

export function effectDensity(widthPx: number): EffectDensity {
  if (widthPx >= EFFECT_RICH_PX) return "RICH";
  if (widthPx >= EFFECT_LABEL_PX) return "MEDIUM";
  return "COMPACT";
}

/** Language-neutral glyph label of an effect type (never translated). */
export function effectGlyph(type: LightingEffectInstance["type"]): string {
  switch (type) {
    case "FADE_IN":
      return "FADE IN";
    case "FADE_OUT":
      return "FADE OUT";
    case "DIRECTIONAL_REVEAL":
      return "REVEAL →";
    case "RADIAL_REVEAL":
      return "CENTER→OUT";
    case "RADIAL_HIDE":
      return "OUT→CENTER";
    case "PULSE":
      return "PULSE";
    case "COLOR_TRANSITION":
      return "COLOR →";
    case "COLOR_SWEEP":
      return "SWEEP";
    case "GROUP_SEQUENCE":
      return "SEQUENCE";
    default:
      return type;
  }
}

// ---------------------------------------------------------------------------
// COLOUR PRESENTATION (swatch data only — never an LED result)
// ---------------------------------------------------------------------------

export type EffectColorPresentation =
  | { readonly kind: "NONE" }
  | { readonly kind: "SOLID"; readonly colors: readonly RGB[] }
  | { readonly kind: "TRANSITION"; readonly colors: readonly RGB[] }
  | { readonly kind: "GRADIENT"; readonly colors: readonly RGB[]; readonly positions: readonly number[] };

export function effectColorPresentation(effect: LightingEffectInstance): EffectColorPresentation {
  const p = effect.parameters;
  if (effect.type === "COLOR_TRANSITION") {
    const from = p.fromColor;
    const to = p.toColor;
    if (from && to) return { kind: "TRANSITION", colors: [from, to] };
    const one = to ?? from;
    return one ? { kind: "SOLID", colors: [one] } : { kind: "NONE" };
  }
  if (effect.type === "COLOR_SWEEP") {
    const stops = p.stops ?? [];
    if (stops.length >= 2) {
      return {
        kind: "GRADIENT",
        colors: stops.map((s) => s.color),
        positions: stops.map((s) => Math.max(0, Math.min(1, s.position))),
      };
    }
    const one = stops[0]?.color ?? p.color;
    return one ? { kind: "SOLID", colors: [one] } : { kind: "NONE" };
  }
  const color = p.color ?? p.toColor;
  return color ? { kind: "SOLID", colors: [color] } : { kind: "NONE" };
}

// ---------------------------------------------------------------------------
// TARGET PRESENTATION
// ---------------------------------------------------------------------------

export interface EffectTargetPresentation {
  readonly kind: LightingEffectInstance["target"]["kind"];
  /** Object name when the target names one, else null. */
  readonly objectName: string | null;
  /** Short badge text, language-neutral ("SCENE", "OBJ: Heart"). */
  readonly badge: string;
}

export function effectTargetPresentation(
  effect: LightingEffectInstance,
  objects: readonly { readonly id: string; readonly name: string }[],
): EffectTargetPresentation {
  const target = effect.target;
  if (target.kind === "SCENE") return { kind: "SCENE", objectName: null, badge: "SCENE" };
  const name = objects.find((o) => o.id === target.instanceId)?.name ?? target.instanceId;
  return { kind: target.kind, objectName: name, badge: `OBJ: ${name}` };
}

// ---------------------------------------------------------------------------
// LANE PACKING (overlaps are valid: they stack, they are never hidden)
// ---------------------------------------------------------------------------

/**
 * Deterministic first-fit lane packing. Order is (start, end, id) so identical
 * input always produces identical lanes, independent of array order.
 */
export function packEffectLanes(
  intervals: readonly { readonly id: string; readonly start: number; readonly end: number }[],
): Map<string, number> {
  const sorted = [...intervals].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => item.start >= end - 1e-6);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    lanes.set(item.id, lane);
  }
  return lanes;
}

// ---------------------------------------------------------------------------
// BLOCK LAYOUT
// ---------------------------------------------------------------------------

export interface LightingBlock {
  readonly effect: LightingEffectInstance;
  readonly id: string;
  /** Absolute show time, resolved through the canonical anchor authority. */
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  /** 0..100 percentages of the SAME visible window the timeline uses. */
  readonly leftPct: number;
  readonly widthPct: number;
  readonly widthPx: number;
  readonly lane: number;
  readonly density: EffectDensity;
  readonly glyph: string;
  readonly target: EffectTargetPresentation;
  readonly color: EffectColorPresentation;
  /** True when the playhead is inside the resolved interval. */
  readonly active: boolean;
}

export interface LightingLayout {
  readonly blocks: readonly LightingBlock[];
  readonly laneCount: number;
}

export function layoutLightingEffects(input: {
  readonly effects: readonly LightingEffectInstance[];
  readonly clip: TimelineClip | null;
  readonly view: { readonly start: number; readonly end: number };
  readonly trackWidthPx: number;
  readonly objects?: readonly { readonly id: string; readonly name: string }[];
  readonly time?: number;
  /** Live gesture override: draft anchor-relative timing of one effect. */
  readonly draft?: { readonly id: string; readonly start: number; readonly duration: number } | null;
}): LightingLayout {
  const { clip, view, trackWidthPx, objects = [], time, draft } = input;
  if (!clip) return { blocks: [], laneCount: 0 };
  const span = Math.max(0.001, view.end - view.start);
  const pps = pixelsPerSecond(Math.max(1, trackWidthPx), view);

  const resolved = input.effects.flatMap((effect) => {
    const live =
      draft && draft.id === effect.id
        ? { ...effect, start: draft.start, duration: Math.max(MIN_EFFECT_DURATION, draft.duration) }
        : effect;
    const interval = resolvedEffectInterval(live, clip);
    if (!interval) return [];
    return [{ effect: live, interval }];
  });

  const lanes = packEffectLanes(
    resolved.map((r) => ({ id: r.effect.id, start: r.interval.start, end: r.interval.end })),
  );

  const blocks = resolved
    .map(({ effect, interval }): LightingBlock => {
      const duration = Math.max(MIN_EFFECT_DURATION, interval.end - interval.start);
      const widthPx = duration * pps;
      return {
        effect,
        id: effect.id,
        start: interval.start,
        end: interval.end,
        duration,
        leftPct: ((interval.start - view.start) / span) * 100,
        widthPct: (duration / span) * 100,
        widthPx,
        lane: lanes.get(effect.id) ?? 0,
        density: effectDensity(widthPx),
        glyph: effectGlyph(effect.type),
        target: effectTargetPresentation(effect, objects),
        color: effectColorPresentation(effect),
        active:
          typeof time === "number" && time >= interval.start - 1e-6 && time <= interval.end + 1e-6,
      };
    })
    .sort((a, b) => a.lane - b.lane || a.start - b.start || a.id.localeCompare(b.id));

  return { blocks, laneCount: Math.max(0, ...blocks.map((b) => b.lane + 1), 0) };
}

// ---------------------------------------------------------------------------
// CLIP INDICATOR
// ---------------------------------------------------------------------------

export interface ClipLightingSummary {
  /** User-AUTHORED effect count on this clip (reference LEDs are not effects). */
  readonly count: number;
  readonly hasLighting: boolean;
}

export function clipLightingSummary(
  effects: readonly LightingEffectInstance[],
  clipId: string,
): ClipLightingSummary {
  let count = 0;
  for (const e of effects) if (e.target.clipId === clipId) count += 1;
  return { count, hasLighting: count > 0 };
}

// ---------------------------------------------------------------------------
// GESTURE MATH (anchor-preserving; results go to canonical store actions)
// ---------------------------------------------------------------------------

/** Timing guides an effect gesture may capture, in absolute show time. */
export function lightingGuideTimes(clip: TimelineClip, playhead?: number): number[] {
  const guides = [clip.start, clip.start + clip.transition, clip.start + clip.transition + clip.hold];
  if (typeof playhead === "number" && Number.isFinite(playhead)) guides.push(playhead);
  return guides.sort((a, b) => a - b);
}

export interface EffectSnapContext {
  readonly mode: SnapMode;
  readonly pixelsPerSecond: number;
  readonly guides: readonly number[];
  readonly beatGrid?: Parameters<typeof snapTimelineTime>[1]["beatGrid"];
  readonly markers?: readonly number[];
  /** Alt bypass. */
  readonly disabled?: boolean;
}

/**
 * Snaps an ABSOLUTE show time using the existing snap engine. Guides and
 * markers are captured with the MARKER strategy; grid/beat/bar modes fall
 * through to their canonical behaviour.
 */
export function snapEffectTime(absolute: number, ctx: EffectSnapContext): SnapResult {
  const guideHit = snapTimelineTime(absolute, {
    mode: "MARKER",
    pixelsPerSecond: ctx.pixelsPerSecond,
    markers: [...ctx.guides, ...(ctx.markers ?? [])],
    ...(ctx.disabled === undefined ? {} : { disabled: ctx.disabled }),
  });
  if (guideHit.snapped) return guideHit;
  return snapTimelineTime(absolute, {
    mode: ctx.mode,
    pixelsPerSecond: ctx.pixelsPerSecond,
    ...(ctx.beatGrid ? { beatGrid: ctx.beatGrid } : {}),
    ...(ctx.markers ? { markers: ctx.markers } : {}),
    ...(ctx.disabled === undefined ? {} : { disabled: ctx.disabled }),
  });
}

export interface EffectTimingDraft {
  readonly start: number;
  readonly duration: number;
  readonly snap: SnapResult;
}

/**
 * MOVE — anchor is PRESERVED: only the anchor-relative offset changes, so
 * `FORMATION_READY + 1s` dragged by +2s becomes `FORMATION_READY + 3s`.
 */
export function dragEffectStart(
  effect: LightingEffectInstance,
  anchorBase: number,
  deltaSeconds: number,
  ctx: EffectSnapContext,
): EffectTimingDraft {
  const absolute = anchorBase + effect.start + deltaSeconds;
  const snap = snapEffectTime(absolute, ctx);
  return { start: round3(snap.time - anchorBase), duration: effect.duration, snap };
}

/** RIGHT HANDLE — duration only; start (and therefore the anchor) untouched. */
export function resizeEffectDuration(
  effect: LightingEffectInstance,
  anchorBase: number,
  deltaSeconds: number,
  ctx: EffectSnapContext,
): EffectTimingDraft {
  const absoluteEnd = anchorBase + effect.start + effect.duration + deltaSeconds;
  const snap = snapEffectTime(absoluteEnd, ctx);
  const duration = Math.max(MIN_EFFECT_DURATION, snap.time - (anchorBase + effect.start));
  return { start: effect.start, duration: round3(duration), snap };
}

/** LEFT HANDLE — moves the start while PRESERVING the resolved end. */
export function resizeEffectStart(
  effect: LightingEffectInstance,
  anchorBase: number,
  deltaSeconds: number,
  ctx: EffectSnapContext,
): EffectTimingDraft {
  const end = effect.start + effect.duration;
  const snap = snapEffectTime(anchorBase + effect.start + deltaSeconds, ctx);
  const rawStart = snap.time - anchorBase;
  const start = Math.min(rawStart, end - MIN_EFFECT_DURATION);
  return { start: round3(start), duration: round3(end - start), snap };
}

function round3(v: number): number {
  return Number.isFinite(v) ? Number(v.toFixed(3)) : 0;
}
