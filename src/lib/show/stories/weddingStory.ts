/**
 * STORY SHOW — "Two Hearts, One Sky" (wedding narrative).
 *
 * Authored show content built from the deterministic core only: procedural
 * formations (grid / helix / wave / sphere) plus the pure story geometry in
 * ./geometry.ts. No AI, no DOM, no randomness — the same fleet size always
 * produces byte-identical geometry, and every clip is a normal editable
 * TimelineClip the designer can retime, recolour or delete.
 *
 * Narrative beats:
 *   high school -> friendship -> falling in love -> adventure ->
 *   the sea -> the proposal -> "yes" -> the wedding -> two hearts -> fireworks
 */
import { createDefaultProject } from "../defaultProject";
import { makeFormation } from "../formations";
import type {
  Formation,
  LightEffect,
  RGB,
  ShowProject,
  TimelineClip,
  Vec3,
} from "../types";
import {
  doubleHeartPoints,
  enforceSpacing,
  heartPoints,
  loveSpiralPoints,
  sphereShellPoints,
  engagementRingPoints,
  fireworksBurstPoints,
  friendshipPoints,
  mountainsPoints,
  seaAndMoonPoints,
  twoSoulsPoints,
  weddingRingsPoints,
} from "./geometry";

export const WEDDING_STORY_ID = "story-wedding-two-hearts";

interface Beat {
  readonly id: string;
  readonly name: string;
  /** Custom story geometry; omitted when the beat uses a procedural shape. */
  readonly points?: (count: number) => Vec3[];
  readonly transition: number;
  readonly hold: number;
  readonly color: RGB;
  readonly effect: LightEffect;
}

/** Story beats in narrative order (SHOW phase only). */
const BEATS: readonly Beat[] = [
  {
    id: "s-highschool",
    name: "1 · Highschool — two strangers",
    points: (n) => twoSoulsPoints(n, 104, 40),
    transition: 14,
    hold: 6,
    color: [130, 190, 255],
    effect: "solid",
  },
  {
    id: "s-friends",
    name: "2 · Friendship — a bridge between them",
    points: (n) => friendshipPoints(n, 112, 42),
    transition: 12,
    hold: 6,
    color: [150, 235, 210],
    effect: "chase",
  },
  {
    id: "s-inlove",
    name: "3 · Falling in love — spiral upwards",
    points: (n) => loveSpiralPoints(n),
    transition: 14,
    hold: 6,
    color: [255, 150, 190],
    effect: "pulse",
  },
  {
    id: "s-adventure",
    name: "4 · Adventure — mountains together",
    points: (n) => mountainsPoints(n, 124, 18),
    transition: 14,
    hold: 6,
    color: [255, 200, 110],
    effect: "solid",
  },
  {
    id: "s-sea",
    name: "5 · The sea at night",
    points: (n) => seaAndMoonPoints(n, 132, 20),
    transition: 14,
    hold: 7,
    color: [110, 170, 255],
    effect: "twinkle",
  },
  {
    id: "s-proposal",
    name: "6 · The proposal — the ring",
    points: (n) => engagementRingPoints(n, 98, 46),
    transition: 14,
    hold: 8,
    color: [255, 235, 170],
    effect: "pulse",
  },
  {
    id: "s-yes",
    name: '7 · She said "yes" — heart',
    points: (n) => heartPoints(n, 116, 46),
    transition: 12,
    hold: 7,
    color: [255, 90, 130],
    effect: "pulse",
  },
  {
    id: "s-wedding",
    name: "8 · The wedding — interlocked rings",
    points: (n) => weddingRingsPoints(n, 112, 46),
    transition: 14,
    hold: 8,
    color: [255, 245, 225],
    effect: "solid",
  },
  {
    id: "s-two-hearts",
    name: "9 · Two hearts, one beat",
    points: (n) => doubleHeartPoints(n, 112, 48),
    transition: 12,
    hold: 7,
    color: [255, 110, 150],
    effect: "twinkle",
  },
  {
    id: "s-fireworks-1",
    name: "10 · Fireworks — first burst",
    points: (n) => fireworksBurstPoints(n, 104, 46),
    transition: 10,
    hold: 5,
    color: [255, 220, 120],
    effect: "rainbow",
  },
  {
    id: "s-fireworks-2",
    name: "11 · Fireworks — finale sphere",
    points: (n) => sphereShellPoints(n, 54),
    transition: 8,
    hold: 6,
    color: [255, 255, 255],
    effect: "twinkle",
  },
];

/**
 * Builds the complete wedding story show: PRE-authored TAKEOFF, eleven SHOW
 * beats and an explicit LANDING, with one formation per beat.
 */
export function createWeddingStoryProject(droneCount = 200): ShowProject {
  const base = createDefaultProject(droneCount);
  const area = base.area;
  const alt = base.altitudes;

  const custom = (id: string, name: string, points: Vec3[]): Formation => ({
    id,
    name,
    kind: "custom",
    params: { seed: base.seed },
    // Relax to the fleet separation profile with headroom over the 2.5 m limit.
    points: enforceSpacing(points, 3.2),
  });

  const formations: Formation[] = [
    makeFormation("story-takeoff", "0 · Take-off wall", "grid", droneCount, area, {
      size: 70,
      altitude: alt.takeoff,
    }),
  ];

  for (const beat of BEATS) {
    {
      formations.push(custom(beat.id, beat.name, beat.points!(droneCount)));
    }
  }

  formations.push(
    makeFormation("story-approach", "12 · Landing approach", "grid", droneCount, area, {
      size: 70,
      altitude: 10,
    }),
  );

  const timeline: TimelineClip[] = [];
  let cursor = 0;
  const push = (clip: Omit<TimelineClip, "start">) => {
    timeline.push({ ...clip, start: cursor });
    cursor += clip.transition + clip.hold;
  };

  push({
    id: "c-story-takeoff",
    formationId: "story-takeoff",
    transition: 20,
    hold: 6,
    easing: "minJerk",
    color: [90, 150, 255],
    effect: "solid",
    phase: "TAKEOFF",
  });

  BEATS.forEach((beat, i) => {
    push({
      id: `c-${beat.id}`,
      formationId: beat.id,
      transition: beat.transition,
      hold: beat.hold,
      easing: i === 0 ? "minJerk" : "smooth",
      color: beat.color,
      effect: beat.effect,
      phase: "SHOW",
    });
  });

  push({
    id: "c-story-approach",
    formationId: "story-approach",
    transition: 14,
    hold: 3,
    easing: "minJerk",
    color: [120, 160, 255],
    effect: "solid",
    phase: "SHOW",
  });
  push({
    id: "c-story-landing",
    formationId: "story-approach",
    transition: 14,
    hold: 2,
    easing: "minJerk",
    color: [90, 120, 220],
    effect: "solid",
    phase: "LANDING",
  });

  return {
    ...base,
    id: WEDDING_STORY_ID,
    name: "Two Hearts, One Sky",
    formations,
    timeline,
  };
}
