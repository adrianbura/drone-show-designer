/**
 * DETERMINISTIC TEXT GEOMETRY — public surface.
 *
 * The bundled stroke pack + recipe generator are the ONLY sanctioned source of
 * text flight geometry. Canvas rasterisation (`formations.textPoints`) stays
 * preview-only legacy and must never feed a planner-owned formation.
 */
export * from "./glyphPack";
export * from "./types";
export * from "./generate";
export * from "./formation";
export * from "./compat";
export * from "./feasibility";
