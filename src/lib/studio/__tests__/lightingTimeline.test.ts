/**
 * LIGHTING TIMELINE PRESENTATION — deterministic geometry, gesture math and
 * readouts. No DOM, no CSS snapshots.
 */
import { describe, expect, it } from "vitest";

import { createEffectFromPreset, findLightingPreset } from "@/lib/show/lighting";
import type { LightingEffectInstance } from "@/lib/show/lighting";
import type { TimelineClip } from "@/lib/show/types";
import {
  MIN_EFFECT_DURATION,
  clipLightingSummary,
  dragEffectStart,
  effectColorPresentation,
  effectTargetPresentation,
  layoutLightingEffects,
  lightingGuideTimes,
  packEffectLanes,
  resizeEffectDuration,
  resizeEffectStart,
  type EffectSnapContext,
} from "../lightingTimeline";

const clip: TimelineClip = {
  id: "c1",
  formationId: "f1",
  start: 10,
  transition: 4,
  hold: 6,
  easing: "smooth",
  color: [255, 255, 255],
  effect: "solid",
};

const noSnap: EffectSnapContext = { mode: "OFF", pixelsPerSecond: 20, guides: [], disabled: true };

function effect(patch: Partial<LightingEffectInstance> = {}): LightingEffectInstance {
  const preset = findLightingPreset("FADE_IN")!;
  const base = createEffectFromPreset(preset, { kind: "SCENE", clipId: "c1" }, { idSeed: 1 });
  return { ...base, anchor: "FORMATION_READY", start: 1, duration: 2, ...patch };
}

describe("effect interval -> timeline geometry", () => {
  it("maps the resolved interval into the visible window", () => {
    const layout = layoutLightingEffects({
      effects: [effect()],
      clip,
      view: { start: 0, end: 100 },
      trackWidthPx: 1000,
    });
    const block = layout.blocks[0]!;
    // FORMATION_READY = 14 s, +1 s offset.
    expect(block.start).toBe(15);
    expect(block.end).toBe(17);
    expect(block.leftPct).toBeCloseTo(15, 6);
    expect(block.widthPct).toBeCloseTo(2, 6);
    expect(block.widthPx).toBeCloseTo(20, 6);
  });

  it("marks a block active only while the playhead is inside it", () => {
    const args = { effects: [effect()], clip, view: { start: 0, end: 100 }, trackWidthPx: 1000 };
    expect(layoutLightingEffects({ ...args, time: 16 }).blocks[0]!.active).toBe(true);
    expect(layoutLightingEffects({ ...args, time: 18 }).blocks[0]!.active).toBe(false);
  });

  it("returns nothing without a governing clip", () => {
    expect(
      layoutLightingEffects({
        effects: [effect()],
        clip: null,
        view: { start: 0, end: 10 },
        trackWidthPx: 100,
      }).blocks,
    ).toEqual([]);
  });
});

describe("overlap layout", () => {
  it("stacks overlapping effects into deterministic lanes", () => {
    const a = effect({ id: "a", start: 0, duration: 4 });
    const b = effect({ id: "b", start: 1, duration: 4 });
    const c = effect({ id: "c", start: 6, duration: 1 });
    const forward = layoutLightingEffects({
      effects: [a, b, c],
      clip,
      view: { start: 0, end: 40 },
      trackWidthPx: 800,
    });
    const reversed = layoutLightingEffects({
      effects: [c, b, a],
      clip,
      view: { start: 0, end: 40 },
      trackWidthPx: 800,
    });
    const lanesOf = (l: typeof forward) => l.blocks.map((x) => [x.id, x.lane]);
    expect(lanesOf(forward)).toEqual(lanesOf(reversed));
    expect(forward.laneCount).toBe(2);
    expect(new Map(lanesOf(forward)).get("b")).toBe(1);
    expect(new Map(lanesOf(forward)).get("c")).toBe(0);
  });

  it("packs lanes first-fit", () => {
    const lanes = packEffectLanes([
      { id: "x", start: 0, end: 2 },
      { id: "y", start: 1, end: 3 },
      { id: "z", start: 2, end: 4 },
    ]);
    expect([lanes.get("x"), lanes.get("y"), lanes.get("z")]).toEqual([0, 1, 0]);
  });
});

