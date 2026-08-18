/**
 * BOUNDED FIXED-SEED STRUCTURAL STRESS TEST (audit section Y).
 *
 * 30 deterministic operations (fleet resize, timing edit, scene edit, lighting
 * edit, serialize/deserialize) with cheap structural invariants after each one.
 * Fixed seed, no randomness beyond the seeded PRNG, no timing assertions.
 */
import { describe, expect, it } from "vitest";

import { buildComplexProject } from "./fixtures";
import { expectFinite } from "./invariants";
import { parseProjectFile, projectFileToJson, serializeProject } from "@/lib/project";
import { createEffectFromPreset, findLightingPreset } from "../../lighting";
import { createSceneEvaluator, patchObjectTransform, sceneForClip, upsertScene } from "../../scene";
import { buildShowPlan } from "../../trajectory/schedule";
import { showDuration, type ShowProject } from "../../types";

/** mulberry32 — the project's deterministic PRNG shape. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FLEETS = [200, 137, 250, 347, 199, 201];

function checkInvariants(project: ShowProject, label: string): void {
  expect(project.droneCount, `${label}: fleet`).toBeGreaterThanOrEqual(3);
  expect(project.droneCount, `${label}: fleet`).toBeLessThanOrEqual(500);
  expect(new Set(project.timeline.map((c) => c.id)).size, `${label}: clip ids`).toBe(project.timeline.length);
  expect(showDuration(project), `${label}: duration`).toBeGreaterThan(0);
  for (const clip of project.timeline) {
    expect(Number.isFinite(clip.start) && clip.start >= 0, `${label}: clip start`).toBe(true);
    expect(clip.transition, `${label}: transition`).toBeGreaterThan(0);
    expect(clip.hold, `${label}: hold`).toBeGreaterThanOrEqual(0);
    const scene = sceneForClip(project, clip);
    expectFinite(createSceneEvaluator(project, scene).positionsAt(0), `${label}: scene ${clip.id}`);
  }
  for (const f of project.formations) expectFinite(f.points, `${label}: ${f.id}`);
}

describe("seeded structural stress (30 operations)", () => {
  it("survives 30 seeded edits with structural invariants intact", () => {
    const rnd = prng(20260818);
    let project = buildComplexProject(200, 150).project;
    checkInvariants(project, "op-0");

    for (let op = 1; op <= 30; op++) {
      const kind = op % 5;
      if (kind === 0) {
        project = { ...project, droneCount: FLEETS[Math.floor(rnd() * FLEETS.length)]! };
      } else if (kind === 1) {
        const i = Math.floor(rnd() * project.timeline.length);
        project = {
          ...project,
          timeline: project.timeline.map((c, idx) =>
            idx === i ? { ...c, transition: 4 + Math.round(rnd() * 10), hold: 2 + Math.round(rnd() * 12) } : c,
          ),
        };
      } else if (kind === 2) {
        const clip = project.timeline[1]!;
        const scene = sceneForClip(project, clip);
        const target = scene.objects[Math.floor(rnd() * scene.objects.length)]!;
        project = upsertScene(
          project,
          patchObjectTransform(scene, target.id, {
            position: [Math.round((rnd() - 0.5) * 120), Math.round(rnd() * 20), Math.round((rnd() - 0.5) * 120)],
            rotationDeg: [0, Math.round(rnd() * 360), 0],
            scale: 0.6 + rnd(),
          }),
        );
      } else if (kind === 3) {
        const preset = findLightingPreset(["FADE_IN", "PULSE_2", "LEFT_TO_RIGHT", "COLOR_TRANSITION"][op % 4]!)!;
        const clipId = project.timeline[op % project.timeline.length]!.id;
        project = {
          ...project,
          lighting: {
            schemaVersion: 1,
            effects: [
              ...(project.lighting?.effects ?? []),
              {
                ...createEffectFromPreset(preset, { kind: "SCENE", clipId }, { idSeed: op }),
                id: `fx-stress-${op}`,
              },
            ],
          },
        };
      } else {
        project = parseProjectFile(projectFileToJson(serializeProject(project))).project;
      }
      checkInvariants(project, `op-${op}`);
    }

    // The project is still plannable after all 30 operations.
    const plan = buildShowPlan(project);
    expect(plan.drones).toHaveLength(project.droneCount);
    expect(new Set(plan.drones.map((d) => d.id)).size).toBe(project.droneCount);
  }, 60_000);
});
