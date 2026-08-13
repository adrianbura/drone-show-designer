/**
 * ADAPTER LAYER
 *
 * Boundary between Drone Show Studio's own creative/orchestration model and the
 * external drone ecosystems. Nothing above this layer knows about PX4, MAVLink,
 * MAVSDK or Skybrush; nothing below it knows about the UI.
 *
 * License note: this project must not embed GPL-derived sources. Skybrush,
 * PX4 and MAVSDK are integrated over their documented file formats and network
 * protocols only. Any change that vendors GPL code, or any move toward external
 * distribution, triggers a license/compliance review.
 */
import type { ShowProject } from "../show/types";
import type { ShowPlan, TrajectorySet } from "../show/trajectory";

export type AdapterStatus = "available" | "configured" | "unavailable" | "planned";

export interface AdapterDescriptor {
  id: string;
  name: string;
  kind: "export" | "simulation" | "fleet";
  status: AdapterStatus;
  /** Upstream ecosystem this adapter talks to, for compliance tracking. */
  upstream: string;
  license: string;
  notes: string;
}

export interface ExportAdapter extends AdapterDescriptor {
  kind: "export";
  extension: string;
  mime: string;
  serialize(project: ShowProject, plan: ShowPlan, set: TrajectorySet): string;
}

export interface TelemetryFrame {
  droneId: number;
  position: readonly [number, number, number];
  batteryPct: number;
  armed: boolean;
  mode: string;
}

/**
 * Simulation/fleet transport contract. The in-browser virtual fleet implements
 * it today; the PX4/SITL + MAVSDK backends implement the same interface over
 * WebSocket once the Python service is deployed.
 */
export interface SimulationAdapter extends AdapterDescriptor {
  kind: "simulation" | "fleet";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  uploadShow(project: ShowProject, plan: ShowPlan, set: TrajectorySet): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(cb: (frames: TelemetryFrame[]) => void): () => void;
}

export const ADAPTER_REGISTRY: AdapterDescriptor[] = [
  {
    id: "virtual-fleet",
    name: "Virtual Fleet (in-browser)",
    kind: "simulation",
    status: "available",
    upstream: "none",
    license: "internal",
    notes: "Kinematic preview fleet. Default target during design work.",
  },
  {
    id: "generic-show-json",
    name: "Generic Show JSON (.dss.show.json)",
    kind: "export",
    status: "available",
    upstream: "n/a — internal documented schema",
    license: "internal",
    notes: "DroneShowStudioShow v1: trajectories, lighting, safety profile, versions.",
  },
  {
    id: "skybrush",
    name: "Skybrush Show (.skyc)",
    kind: "export",
    status: "planned",
    upstream: "Skybrush Studio / Live",
    license: "format interop only — no GPL sources vendored",
    notes: "NOT IMPLEMENTED: needs the real, verified Skybrush format. Generic Show JSON is used meanwhile.",
  },
  {
    id: "generic-csv",
    name: "Generic trajectory CSV",
    kind: "export",
    status: "available",
    upstream: "n/a",
    license: "internal",
    notes: "time,drone_id,position,velocity,yaw,colour — universal handoff format.",
  },
  {
    id: "px4-sitl",
    name: "PX4 SITL (single vehicle, via Simulation Bridge)",
    kind: "simulation",
    status: "configured",
    upstream: "PX4 Autopilot (BSD-3)",
    license: "BSD-3 — process boundary, no code copied",
    notes:
      "Sprint 5: replays ONE validated trajectory through a local PX4 SITL vehicle over the Python bridge. Simulation only.",
  },

  {
    id: "mavsdk",
    name: "MAVSDK / MAVLink",
    kind: "fleet",
    status: "planned",
    upstream: "MAVSDK (BSD-3), MAVLink",
    license: "BSD-3 — used as a library in the Python service",
    notes: "Mission upload, arm/takeoff/land orchestration, real fleet telemetry.",
  },
];
