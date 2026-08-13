# DroneShowStudioShow — export schema v1

Emitted by `toGenericShowJson()` (`src/lib/adapters/export.ts`).

This is the studio's own documented interchange format. It is deliberately NOT
a Skybrush file: the previous "Skybrush export" produced an unverified,
Skybrush-like layout. A real `SkybrushAdapter` will be added later behind the
`ExportAdapter` contract in `src/lib/adapters/index.ts`, against the actual
published format.

## Conventions

- Units: metres, seconds, degrees, m/s, m/s², m/s³, °/s.
- Coordinate system: show-local, right-handed, **+Y up**, origin at the show
  centre on the ground plane. Yaw 0° faces +X and increases toward +Z,
  normalised to (-180, 180]. See `src/lib/show/coordinates.ts`.
- Numbers are rounded to 3 decimals (yaw to 2).

## Top level

| Field | Meaning |
| --- | --- |
| `schema` / `schemaVersion` | `"DroneShowStudioShow"` / `1` |
| `generator` | producing application |
| `project` | id, name, droneCount, duration (canonical show duration), seed, versions, area, altitudes, audio metadata |
| `coordinateSystem` | machine-readable description of the frame above |
| `safetyProfile` | the configured limits used for validation |
| `formations` | id, name, kind, params, points |
| `timeline` | creative clips with explicit `phase` (`TAKEOFF` / `SHOW` / `LANDING`) |
| `assignments` | drone-index → formation-point mapping per clip |
| `trajectorySet` | droneCount, duration, sampleRate, algorithmVersion |
| `lighting` | how colours were evaluated |
| `validation` | validation status + metrics, or `null` |
| `planningErrors` | structured planner diagnostics |
| `drones` | per-drone identity, home position and samples |

## Per-drone samples

Each entry of `drones[].samples`:

```
{ t, p:[x,y,z], v:[..], a:[..], j:[..], yaw, yawRate, c:[r,g,b] }
```

`c` is sRGB 0-255 evaluated from the active clip's light effect at time `t`.

## Validation semantics

`validation.status === "ok"` means **validated against the current safety
profile**. It is not a real-world safety guarantee: no wind, GPS error, battery
state, hardware failure, airspace or regulatory constraint is modelled.