describe("gesture math", () => {
  it("anchored drag only changes the offset and preserves the anchor", () => {
    const e = effect({ anchor: "FORMATION_READY", start: 1 });
    const next = dragEffectStart(e, 14, 2, noSnap);
    expect(next.start).toBe(3);
    expect(next.duration).toBe(e.duration);
    expect(e.anchor).toBe("FORMATION_READY");
  });

  it("right handle resizes duration only", () => {
    const e = effect({ start: 1, duration: 2 });
    const next = resizeEffectDuration(e, 14, 1.5, noSnap);
    expect(next.start).toBe(1);
    expect(next.duration).toBe(3.5);
  });

  it("right handle respects the minimum duration", () => {
    expect(resizeEffectDuration(effect({ duration: 2 }), 14, -100, noSnap).duration).toBe(
      MIN_EFFECT_DURATION,
    );
  });

  it("left handle preserves the resolved end", () => {
    const e = effect({ start: 1, duration: 2 });
    const next = resizeEffectStart(e, 14, -1, noSnap);
    expect(next.start).toBe(0);
    expect(next.duration).toBe(3);
    expect(next.start + next.duration).toBeCloseTo(e.start + e.duration, 6);
  });

  it("left handle never crosses the end", () => {
    const next = resizeEffectStart(effect({ start: 1, duration: 2 }), 14, 100, noSnap);
    expect(next.duration).toBe(MIN_EFFECT_DURATION);
    expect(next.start).toBeCloseTo(3 - MIN_EFFECT_DURATION, 6);
  });

  it("captures scene guides through the existing snap engine", () => {
    const guides = lightingGuideTimes(clip, 12);
    expect(guides).toEqual([10, 12, 14, 20]);
    const ctx: EffectSnapContext = { mode: "OFF", pixelsPerSecond: 200, guides };
    // Anchor base 0 (ABSOLUTE): dragging near 20 s (scene end) captures it.
    const next = dragEffectStart(effect({ anchor: "ABSOLUTE", start: 19.97 }), 0, 0, ctx);
    expect(next.snap.snapped).toBe(true);
    expect(next.start).toBe(20);
  });
});

describe("readouts", () => {
  it("labels scene and object targets", () => {
    expect(effectTargetPresentation(effect(), []).badge).toBe("SCENE");
    const objectEffect = effect({ target: { kind: "SCENE_OBJECT", clipId: "c1", instanceId: "o1" } });
    expect(
      effectTargetPresentation(objectEffect, [{ id: "o1", name: "Heart" }]).badge,
    ).toBe("OBJ: Heart");
  });

  it("presents solid, transition and gradient colour data", () => {
    expect(
      effectColorPresentation(effect({ type: "FADE_IN", parameters: { color: [1, 2, 3] } })).kind,
    ).toBe("SOLID");
    const transition = effectColorPresentation(
      effect({ type: "COLOR_TRANSITION", parameters: { fromColor: [255, 0, 0], toColor: [0, 0, 255] } }),
    );
    expect(transition).toEqual({ kind: "TRANSITION", colors: [[255, 0, 0], [0, 0, 255]] });
    const gradient = effectColorPresentation(
      effect({
        type: "COLOR_SWEEP",
        parameters: {
          stops: [
            { position: 0, color: [255, 0, 0] },
            { position: 1, color: [0, 255, 0] },
          ],
        },
      }),
    );
    expect(gradient.kind).toBe("GRADIENT");
    expect(gradient.kind === "GRADIENT" && gradient.positions).toEqual([0, 1]);
    expect(effectColorPresentation(effect({ type: "PULSE", parameters: {} })).kind).toBe("NONE");
  });

  it("counts authored effects per clip only", () => {
    const effects = [effect({ id: "a" }), effect({ id: "b" }), effect({ id: "c", target: { kind: "SCENE", clipId: "other" } })];
    expect(clipLightingSummary(effects, "c1")).toEqual({ count: 2, hasLighting: true });
    expect(clipLightingSummary(effects, "nope").hasLighting).toBe(false);
  });
});
