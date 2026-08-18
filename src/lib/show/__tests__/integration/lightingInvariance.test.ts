/**
 * LIGHTING POSITION INVARIANCE (audit section I) — mandatory.
 *
 * Lighting is artistic output only. For an identical scene and instant, changing
 * the lighting program must NEVER move a drone: only LED colour may change.
 */
import { describe, expect, it } from "vitest";

import { buildComplexProject } from "./fixtures";
import { expectFinite } from "./invariants";
import {
  createEffectFromPreset,
  findLightingPreset,
  projectLightingAt,
  type LightingEffectInstance,
  type LightingProgram,
} from "../../lighting";
import { positionsAt } from "../../trajectory/schedule";
import { buildShowPlan } from "../../trajectory/schedule";
import type { ShowProject } from "../../types";

const PRESETS = ["FADE_IN", "LEFT_TO_RIGHT", "CENTER_TO_OUTSIDE", "PULSE_2", "COLOR_TRANSITION"];

const base = buildComplexProject(200, 150).project;
const SAMPLE_TIMES = [0.1, 1, 9, 18.1, 20, 30, 36.1, 40, 48];

function withLighting(project: ShowProject, presetId: string, clipId: string): ShowProject {
  const preset = findLightingPreset(presetId)!;
  const effect: LightingEffectInstance = {
    ...createEffectFromPreset(preset, { kind: "SCENE", clipId }, { idSeed: 7 }),
    id: `fx-${presetId}`,
    anchor: "SCENE_START",
    start: 0,
  };
  const lighting: LightingProgram = { schemaVersion: 1, effects: [effect] };
  return { ...project, lighting };
}

describe("lighting never influences flight geometry", () => {
  const noLighting: ShowProject = { ...base, lighting: { schemaVersion: 1, effects: [] } };
  const reference = buildShowPlan(noLighting);
  const referencePositions = SAMPLE_TIMES.map((t) => positionsAt(reference, t));

  it("exposes every audited preset", () => {
    for (const id of PRESETS) expect(findLightingPreset(id), id).toBeTruthy();
  });

  for (const presetId of PRESETS) {
    it(`${presetId} changes LED output but not a single position`, () => {
      let changedColour = false;
      for (const clipId of ["scene-1", "scene-2", "scene-3"]) {
        const lit = withLighting(noLighting, presetId, clipId);
        const plan = buildShowPlan(lit);
        SAMPLE_TIMES.forEach((t, i) => {
          const positions = positionsAt(plan, t);
          expect(positions, `${presetId}@${t}`).toEqual(referencePositions[i]);
          expectFinite(positions, `${presetId}@${t}`);
          const before = projectLightingAt({ project: noLighting }, t);
          const after = projectLightingAt({ project: lit }, t);
          expect(after).toHaveLength(before.length);
          if (JSON.stringify(after) !== JSON.stringify(before)) changedColour = true;
        });
      }
      expect(changedColour, `${presetId} produced no LED difference at any sampled instant`).toBe(true);
    });
  }

  it("keeps lighting output in gamut for the complex project", () => {
    for (const t of SAMPLE_TIMES) {
      for (const state of projectLightingAt({ project: base }, t)) {
        for (const channel of [state.r, state.g, state.b]) {
          expect(Number.isInteger(channel)).toBe(true);
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
        expect(state.intensity).toBeGreaterThanOrEqual(0);
        expect(state.intensity).toBeLessThanOrEqual(1);
      }
    }
  });
});
