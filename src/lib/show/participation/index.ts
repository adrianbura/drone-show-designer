/**
 * FLEET PARTICIPATION ENGINE — public surface.
 *
 * A formation owns POINTS. The fleet owns DRONES. This package maps every drone
 * of the fleet to exactly one ROLE per scene and gives each of them an explicit
 * deterministic target, so partial formations never leave a drone unplanned.
 *
 * Pure and framework-free: the studio, the trajectory scheduler and the
 * validators consume it; nothing inside knows about React or Three.js.
 */
export * from "./types";
export * from "./cost";
export * from "./reserveZone";
export * from "./revision";
export * from "./planner";
