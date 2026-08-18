/**
 * VISUAL STRUCTURE EDITOR — public surface (Sprint 8B2).
 *
 * Pure command + coordinate layer, plus the React state hook the panel uses.
 * The editor only ever produces a new VisualFormationDesign; the deterministic
 * Drone Art Compiler stays the single authority for exact-N drone points.
 */
export * from "./commands";
export * from "./hitTest";
export * from "./importance";
export * from "./viewTransform";
export * from "./useStructureEditor";
