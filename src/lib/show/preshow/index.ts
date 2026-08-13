/**
 * PRE-SHOW package barrel: launch grid, staging, grouped takeoff, pre-show
 * trajectory composition, validation and deterministic suggestions.
 *
 * Simulation and choreography only — no arming, no takeoff commands, no
 * MAVLink/MAVSDK/PX4/MDS, no radio, no telemetry.
 */
export * from "./types";
export * from "./config";
export * from "./launchGrid";
export * from "./staging";
export * from "./groups";
export * from "./plan";
export * from "./validate";
export * from "./suggest";
