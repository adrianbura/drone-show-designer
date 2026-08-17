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
| Dynamic Formation Engine | `src/lib/show/dynamic/*` (global transform track + additive motion groups, presets, design-time report) | implemented |

| Choreography Engine | `src/lib/show/timeline.ts` + `src/lib/studio/store.tsx` | implemented |
| Canonical show clock | `src/lib/studio/clock.ts` (anchor-based, drift-free, speed + loop) | implemented |
| Assignment Engine | `src/lib/show/assignment.ts` (strategy-based) | implemented |
| Drone identity | `src/lib/show/drones.ts` (stable `DRN-001` ids, home positions) | implemented |
| Coordinate contract | `src/lib/show/coordinates.ts` (+Y up, yaw 0 = +X) | implemented |
| Trajectory Engine | `src/lib/show/trajectory/*` (planner, schedule, sampler) | implemented |
| Safety Validation Engine | `src/lib/show/safety.ts` (separation via spatial hash, v/a/yaw, ceiling, area, landing) | implemented |
| Full Show Engine | `src/lib/show/fullshow/*` (composer, continuity, metrics, lighting, validator, revision) | implemented |
| Audio/Music Engine | `src/lib/show/audio.ts` (local probe + BPM beat grid) | implemented (client-side) |
| Light Program Engine | `src/lib/show/lights.ts` | implemented |
| Export Adapter Layer | `src/lib/adapters/export.ts` (documented `DroneShowStudioShow` JSON, CSV, project file — see docs/EXPORT_FORMAT.md) | implemented |
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

## Naming honesty

There is no Skybrush exporter. The old `toSkybrushShow()` emitted an unverified
Skybrush-*like* layout, so it was replaced by the studio's own documented
`DroneShowStudioShow` v1 schema. The registry lists Skybrush as `planned`; a real
adapter must be written against the published format. Likewise, a passing safety
report means "validated against the current safety profile", never "safe to fly".

## Full-show validation (`src/lib/show/fullshow/`)

The whole timeline is composed into ONE canonical `TrajectorySet` (TAKEOFF ->
SHOW -> LANDING) and validated as a single artefact: continuity across clip
boundaries, global proximity conflicts, safety envelope, light program gamut,
timeline structure and home pads. Output is a `FullShowValidationReport` with a
deterministic `analysisRevision`; the UI marks the report stale whenever any
input to that revision changes, and exports embed the report as provenance.

LANDING assigns pads with the globally optimal (minimum total distance) matching
rather than index identity: pads are interchangeable, and identity mapping made
descent paths cross, which the validator correctly reported as proximity
violations. A PASS still means "validated against the configured profile", never
"safe to fly".

## Not yet in place (next phases)

1. Python + FastAPI computation service; REST for CRUD, WebSocket for job
   progress, simulation state and telemetry.
2. Project persistence and multi-project management (Postgres).
3. SVG / image / 3D-mesh importers feeding the Formation Engine.
4. Real beat/onset detection and waveform display.
5. PX4 SITL fleet spawning and MAVSDK mission upload behind `SimulationAdapter`.

## Vector / SVG formation engine (`src/lib/show/svg/`)

Pure, DOM-free package that turns an untrusted SVG document into an **exact-N**
point set in show-local coordinates. It never plans flight: output is a plain
`Formation` (`kind: "svg"`), so assignment, trajectory planning, sampling,
safety validation and export are entirely unchanged downstream.

```
file -> import.ts (File -> text, size limit)
     -> parser.ts (inert XML scan; no DOM, no scripts, no network)
     -> paths.ts + flatten.ts (all path commands, arcs -> cubics, adaptive flattening)
     -> normalize.ts (viewBox -> centred plane metres -> world, +Y up)
     -> sampling.ts (outline: arc-length + largest-remainder | fill: stratified + farthest-point)
     -> distribute.ts (seeded PRNG, allocation, fill rules, constrained relaxation)
     -> validation.ts (static spacing / duplicate / placement report)
     -> formation.ts (Formation + reproducibility metadata)
```

Guarantees: exactly `targetCount` points or a structured `SvgError`;
deterministic for a given (file, params, seed); no remote fetches; live text,
raster images, masks and filters are reported as warnings rather than silently
approximated. Fleet-size changes regenerate through the stored `SvgAsset`, which
keeps exact-N valid. Design-time reports are quality metrics, never a safety
statement — the SafetyValidator remains the only authority on flight limits.

## Project Setup, Formation Asset Library, Localization (Sprint 6B.6)

- `src/lib/show/setup/` — authoring layer over the pre-show engine. `evaluateProjectSetup`
  derives capacity, occupancy, footprint and minimum pad distance exclusively from
  `buildLaunchLayout`, so the wizard preview can never disagree with the planner.
  Pads are filled row-major (`PAD_POPULATION_ORDER`); `DRN-001` always takes `PAD-001`.
  `createProjectFromSetup` builds a new project, `preShowConfigFromSetup` patches an
  existing one, and `setupDraftFromProject` re-opens a project as a draft.
- `src/lib/library/` — versioned, engine-agnostic formation assets. Static assets carry
  exact geometry; dynamic assets carry the FULL animation model (groups, keyframes,
  transform, loop, algorithm version), verified by sample-equality tests. Persistence sits
  behind `FormationAssetRepository`; the browser implementation stores a single document
  and skips malformed assets instead of failing the library. Fleet mismatches BLOCK
  insertion — geometry is never silently resampled.
- `src/i18n/` — EN/RO dictionaries with a type-safe `translate`. Localization touches
  human-facing UI only: ids, diagnostic codes, ESSP/PX4 payloads and exported schemas stay
  language-neutral, and language state lives outside the studio store so switching it never
  invalidates project state or engine memoisation.
- UI: `SetupWizard.tsx` (new show / show setup), `LaunchGridPreview.tsx` (top-down pad
  preview), `LibraryPanel.tsx` (browse, save, import, export, reuse).
