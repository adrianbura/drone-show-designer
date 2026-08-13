# Simulation Bridge (Sprint 5)

**SIMULATION ONLY.** The bridge replays exactly ONE already-validated Drone Show
Studio trajectory through a local PX4 SITL vehicle (or an in-process mock) and
reports tracking diagnostics. There is no code path — and no API endpoint — that
can command a physical aircraft.

## Architecture

```text
Studio (React/TS)                          Bridge (Python/FastAPI)
─────────────────                          ───────────────────────
SimulationPanel                            /api/v1/health
  useSimulation  ── SimulationClient ────►  /api/v1/environment
                     (HTTP, loopback)       /api/v1/package/validate
buildSimulationPackage                      /api/v1/simulation/prepare|run|cancel
  + simulationPayloadHash                   /api/v1/simulation/{id}[/report]
                                            /api/v1/simulation/history
                                                     │
                                            SimulationRunner (state machine,
                                            monotonic clock, setpoint loop)
                                                     │
                                            SimulationVehicleAdapter
                                              ├── MOCK (synthetic, labelled)
                                              ├── PX4_SITL_MAVSDK (offboard NED)
                                              └── MDS (placeholder, not implemented)
```

The studio never streams setpoints: it posts the package once, and the bridge
owns the real-time control loop.

## Coordinate mapping

Studio show-local (`+X` east, `+Y` up, `+Z` north, right-handed, metres) maps to
PX4 local NED as:

| NED   | Studio     |
| ----- | ---------- |
| North | `+Z`       |
| East  | `+X`       |
| Down  | `-Y`       |

Yaw: `ned_yaw_deg = 90 - studio_yaw_deg`. `app/services/coordinates.py` is the
only place sign changes live.

## Execution gate

Only shows whose full-show validation is `VALIDATED` or
`VALIDATED_WITH_WARNINGS` (for the current analysis revision) may be replayed.
Stale, failed and unvalidated shows are refused with
`PACKAGE_STALE` / `SHOW_VALIDATION_FAILED`. The built-in **test trajectory**
(hold → up 1 m → right 2 m → forward 2 m → return) carries no show data and is
always available; it exists to verify connection, timing and axis signs.

Package integrity is protected by `simulationPayloadHash` (FNV-1a, mirrored in
TS and Python): a modified package is rejected before a run starts.

## Security posture

- Binds to loopback only; CORS restricted to local studio origins.
- Endpoint allowlist: loopback hosts and known local SITL ports only. Remote or
  public addresses raise `NON_LOCAL_ENDPOINT_REJECTED`.
- No arm / takeoff / land / goto / raw-MAVLink endpoints exist. Arming and
  offboard entry happen internally for the simulated vehicle only.
- Telemetry is never fabricated: unavailable fields are reported as `null` and
  surface as `TELEMETRY_UNAVAILABLE` warnings. Mock runs are labelled `MOCK`
  everywhere, including the exported report.

## Running it

```bash
cd simulation_bridge
python -m pip install -e '.[dev]'        # add '.[px4]' for real PX4 SITL
python -m uvicorn app.main:app --host 127.0.0.1 --port 8787
python -m pytest -q                      # 30 tests, no PX4 required
```

Environment overrides use the `DSS_BRIDGE_*` prefix (`PX4_ENDPOINT`,
`SETPOINT_RATE`, `TELEMETRY_RATE`, `WARN_ERROR`, `FAIL_ERROR`, …).

With PX4 SITL running locally (`make px4_sitl gz_x500`, MAVSDK on
`udpin://127.0.0.1:14540`), pick **PX4 SITL** in the Simulation bridge panel and
run the test pattern first to confirm the axis mapping, then replay one drone.

## Not implemented (deliberately)

- Multi-vehicle simulation (`MULTI_VEHICLE_NOT_SUPPORTED`).
- MDS execution (placeholder adapter only).
- Any real-fleet/physical-aircraft path.
- Real-world safety assertions: every report states that results are simulation
  tracking diagnostics only.
