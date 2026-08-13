# Drone Show Studio — Architecture (Phase 1)

Internal-use studio for designing, previewing, validating and exporting
synchronized drone light shows. Phase 1 delivers the creative layer and the
full domain model; the computation and adapter backends plug in behind the
interfaces already defined here.

## Layer map

| Layer | Location | Status |
| --- | --- | --- |
| Creative UI | `src/components/studio/*`, `src/routes/index.tsx` | implemented |
| 3D Visualization | `src/components/studio/Viewport3D.tsx` (R3F, instanced swarm) | implemented |
| Show Core (domain model) | `src/lib/show/types.ts` | implemented |
| Formation Engine | `src/lib/show/formations.ts` | implemented (grid/circle/sphere/helix/cube/wave/heart/text) |
| Choreography Engine | `src/lib/studio/store.tsx` (timeline clips, beat snapping) | implemented |
| Trajectory Engine | `src/lib/show/trajectory.ts` (assignment, min-jerk morphs, layered arcs) | implemented |
| Safety Validation Engine | `src/lib/show/safety.ts` (separation via spatial hash, v/a/yaw, ceiling, area, landing) | implemented |
| Audio/Music Engine | `src/lib/show/audio.ts` (local probe + BPM beat grid) | implemented (client-side) |
| Light Program Engine | `src/lib/show/lights.ts` | implemented |
| Export Adapter Layer | `src/lib/adapters/export.ts` (Skybrush-compatible JSON, CSV, project file) | implemented |
| Adapter registry / contracts | `src/lib/adapters/index.ts` (`SimulationAdapter`, `ExportAdapter`) | interfaces defined |
| Skybrush / PX4-SITL / MAVSDK adapters | Python service, behind the same interfaces | planned |
| Project persistence, Job/Worker system | Lovable Cloud (Postgres) + Python workers | planned |

## Key decisions

- **No robotics reimplementation.** No autopilot, no MAVLink codec, no PX4 or
  MAVSDK forks. Integration happens over documented file formats and network
  protocols at the adapter boundary only.
- **Engines are pure functions of `ShowProject`.** Formation, trajectory,
  safety, light and export code has no React/Three/transport dependency, so each
  can be replaced by a Python implementation with identical semantics once fleet
  size or solver quality demands it (Hungarian/auction assignment,
  collision-aware planning, librosa onset detection).
- **Scales to 200+ drones by construction.** One instanced mesh for the swarm
  (constant draw calls), O(drones) per-frame sampling, and a uniform spatial
  hash for separation checks instead of O(n²) pair scans.
- **Compliance.** No GPL-derived source is vendored. Skybrush is targeted as an
  interchange format. Any move toward external distribution or commercial
  redistribution requires a license/compliance review before shipping.

## Not yet in place (next phases)

1. Python + FastAPI computation service; REST for CRUD, WebSocket for job
   progress, simulation state and telemetry.
2. Project persistence and multi-project management (Postgres).
3. SVG / image / 3D-mesh importers feeding the Formation Engine.
4. Real beat/onset detection and waveform display.
5. PX4 SITL fleet spawning and MAVSDK mission upload behind `SimulationAdapter`.
