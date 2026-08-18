/**
 * LIGHTING ENGINE — determinism, gamut and integration tests (Sprint 7.4).
 */
import { describe, expect, it } from "vitest";

import { createDemoProject } from "../../defaultProject";
import { migrateProject } from "../../defaultProject";
import {
  LIGHTING_PRESETS,
  createEffectFromPreset,
  effectsForClip,
  emittedColor,
  findLightingPreset,
  projectLightingAt,
  resolveEffectStart,
  sanitizeLightingProgram,
  validateLightingProgram,
  type LightingEffectInstance,
  type LightingProgram,
} from "..";
import type { ShowProject } from "../../types";

function projectWithEffects(effects: LightingEffectInstance[]): ShowProject {
  const base = createDemoProject(24);
  const lighting: LightingProgram = { schemaVersion: 1, effects };
  return { ...base, lighting };
}

function effectOn(clipId: string, presetId: string, overrides: Partial<LightingEffectInstance> = {}) {
  const preset = findLightingPreset(presetId)!;
  return {
    ...createEffectFromPreset(preset, { kind: "SCENE", clipId }, { idSeed: 1 }),
    id: `fx-${presetId}`,
    ...overrides,
  } as LightingEffectInstance;
}

describe("lighting presets", () => {
  it("exposes unique preset ids and i18n label keys", () => {
    const ids = new Set(LIGHTING_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(LIGHTING_PRESETS.length);
    expect(LIGHTING_PRESETS.every((p) => p.labelKey.startsWith("lighting.preset."))).toBe(true);
  });

  it("creates enabled instances with a positive duration", () => {
    for (const preset of LIGHTING_PRESETS) {
      const fx = createEffectFromPreset(preset, { kind: "SCENE", clipId: "c-1" });
      expect(fx.enabled).toBe(true);
      expect(fx.duration).toBeGreaterThan(0);
      expect(fx.metadata?.presetId).toBe(preset.id);
    }
  });
});

describe("anchors", () => {
  const scene = { sceneStart: 10, formationReady: 14, sceneEnd: 20 };

  it("resolves every anchor deterministically", () => {
    const fx = effectOn("c-1", "FADE_IN", { start: 2 });
    expect(resolveEffectStart({ ...fx, anchor: "ABSOLUTE" }, scene)).toBe(2);
    expect(resolveEffectStart({ ...fx, anchor: "SCENE_START" }, scene)).toBe(12);
    expect(resolveEffectStart({ ...fx, anchor: "FORMATION_READY" }, scene)).toBe(16);
    expect(resolveEffectStart({ ...fx, anchor: "SCENE_END" }, scene)).toBe(22);
  });
});

describe("project lighting evaluation", () => {
  const project = () => {
    const base = createDemoProject(24);
    const clip = base.timeline[1]!;
    return projectWithEffects([
      effectOn(clip.id, "FADE_IN", { anchor: "FORMATION_READY", start: 0, duration: 2 }),
    ]);
  };

  it("returns one in-gamut state per drone", () => {
    const p = project();
    const clip = p.timeline[1]!;
    const t = clip.start + clip.transition + 1;
    const states = projectLightingAt({ project: p }, t);
    expect(states.length).toBe(p.droneCount);
    for (const s of states) {
      for (const channel of [s.r, s.g, s.b]) {
        expect(Number.isFinite(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
        expect(Number.isInteger(channel)).toBe(true);
      }
      expect(s.intensity).toBeGreaterThanOrEqual(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for the same instant", () => {
    const p = project();
    const clip = p.timeline[1]!;
    const t = clip.start + clip.transition + 0.7;
    expect(projectLightingAt({ project: p }, t)).toEqual(projectLightingAt({ project: p }, t));
  });

  it("a fade-in is dark at the start and bright at the end", () => {
    const p = project();
    const clip = p.timeline[1]!;
    const ready = clip.start + clip.transition;
    const first = projectLightingAt({ project: p }, ready + 0.01)[0]!;
    const last = projectLightingAt({ project: p }, ready + 1.99)[0]!;
    expect(first.intensity).toBeLessThan(last.intensity);
  });

  it("emits black at zero intensity", () => {
    expect(emittedColor({ r: 255, g: 255, b: 255, intensity: 0 })).toEqual([0, 0, 0]);
  });

  it("never affects geometry: no effects means no states", () => {
    const p = createDemoProject(12);
    expect(projectLightingAt({ project: p }, 5)).toEqual([]);
  });
});

describe("targets and filtering", () => {
  it("filters effects by clip", () => {
    const p = projectWithEffects([effectOn("c-1", "FADE_IN"), effectOn("c-2", "FADE_OUT")]);
    expect(effectsForClip(p.lighting, "c-1").length).toBe(1);
    expect(effectsForClip(p.lighting, "c-9").length).toBe(0);
  });
});

describe("validation and persistence", () => {
  it("flags an effect that targets a removed clip", () => {
    const p = projectWithEffects([effectOn("does-not-exist", "FADE_IN")]);
    const report = validateLightingProgram(p);
    expect(report.issues.some((i) => i.code === "UNRESOLVED_TARGET")).toBe(true);
  });

  it("accepts a consistent program", () => {
    const base = createDemoProject(24);
    const p = projectWithEffects([
      effectOn(base.timeline[1]!.id, "FADE_IN", { anchor: "SCENE_START", start: 0, duration: 1 }),
    ]);
    expect(validateLightingProgram(p).issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("sanitizes malformed persisted data instead of throwing", () => {
    expect(sanitizeLightingProgram(undefined)).toBeUndefined();
    const cleaned = sanitizeLightingProgram({
      schemaVersion: 1,
      effects: [{ id: "x", target: { kind: "SCENE", clipId: "c-1" }, type: "FADE_IN", duration: 1 }],
    });
    expect(cleaned?.effects.length).toBe(1);
  });

  it("migration keeps a valid lighting program and tolerates its absence", () => {
    const base = createDemoProject(24);
    const withLighting = migrateProject({
      ...base,
      lighting: { schemaVersion: 1, effects: [effectOn(base.timeline[1]!.id, "PULSE_2")] },
    });
    expect(withLighting.lighting?.effects.length).toBe(1);
    expect(migrateProject(base).lighting?.effects.length ?? 0).toBe(0);
  });
});
