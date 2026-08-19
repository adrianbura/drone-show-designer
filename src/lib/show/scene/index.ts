/**
 * MULTI-FORMATION SCENE ENGINE — public surface.
 *
 * A SCENE is one simultaneous visual composition of formation INSTANCES. It owns
 * artistic intent (objects, transforms, budgets, lighting); it owns NO physical
 * drone identity. The Fleet Participation Planner, assignment engine, trajectory
 * planner, conflict detector and validator remain fully authoritative.
 */
export * from "./types";
export * from "./resolve";
export * from "./budget";
export * from "./migrate";
export * from "./overlap";
export * from "./edit";
export * from "./selection";
