import { createDefaultProject } from "../defaultProject";
import type { Formation, ShowProject, TimelineClip, Vector3Tuple } from "../types";

/**
 * Small deterministic authoring demo for Geometry Proposal / depth staggering.
 *
 * This is a real sample project, not a hidden test-only fixture. The SHOW hold
 * intentionally contains two near-vertical columns whose true 3D separation is
 * comfortably above the default minimum. Long min-jerk transitions keep the
 * motion gentle so the canonical full-show validator can be used to demonstrate
 * the complete Find -> Evaluate -> Apply -> Undo -> Redo workflow.
 */
export const DEPTH_STAGGER_DEMO_ID = "story-depth-stagger-demo";

const TAKEOFF: readonly Vector3Tuple[] = [
  [-10, 15, -2],
  [-10, 15, 2],
  [10, 15, -2],
  [10, 15, 2],
];

const STACKED: readonly Vector3Tuple[] = [
  [-10, 30, 0],
  [-9.8, 35, 0.1],
  [10, 30, 0],
  [10.2, 35, 0.1],
];

const APPROACH: readonly Vector3Tuple[] = [
  [-10, 8, -2],
  [-10, 8, 2],
  [10, 8, -2],
  [10, 8, 2],
];

function formation(id: string, name: string, points: readonly Vector3Tuple[]): Formation {
  return {
    id,
    name,
    kind: "custom",
    points: points.map((point) => [...point] as Vector3Tuple),
    params: { seed: 20260821, purpose: "depth-stagger-demo" },
  };
}

export function createDepthStaggerDemoProject(): ShowProject {
  const base = createDefaultProject(4);
  const formations: Formation[] = [
    formation("f-ds-takeoff", "Depth Stagger · Takeoff", TAKEOFF),
    formation("f-ds-stack", "Depth Stagger · Vertical Columns", STACKED),
    formation("f-ds-approach", "Depth Stagger · Landing Approach", APPROACH),
  ];

  const timeline: TimelineClip[] = [
    {
      id: "c-ds-takeoff",
      formationId: "f-ds-takeoff",
      start: 0,
      transition: 30,
      hold: 6,
      easing: "minJerk",
      color: [90, 170, 255],
      effect: "solid",
      phase: "TAKEOFF",
    },
    {
      id: "c-ds-stack",
      formationId: "f-ds-stack",
      start: 36,
      transition: 40,
      hold: 12,
      easing: "minJerk",
      color: [255, 220, 120],
      effect: "solid",
      phase: "SHOW",
    },
    {
      id: "c-ds-approach",
      formationId: "f-ds-approach",
      start: 88,
      transition: 40,
      hold: 6,
      easing: "minJerk",
      color: [120, 170, 255],
      effect: "solid",
      phase: "SHOW",
    },
    {
      id: "c-ds-landing",
      formationId: "f-ds-approach",
      start: 134,
      transition: 24,
      hold: 2,
      easing: "minJerk",
      color: [80, 120, 220],
      effect: "solid",
      phase: "LANDING",
    },
  ];

  return {
    ...base,
    id: DEPTH_STAGGER_DEMO_ID,
    name: "Depth Stagger Demo",
    droneCount: 4,
    formations,
    timeline,
  };
}
