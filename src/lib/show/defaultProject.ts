import { makeFormation } from "./formations";
import type { ShowArea, ShowProject } from "./types";

export const DEFAULT_AREA: ShowArea = { width: 120, depth: 120, height: 80 };

export const DEFAULT_LIMITS = {
  maxVelocity: 8,
  maxAcceleration: 4,
  maxYawRate: 90,
  minSeparation: 2.5,
  maxAltitude: 80,
};

/** Deterministic demo show — no randomness (module scope must stay pure). */
export function createDefaultProject(droneCount = 48): ShowProject {
  const area = DEFAULT_AREA;
  const formations = [
    makeFormation("f-launch", "Launch Grid", "grid", droneCount, area, { size: 60, altitude: 15 }),
    makeFormation("f-sphere", "Orb", "sphere", droneCount, area, { size: 50, altitude: 40 }),
    makeFormation("f-helix", "Ascending Helix", "helix", droneCount, area, { size: 45, height: 55 }),
    makeFormation("f-heart", "Heart", "heart", droneCount, area, { size: 60, altitude: 42 }),
    makeFormation("f-land", "Landing Grid", "grid", droneCount, area, { size: 60, altitude: 3 }),
  ];

  return {
    id: "prj-demo",
    name: "Untitled Show",
    droneCount,
    area,
    limits: { ...DEFAULT_LIMITS },
    audio: { name: "No track loaded", bpm: 120, offset: 0, duration: 90 },
    formations,
    timeline: [
      {
        id: "c-1",
        formationId: "f-launch",
        start: 0,
        transition: 8,
        hold: 6,
        easing: "minJerk",
        color: [80, 200, 255],
        effect: "solid",
      },
      {
        id: "c-2",
        formationId: "f-sphere",
        start: 14,
        transition: 10,
        hold: 8,
        easing: "minJerk",
        color: [120, 255, 190],
        effect: "pulse",
      },
      {
        id: "c-3",
        formationId: "f-helix",
        start: 32,
        transition: 10,
        hold: 8,
        easing: "smooth",
        color: [255, 190, 90],
        effect: "rainbow",
      },
      {
        id: "c-4",
        formationId: "f-heart",
        start: 50,
        transition: 10,
        hold: 10,
        easing: "minJerk",
        color: [255, 90, 130],
        effect: "twinkle",
      },
      {
        id: "c-5",
        formationId: "f-land",
        start: 70,
        transition: 12,
        hold: 4,
        easing: "minJerk",
        color: [90, 130, 255],
        effect: "solid",
      },
    ],
  };
}
